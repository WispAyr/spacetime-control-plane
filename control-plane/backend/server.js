/**
 * Spacetime Control Plane — Backend Service
 *
 * Wraps the SpacetimeDB CLI to provide REST endpoints for:
 *   - Tenant management (scaffold, publish, delete modules)
 *   - Deploy (publish modules to SpacetimeDB)
 *   - Logs (stream module logs)
 *   - File uploads (media reference storage)
 *
 * Runs alongside the Vite frontend dev server.
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3002;
const SPACETIME_URL = process.env.SPACETIME_URL || 'http://localhost:3001';
const MODULES_DIR = path.resolve(__dirname, '../../');
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const BACKUPS_DIR = path.resolve(__dirname, 'backups');
const JWT_SECRET = process.env.JWT_SECRET || 'spacetime-control-plane-' + randomUUID().slice(0, 8);

// Ensure directories exist
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));

// File upload config
const upload = multer({
    storage: multer.diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req, file, cb) => {
            const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            cb(null, `${unique}-${file.originalname}`);
        },
    }),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ─────────────────────────────────────────────────────────────
// Tenant / Module Management
// ─────────────────────────────────────────────────────────────

// In-memory tenant registry (persists to file)
const REGISTRY_PATH = path.resolve(__dirname, 'tenants.json');
let tenants = [];
if (existsSync(REGISTRY_PATH)) {
    tenants = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
}
function saveTenants() {
    writeFileSync(REGISTRY_PATH, JSON.stringify(tenants, null, 2));
}

// List all tenants
app.get('/api/tenants', (_req, res) => {
    res.json(tenants);
});

// Create a new tenant (scaffold a SpacetimeDB module)
app.post('/api/tenants', async (req, res) => {
    const { name, description, template } = req.body;
    if (!name || !/^[a-z0-9-]+$/.test(name)) {
        return res.status(400).json({ error: 'Name must be lowercase alphanumeric with hyphens' });
    }

    if (tenants.find(t => t.name === name)) {
        return res.status(409).json({ error: 'Tenant already exists' });
    }

    const moduleDir = path.resolve(MODULES_DIR, name);
    if (existsSync(moduleDir)) {
        return res.status(409).json({ error: 'Directory already exists' });
    }

    try {
        // Scaffold using spacetime init
        await execAsync(`spacetime init --lang typescript "${moduleDir}"`, {
            env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
        });

        const tenant = {
            id: `${name}-${Date.now().toString(36)}`,
            name,
            description: description || '',
            template: template || 'blank',
            moduleDir,
            database: null,
            status: 'created',
            createdAt: new Date().toISOString(),
            lastDeployedAt: null,
            deployHistory: [],
        };

        tenants.push(tenant);
        saveTenants();
        res.status(201).json(tenant);
    } catch (err) {
        res.status(500).json({ error: `Failed to scaffold: ${err.message}` });
    }
});

// Register an existing module as a tenant
app.post('/api/tenants/register', (req, res) => {
    const { name, moduleDir, database } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    if (tenants.find(t => t.name === name)) {
        return res.status(409).json({ error: 'Already registered' });
    }

    const tenant = {
        id: `${name}-${Date.now().toString(36)}`,
        name,
        description: '',
        moduleDir: moduleDir || null,
        database: database || null,
        status: database ? 'deployed' : 'created',
        createdAt: new Date().toISOString(),
        lastDeployedAt: database ? new Date().toISOString() : null,
        deployHistory: [],
    };

    tenants.push(tenant);
    saveTenants();
    res.status(201).json(tenant);
});

// Update tenant
app.patch('/api/tenants/:id', (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const { description, status, database } = req.body;
    if (description !== undefined) tenant.description = description;
    if (status !== undefined) tenant.status = status;
    if (database !== undefined) tenant.database = database;
    saveTenants();
    res.json(tenant);
});

// Delete tenant
app.delete('/api/tenants/:id', (req, res) => {
    const idx = tenants.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Tenant not found' });

    const tenant = tenants[idx];
    tenants.splice(idx, 1);
    saveTenants();
    res.json({ deleted: tenant.name });
});

// ─────────────────────────────────────────────────────────────
// Deploy
// ─────────────────────────────────────────────────────────────

app.post('/api/tenants/:id/deploy', async (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (!tenant.moduleDir) return res.status(400).json({ error: 'No module directory set' });

    tenant.status = 'deploying';
    saveTenants();

    try {
        // Install deps if needed
        const pkgDir = path.join(tenant.moduleDir, 'spacetimedb');
        if (existsSync(path.join(pkgDir, 'package.json')) && !existsSync(path.join(pkgDir, 'node_modules'))) {
            await execAsync('npm install', { cwd: pkgDir });
        }

        // Use existing database name if we know it, otherwise create new
        const publishName = tenant.database || tenant.name;
        const { stdout, stderr } = await execAsync(
            `spacetime publish ${publishName} --server ${SPACETIME_URL}`,
            {
                cwd: tenant.moduleDir,
                env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
                timeout: 60000,
            }
        );

        const output = stdout + stderr;

        // Try to extract the assigned database name from output
        // SpacetimeDB outputs lines like: "Created new database with name: test-module-abc12"
        // or "Updated database test-module-abc12"
        const nameMatch = output.match(/(?:name|database)[:\s]+(\S+-[a-z0-9]+)/i);
        if (nameMatch && !tenant.database) {
            tenant.database = nameMatch[1];
        }
        if (!tenant.database) tenant.database = publishName;

        tenant.status = 'deployed';
        tenant.lastDeployedAt = new Date().toISOString();
        tenant.deployHistory.push({
            timestamp: new Date().toISOString(),
            success: true,
            output: output.slice(0, 500),
        });
        saveTenants();

        res.json({ success: true, output, database: tenant.database });
    } catch (err) {
        tenant.status = 'error';
        tenant.deployHistory.push({
            timestamp: new Date().toISOString(),
            success: false,
            error: err.message.slice(0, 500),
        });
        saveTenants();
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// Logs
// ─────────────────────────────────────────────────────────────

app.get('/api/tenants/:id/logs', async (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (!tenant.database) return res.status(400).json({ error: 'Not deployed yet' });

    const lines = parseInt(req.query.lines) || 100;

    try {
        const { stdout } = await execAsync(
            `spacetime logs ${tenant.database} -n ${lines} --server ${SPACETIME_URL}`,
            {
                env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
                timeout: 10000,
            }
        );
        res.json({ logs: stdout });
    } catch (err) {
        // Logs might not be available — return what we have
        res.json({ logs: err.stdout || `Log retrieval failed: ${err.message}`, error: err.message });
    }
});

// Stream logs via SSE
app.get('/api/tenants/:id/logs/stream', (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant || !tenant.database) {
        return res.status(400).json({ error: 'Tenant not found or not deployed' });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });

    const proc = spawn('spacetime', ['logs', tenant.database, '-f', '--server', SPACETIME_URL], {
        env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
    });

    proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
            res.write(`data: ${JSON.stringify({ line, timestamp: new Date().toISOString() })}\n\n`);
        }
    });

    proc.stderr.on('data', (data) => {
        res.write(`data: ${JSON.stringify({ error: data.toString() })}\n\n`);
    });

    proc.on('close', () => {
        res.write('data: {"done":true}\n\n');
        res.end();
    });

    req.on('close', () => {
        proc.kill();
    });
});

// ─────────────────────────────────────────────────────────────
// File Uploads
// ─────────────────────────────────────────────────────────────

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const fileInfo = {
        id: path.parse(req.file.filename).name,
        originalName: req.file.originalname,
        filename: req.file.filename,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        url: `http://localhost:${PORT}/uploads/${req.file.filename}`,
        uploadedAt: new Date().toISOString(),
    };

    res.json(fileInfo);
});

app.get('/api/files', (_req, res) => {
    const files = readdirSync(UPLOADS_DIR).map(f => {
        const full = path.join(UPLOADS_DIR, f);
        const stat = existsSync(full) ? statSync(full) : null;
        return {
            filename: f,
            url: `http://localhost:${PORT}/uploads/${f}`,
            sizeBytes: stat?.size || 0,
        };
    });
    res.json(files);
});

// ─────────────────────────────────────────────────────────────
// Monitoring & Stats
// ─────────────────────────────────────────────────────────────

// Get stats for a specific tenant via SpacetimeDB HTTP API
app.get('/api/tenants/:id/stats', async (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (!tenant.database) return res.status(400).json({ error: 'Not deployed' });

    try {
        // Get schema
        const schemaRes = await fetch(`${SPACETIME_URL}/v1/database/${tenant.database}/schema?expand=true`, {
            signal: AbortSignal.timeout(5000),
        });

        let tables = 0, reducers = 0, totalRows = 0, tableDetails = [];

        if (schemaRes.ok) {
            const schema = await schemaRes.json();
            const typespace = schema?.typespace;
            if (typespace) {
                // Count tables and reducers from schema
                tables = typespace.tables?.length || 0;
                reducers = typespace.reducers?.length || 0;

                // Query each table for row count
                for (const table of (typespace.tables || [])) {
                    try {
                        const sqlRes = await fetch(`${SPACETIME_URL}/v1/database/${tenant.database}/sql`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: `SELECT count(*) FROM ${table.name}`,
                            signal: AbortSignal.timeout(3000),
                        });
                        if (sqlRes.ok) {
                            const rows = await sqlRes.json();
                            const count = rows?.[0]?.rows?.[0]?.[0] || 0;
                            totalRows += count;
                            tableDetails.push({ name: table.name, rows: count, columns: table.columns?.length || 0 });
                        } else {
                            tableDetails.push({ name: table.name, rows: 0, columns: table.columns?.length || 0 });
                        }
                    } catch {
                        tableDetails.push({ name: table.name, rows: '?', columns: table.columns?.length || 0 });
                    }
                }
            }
        }

        res.json({
            database: tenant.database,
            tables,
            reducers,
            totalRows,
            tableDetails,
            status: tenant.status,
            lastDeployedAt: tenant.lastDeployedAt,
            deployCount: tenant.deployHistory.length,
            successfulDeploys: tenant.deployHistory.filter(d => d.success).length,
            failedDeploys: tenant.deployHistory.filter(d => !d.success).length,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Aggregate overview for all tenants
app.get('/api/monitoring/overview', async (_req, res) => {
    const deployed = tenants.filter(t => t.status === 'deployed' && t.database);
    const overview = {
        totalTenants: tenants.length,
        deployedTenants: deployed.length,
        errorTenants: tenants.filter(t => t.status === 'error').length,
        totalDeploys: tenants.reduce((sum, t) => sum + t.deployHistory.length, 0),
        recentDeploys: tenants
            .flatMap(t => t.deployHistory.map(d => ({ ...d, tenant: t.name })))
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 10),
        tenantSummaries: [],
    };

    // Fetch quick stats for each deployed tenant
    for (const t of deployed) {
        try {
            const schemaRes = await fetch(`${SPACETIME_URL}/v1/database/${t.database}/schema?expand=true`, {
                signal: AbortSignal.timeout(3000),
            });
            if (schemaRes.ok) {
                const schema = await schemaRes.json();
                const typespace = schema?.typespace;
                overview.tenantSummaries.push({
                    name: t.name,
                    database: t.database,
                    tables: typespace?.tables?.length || 0,
                    reducers: typespace?.reducers?.length || 0,
                    status: 'online',
                    lastDeployed: t.lastDeployedAt,
                });
            } else {
                overview.tenantSummaries.push({ name: t.name, database: t.database, status: 'unreachable' });
            }
        } catch {
            overview.tenantSummaries.push({ name: t.name, database: t.database, status: 'unreachable' });
        }
    }

    res.json(overview);
});

// Schema snapshot — capture schema at deploy time for migration tracking
app.get('/api/tenants/:id/schema-snapshot', async (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant?.database) return res.status(400).json({ error: 'Not deployed' });

    try {
        const schemaRes = await fetch(`${SPACETIME_URL}/v1/database/${tenant.database}/schema?expand=true`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!schemaRes.ok) return res.status(502).json({ error: 'Could not fetch schema' });

        const schema = await schemaRes.json();

        // Save snapshot
        const snapshotsDir = path.resolve(__dirname, 'snapshots', tenant.name);
        if (!existsSync(snapshotsDir)) mkdirSync(snapshotsDir, { recursive: true });
        const filename = `schema-${Date.now()}.json`;
        writeFileSync(path.join(snapshotsDir, filename), JSON.stringify(schema, null, 2));

        // List all snapshots for this tenant
        const snapshots = readdirSync(snapshotsDir)
            .filter(f => f.startsWith('schema-'))
            .sort()
            .reverse();

        res.json({ current: schema, snapshots, saved: filename });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Compare two schema snapshots
app.get('/api/tenants/:id/schema-diff', async (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const snapshotsDir = path.resolve(__dirname, 'snapshots', tenant.name);
    if (!existsSync(snapshotsDir)) return res.json({ diffs: [], snapshots: [] });

    const snapshots = readdirSync(snapshotsDir).filter(f => f.startsWith('schema-')).sort().reverse();
    if (snapshots.length < 2) return res.json({ diffs: [], snapshots, message: 'Need at least 2 snapshots' });

    const current = JSON.parse(readFileSync(path.join(snapshotsDir, snapshots[0]), 'utf-8'));
    const previous = JSON.parse(readFileSync(path.join(snapshotsDir, snapshots[1]), 'utf-8'));

    // Simple diff: compare table names and column counts
    const currTables = (current?.typespace?.tables || []).map(t => ({ name: t.name, cols: t.columns?.length || 0 }));
    const prevTables = (previous?.typespace?.tables || []).map(t => ({ name: t.name, cols: t.columns?.length || 0 }));

    const diffs = [];
    for (const ct of currTables) {
        const pt = prevTables.find(p => p.name === ct.name);
        if (!pt) diffs.push({ type: 'added', table: ct.name, columns: ct.cols });
        else if (pt.cols !== ct.cols) diffs.push({ type: 'modified', table: ct.name, before: pt.cols, after: ct.cols });
    }
    for (const pt of prevTables) {
        if (!currTables.find(c => c.name === pt.name)) diffs.push({ type: 'removed', table: pt.name });
    }

    res.json({ diffs, snapshots: snapshots.slice(0, 5) });
});

// ─────────────────────────────────────────────────────────────
// System
// ─────────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
    let spacetimeOk = false;
    try {
        const r = await fetch(`${SPACETIME_URL}/v1/identity`, { method: 'POST', signal: AbortSignal.timeout(3000) });
        spacetimeOk = r.ok || r.status === 401 || r.status === 405;
    } catch { /* ignore */ }

    res.json({
        status: 'ok',
        spacetimedb: spacetimeOk ? 'connected' : 'unreachable',
        spacetimeUrl: SPACETIME_URL,
        tenantCount: tenants.length,
        deployedCount: tenants.filter(t => t.status === 'deployed').length,
    });
});

// Discover existing modules in the workspace
app.get('/api/discover', (_req, res) => {
    const discovered = [];
    try {
        const dirs = readdirSync(MODULES_DIR, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

        for (const dir of dirs) {
            const spacetimeJson = path.join(MODULES_DIR, dir, 'spacetime.json');
            const stdbDir = path.join(MODULES_DIR, dir, 'spacetimedb');
            if (existsSync(spacetimeJson) || existsSync(stdbDir)) {
                const alreadyRegistered = tenants.find(t => t.name === dir);
                discovered.push({
                    name: dir,
                    moduleDir: path.join(MODULES_DIR, dir),
                    hasSpacetimeJson: existsSync(spacetimeJson),
                    hasSpacetimeDb: existsSync(stdbDir),
                    registered: !!alreadyRegistered,
                });
            }
        }
    } catch { /* ignore */ }

    res.json(discovered);
});

// ─────────────────────────────────────────────────────────────
// Auth & Identity
// ─────────────────────────────────────────────────────────────

// API keys registry (persists to file)
const KEYS_PATH = path.resolve(__dirname, 'api-keys.json');
let apiKeys = [];
if (existsSync(KEYS_PATH)) apiKeys = JSON.parse(readFileSync(KEYS_PATH, 'utf-8'));
function saveKeys() { writeFileSync(KEYS_PATH, JSON.stringify(apiKeys, null, 2)); }

// Login (simple — returns JWT)
app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;
    const adminPass = process.env.ADMIN_PASSWORD || 'spacetime';
    if (password !== adminPass) {
        return res.status(401).json({ error: 'Invalid password' });
    }
    const token = jwt.sign({ role: 'admin', iat: Date.now() }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, expiresIn: '24h' });
});

// Verify token
app.get('/api/auth/verify', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ valid: false });
    try {
        const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
        res.json({ valid: true, role: decoded.role });
    } catch {
        res.status(401).json({ valid: false });
    }
});

// Generate API key
app.post('/api/auth/keys', (req, res) => {
    const { name, scopes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    const key = {
        id: randomUUID(),
        name,
        key: `stcp_${randomUUID().replace(/-/g, '')}`,
        scopes: scopes || ['read', 'write', 'deploy'],
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        active: true,
    };

    apiKeys.push(key);
    saveKeys();
    res.status(201).json(key);
});

// List API keys
app.get('/api/auth/keys', (_req, res) => {
    // Mask the actual key value for security
    const masked = apiKeys.map(k => ({
        ...k,
        key: k.key.slice(0, 8) + '...' + k.key.slice(-4),
    }));
    res.json(masked);
});

// Revoke API key
app.delete('/api/auth/keys/:id', (req, res) => {
    const key = apiKeys.find(k => k.id === req.params.id);
    if (!key) return res.status(404).json({ error: 'Key not found' });
    key.active = false;
    saveKeys();
    res.json({ revoked: key.name });
});

// Validate API key (middleware helper endpoint)
app.post('/api/auth/validate-key', (req, res) => {
    const { apiKey } = req.body;
    const found = apiKeys.find(k => k.key === apiKey && k.active);
    if (!found) return res.status(401).json({ valid: false });
    found.lastUsedAt = new Date().toISOString();
    saveKeys();
    res.json({ valid: true, name: found.name, scopes: found.scopes });
});

// ─────────────────────────────────────────────────────────────
// Backup & Restore
// ─────────────────────────────────────────────────────────────

// Export all data from a tenant's tables
app.post('/api/tenants/:id/backup', async (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant?.database) return res.status(400).json({ error: 'Not deployed' });

    try {
        // Get schema to find tables
        const schemaRes = await fetch(`${SPACETIME_URL}/v1/database/${tenant.database}/schema?expand=true`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!schemaRes.ok) return res.status(502).json({ error: 'Could not fetch schema' });

        const schema = await schemaRes.json();
        const tables = schema?.typespace?.tables || [];

        const backup = {
            version: 1,
            tenant: tenant.name,
            database: tenant.database,
            timestamp: new Date().toISOString(),
            tables: {},
            schema: schema,
        };

        // Export each table's data
        for (const table of tables) {
            try {
                const sqlRes = await fetch(`${SPACETIME_URL}/v1/database/${tenant.database}/sql`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: `SELECT * FROM ${table.name}`,
                    signal: AbortSignal.timeout(10000),
                });
                if (sqlRes.ok) {
                    backup.tables[table.name] = await sqlRes.json();
                }
            } catch { /* skip table */ }
        }

        // Save to disk
        const tenantBackupDir = path.join(BACKUPS_DIR, tenant.name);
        if (!existsSync(tenantBackupDir)) mkdirSync(tenantBackupDir, { recursive: true });

        const filename = `backup-${Date.now()}.json`;
        writeFileSync(path.join(tenantBackupDir, filename), JSON.stringify(backup, null, 2));

        res.json({
            success: true,
            filename,
            tables: Object.keys(backup.tables).length,
            sizeBytes: JSON.stringify(backup).length,
            timestamp: backup.timestamp,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List backups for a tenant
app.get('/api/tenants/:id/backups', (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const dir = path.join(BACKUPS_DIR, tenant.name);
    if (!existsSync(dir)) return res.json([]);

    const backups = readdirSync(dir)
        .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
        .map(f => {
            const stat = statSync(path.join(dir, f));
            return {
                filename: f,
                sizeBytes: stat.size,
                createdAt: stat.birthtime.toISOString(),
            };
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(backups);
});

// Download a specific backup
app.get('/api/tenants/:id/backups/:filename', (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const filepath = path.join(BACKUPS_DIR, tenant.name, req.params.filename);
    if (!existsSync(filepath)) return res.status(404).json({ error: 'Backup not found' });

    res.setHeader('Content-Disposition', `attachment; filename=${req.params.filename}`);
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(filepath);
});

// Restore from backup (re-insert data via reducers/SQL)
app.post('/api/tenants/:id/restore/:filename', async (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant?.database) return res.status(400).json({ error: 'Not deployed' });

    const filepath = path.join(BACKUPS_DIR, tenant.name, req.params.filename);
    if (!existsSync(filepath)) return res.status(404).json({ error: 'Backup not found' });

    try {
        const backup = JSON.parse(readFileSync(filepath, 'utf-8'));
        const results = { restored: [], errors: [] };

        for (const [tableName, data] of Object.entries(backup.tables)) {
            try {
                // Use SQL INSERT for each row
                const rows = data?.[0]?.rows || [];
                for (const row of rows) {
                    const values = row.map(v =>
                        typeof v === 'string' ? `'${v.replace(/'/g, "''")}' ` : v
                    ).join(', ');
                    await fetch(`${SPACETIME_URL}/v1/database/${tenant.database}/sql`, {
                        method: 'POST',
                        body: `INSERT INTO ${tableName} VALUES (${values})`,
                        signal: AbortSignal.timeout(5000),
                    });
                }
                results.restored.push({ table: tableName, rows: rows.length });
            } catch (err) {
                results.errors.push({ table: tableName, error: err.message });
            }
        }

        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`Control Plane backend running on http://localhost:${PORT}`);
    console.log(`SpacetimeDB: ${SPACETIME_URL}`);
    console.log(`Modules dir: ${MODULES_DIR}`);
    console.log(`Tenants: ${tenants.length} registered`);
    console.log(`API Keys: ${apiKeys.filter(k => k.active).length} active`);
    console.log(`JWT Secret: ${JWT_SECRET.slice(0, 12)}...`);
});
