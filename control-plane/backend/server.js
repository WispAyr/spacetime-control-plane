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
// Row-Level Security (RLS) Policies
// ─────────────────────────────────────────────────────────────

// Policy registry (persists to file)
const POLICIES_PATH = path.resolve(__dirname, 'rls-policies.json');
let rlsPolicies = [];
if (existsSync(POLICIES_PATH)) rlsPolicies = JSON.parse(readFileSync(POLICIES_PATH, 'utf-8'));
function savePolicies() { writeFileSync(POLICIES_PATH, JSON.stringify(rlsPolicies, null, 2)); }

// List policies for a tenant
app.get('/api/tenants/:id/policies', (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const policies = rlsPolicies.filter(p => p.tenantId === tenant.id);
    res.json(policies);
});

// Create a policy
app.post('/api/tenants/:id/policies', (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const { table, operation, condition, description, enforcement } = req.body;
    if (!table || !operation) return res.status(400).json({ error: 'table and operation required' });

    const policy = {
        id: randomUUID(),
        tenantId: tenant.id,
        tenantName: tenant.name,
        table,
        operation, // 'read' | 'insert' | 'update' | 'delete' | 'all'
        condition: condition || 'owner_id == ctx.sender', // SpacetimeDB identity check
        description: description || '',
        enforcement: enforcement || 'enforced', // 'enforced' | 'permissive' | 'disabled'
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    rlsPolicies.push(policy);
    savePolicies();
    res.status(201).json(policy);
});

// Update a policy
app.patch('/api/tenants/:id/policies/:policyId', (req, res) => {
    const policy = rlsPolicies.find(p => p.id === req.params.policyId);
    if (!policy) return res.status(404).json({ error: 'Policy not found' });

    const { condition, description, enforcement, operation } = req.body;
    if (condition !== undefined) policy.condition = condition;
    if (description !== undefined) policy.description = description;
    if (enforcement !== undefined) policy.enforcement = enforcement;
    if (operation !== undefined) policy.operation = operation;
    policy.updatedAt = new Date().toISOString();
    savePolicies();
    res.json(policy);
});

// Delete a policy
app.delete('/api/tenants/:id/policies/:policyId', (req, res) => {
    const idx = rlsPolicies.findIndex(p => p.id === req.params.policyId);
    if (idx === -1) return res.status(404).json({ error: 'Policy not found' });
    rlsPolicies.splice(idx, 1);
    savePolicies();
    res.json({ deleted: true });
});

// Generate SpacetimeDB reducer guard code from policies
app.get('/api/tenants/:id/policies/codegen', (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const policies = rlsPolicies.filter(p => p.tenantId === tenant.id && p.enforcement === 'enforced');

    if (policies.length === 0) {
        return res.json({ code: '// No enforced RLS policies defined', policies: 0 });
    }

    // Group by table
    const byTable = {};
    for (const p of policies) {
        if (!byTable[p.table]) byTable[p.table] = [];
        byTable[p.table].push(p);
    }

    let code = `// Auto-generated RLS guards for ${tenant.name}\n`;
    code += `// Generated: ${new Date().toISOString()}\n`;
    code += `// Policies: ${policies.length}\n\n`;
    code += `import { ReducerContext, Identity } from "@clockworklabs/spacetimedb-sdk";\n\n`;

    for (const [table, tablePolicies] of Object.entries(byTable)) {
        const className = table.charAt(0).toUpperCase() + table.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase());

        code += `// ─── ${table} policies ───\n`;

        for (const policy of tablePolicies) {
            const fnName = `check_${table}_${policy.operation}`;
            const ops = policy.operation === 'all' ? ['read', 'insert', 'update', 'delete'] : [policy.operation];

            for (const op of ops) {
                code += `\n/**\n * RLS: ${policy.description || `${op} guard on ${table}`}\n`;
                code += ` * Condition: ${policy.condition}\n */\n`;
                code += `function guard_${table}_${op}(ctx: ReducerContext, row: ${className}): boolean {\n`;
                code += `    return ${policy.condition.replace(/ctx\.sender/g, 'ctx.sender')};\n`;
                code += `}\n`;
            }
        }
        code += `\n`;
    }

    // Add middleware-style wrapper
    code += `// ─── RLS middleware ───\n`;
    code += `function enforceRLS(ctx: ReducerContext, table: string, operation: string, row: any): boolean {\n`;
    code += `    const guards: Record<string, Record<string, (ctx: ReducerContext, row: any) => boolean>> = {\n`;

    for (const [table, tablePolicies] of Object.entries(byTable)) {
        code += `        "${table}": {\n`;
        for (const policy of tablePolicies) {
            const ops = policy.operation === 'all' ? ['read', 'insert', 'update', 'delete'] : [policy.operation];
            for (const op of ops) {
                code += `            "${op}": guard_${table}_${op},\n`;
            }
        }
        code += `        },\n`;
    }

    code += `    };\n`;
    code += `    const guard = guards[table]?.[operation];\n`;
    code += `    if (!guard) return true; // No policy = allow\n`;
    code += `    return guard(ctx, row);\n`;
    code += `}\n`;

    res.json({ code, policies: policies.length, tables: Object.keys(byTable).length });
});

// List all policies across all tenants
app.get('/api/policies', (_req, res) => {
    res.json(rlsPolicies);
});

// ─────────────────────────────────────────────────────────────
// Webhooks & Notifications
// ─────────────────────────────────────────────────────────────

const WEBHOOKS_PATH = path.resolve(__dirname, 'webhooks.json');
let webhooks = [];
if (existsSync(WEBHOOKS_PATH)) webhooks = JSON.parse(readFileSync(WEBHOOKS_PATH, 'utf-8'));
function saveWebhooks() { writeFileSync(WEBHOOKS_PATH, JSON.stringify(webhooks, null, 2)); }

// Register webhook
app.post('/api/webhooks', (req, res) => {
    const { url, events, name } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const webhook = {
        id: randomUUID(),
        name: name || 'webhook',
        url,
        events: events || ['deploy.success', 'deploy.failure', 'tenant.created', 'tenant.deleted'],
        createdAt: new Date().toISOString(),
        lastTriggered: null,
        triggerCount: 0,
        active: true,
    };
    webhooks.push(webhook);
    saveWebhooks();
    res.status(201).json(webhook);
});

// List webhooks
app.get('/api/webhooks', (_req, res) => {
    res.json(webhooks.map(w => ({ ...w, url: w.url.slice(0, 30) + '...' })));
});

// Delete webhook
app.delete('/api/webhooks/:id', (req, res) => {
    const idx = webhooks.findIndex(w => w.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    webhooks.splice(idx, 1);
    saveWebhooks();
    res.json({ deleted: true });
});

// Toggle webhook
app.patch('/api/webhooks/:id', (req, res) => {
    const wh = webhooks.find(w => w.id === req.params.id);
    if (!wh) return res.status(404).json({ error: 'Not found' });
    if (req.body.active !== undefined) wh.active = req.body.active;
    if (req.body.events) wh.events = req.body.events;
    saveWebhooks();
    res.json(wh);
});

// Test webhook
app.post('/api/webhooks/:id/test', async (req, res) => {
    const wh = webhooks.find(w => w.id === req.params.id);
    if (!wh) return res.status(404).json({ error: 'Not found' });

    try {
        const testRes = await fetch(wh.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event: 'test',
                timestamp: new Date().toISOString(),
                source: 'spacetime-control-plane',
                data: { message: 'Webhook test from Spacetime Control Plane' },
            }),
            signal: AbortSignal.timeout(5000),
        });
        res.json({ success: testRes.ok, status: testRes.status });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Fire webhook (internal helper)
async function fireWebhooks(event, data) {
    const active = webhooks.filter(w => w.active && w.events.includes(event));
    for (const wh of active) {
        try {
            await fetch(wh.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event,
                    timestamp: new Date().toISOString(),
                    source: 'spacetime-control-plane',
                    data,
                }),
                signal: AbortSignal.timeout(5000),
            });
            wh.lastTriggered = new Date().toISOString();
            wh.triggerCount++;
        } catch { /* ignore failed webhooks */ }
    }
    saveWebhooks();
}

// ─────────────────────────────────────────────────────────────
// Dashboard Overview (aggregate everything)
// ─────────────────────────────────────────────────────────────

app.get('/api/dashboard', async (_req, res) => {
    const deployed = tenants.filter(t => t.status === 'deployed');
    const totalDeploys = tenants.reduce((sum, t) => sum + (t.deployHistory?.length || 0), 0);
    const recentDeploys = tenants
        .flatMap(t => (t.deployHistory || []).map(d => ({ ...d, tenant: t.name })))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);

    // System uptime and health
    const systemHealth = {
        backend: 'healthy',
        spacetimedb: 'unknown',
        uptime: process.uptime(),
    };

    try {
        const pingRes = await fetch(`${SPACETIME_URL}/v1/identity`, {
            method: 'POST',
            signal: AbortSignal.timeout(3000),
        });
        systemHealth.spacetimedb = (pingRes.ok || pingRes.status === 401 || pingRes.status === 405) ? 'healthy' : 'unreachable';
    } catch {
        systemHealth.spacetimedb = 'unreachable';
    }

    // Quick stats per tenant
    const tenantQuickStats = await Promise.all(deployed.map(async (t) => {
        try {
            const schemaRes = await fetch(
                `${SPACETIME_URL}/v1/database/${encodeURIComponent(t.database)}/schema?version=9`,
                { signal: AbortSignal.timeout(3000) }
            );
            if (!schemaRes.ok) return { name: t.name, database: t.database, tables: 0, reducers: 0, status: 'error' };
            const raw = await schemaRes.json();
            return {
                name: t.name,
                database: t.database,
                tables: (raw.tables || []).length,
                reducers: (raw.reducers || []).filter(r => !r.lifecycle || typeof r.lifecycle !== 'object').length,
                status: 'online',
            };
        } catch {
            return { name: t.name, database: t.database, tables: 0, reducers: 0, status: 'error' };
        }
    }));

    res.json({
        system: systemHealth,
        tenants: {
            total: tenants.length,
            deployed: deployed.length,
            errors: tenants.filter(t => t.status === 'error').length,
        },
        deploys: {
            total: totalDeploys,
            recent: recentDeploys,
            successRate: totalDeploys > 0
                ? (recentDeploys.filter(d => d.success).length / Math.max(recentDeploys.length, 1) * 100).toFixed(0) + '%'
                : 'N/A',
        },
        security: {
            activeApiKeys: apiKeys.filter(k => k.active).length,
            rlsPolicies: rlsPolicies.length,
            enforcedPolicies: rlsPolicies.filter(p => p.enforcement === 'enforced').length,
        },
        webhooks: {
            active: webhooks.filter(w => w.active).length,
            total: webhooks.length,
        },
        tenantStats: tenantQuickStats,
    });
});

// ─────────────────────────────────────────────────────────────
// Work Orchestration — Workers, Tasks, Goals, Activity
// ─────────────────────────────────────────────────────────────

const WORKERS_PATH = path.resolve(__dirname, 'workers.json');
const TASKS_PATH = path.resolve(__dirname, 'tasks.json');
const GOALS_PATH = path.resolve(__dirname, 'goals.json');
const ACTIVITY_PATH = path.resolve(__dirname, 'activity.json');

let workers = existsSync(WORKERS_PATH) ? JSON.parse(readFileSync(WORKERS_PATH, 'utf-8')) : [];
let tasks = existsSync(TASKS_PATH) ? JSON.parse(readFileSync(TASKS_PATH, 'utf-8')) : [];
let goals = existsSync(GOALS_PATH) ? JSON.parse(readFileSync(GOALS_PATH, 'utf-8')) : [];
let activityLog = existsSync(ACTIVITY_PATH) ? JSON.parse(readFileSync(ACTIVITY_PATH, 'utf-8')) : [];

function saveWorkers() { writeFileSync(WORKERS_PATH, JSON.stringify(workers, null, 2)); }
function saveTasks() { writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2)); }
function saveGoals() { writeFileSync(GOALS_PATH, JSON.stringify(goals, null, 2)); }
function saveActivity() { writeFileSync(ACTIVITY_PATH, JSON.stringify(activityLog, null, 2)); }

function logActivity(workerId, action, targetType, targetId, details) {
    const worker = workers.find(w => w.id === workerId);
    const entry = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        workerId,
        workerName: worker?.name || 'system',
        workerType: worker?.type || 'system',
        action,
        targetType,
        targetId,
        details,
    };
    activityLog.unshift(entry);
    if (activityLog.length > 500) activityLog = activityLog.slice(0, 500);
    saveActivity();
    fireWebhooks(`work.${action}`, entry);
    return entry;
}

function recalcGoalProgress(goalId) {
    const goalTasks = tasks.filter(t => t.goalId === goalId);
    if (goalTasks.length === 0) return;
    const done = goalTasks.filter(t => t.status === 'done').length;
    const goal = goals.find(g => g.id === goalId);
    if (goal) {
        goal.progress = Math.round((done / goalTasks.length) * 100);
        if (goal.progress === 100) goal.status = 'completed';
        saveGoals();
    }
}

// ── Workers ──────────────────────────────────────────────────

// Register worker (human or AI — equal)
app.post('/api/workers', (req, res) => {
    const { name, type } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    if (!['human', 'ai'].includes(type)) return res.status(400).json({ error: 'Type must be "human" or "ai"' });

    const worker = {
        id: randomUUID(),
        name,
        type,
        status: 'active',
        lastSeen: new Date().toISOString(),
        tasksCompleted: 0,
        currentTaskId: null,
        createdAt: new Date().toISOString(),
    };
    workers.push(worker);
    saveWorkers();
    logActivity(worker.id, 'worker.registered', 'worker', worker.id, `${name} (${type}) joined`);
    res.status(201).json(worker);
});

// List workers
app.get('/api/workers', (_req, res) => {
    res.json(workers.map(w => ({
        ...w,
        currentTask: w.currentTaskId ? tasks.find(t => t.id === w.currentTaskId)?.title || null : null,
    })));
});

// Update worker (heartbeat, status)
app.patch('/api/workers/:id', (req, res) => {
    const worker = workers.find(w => w.id === req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    if (req.body.status) worker.status = req.body.status;
    worker.lastSeen = new Date().toISOString();
    saveWorkers();
    res.json(worker);
});

// Deregister worker
app.delete('/api/workers/:id', (req, res) => {
    const idx = workers.findIndex(w => w.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    // Release any claimed tasks
    const worker = workers[idx];
    tasks.filter(t => t.claimedBy === worker.id).forEach(t => {
        t.claimedBy = null;
        t.claimedAt = null;
        if (t.status === 'claimed' || t.status === 'in_progress') t.status = 'backlog';
    });
    saveTasks();

    logActivity(worker.id, 'worker.removed', 'worker', worker.id, `${worker.name} left`);
    workers.splice(idx, 1);
    saveWorkers();
    res.json({ deleted: true });
});

// ── Tasks (atomic claims) ────────────────────────────────────

// Create task
app.post('/api/tasks', (req, res) => {
    const { title, description, goalId, tenantId, priority, createdBy } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    if (!createdBy) return res.status(400).json({ error: 'createdBy (worker ID) required' });

    const task = {
        id: randomUUID(),
        title,
        description: description || '',
        goalId: goalId || null,
        tenantId: tenantId || null,
        status: 'backlog',
        priority: priority || 'medium',
        claimedBy: null,
        claimedAt: null,
        completedBy: null,
        completedAt: null,
        output: null,
        createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    tasks.push(task);
    saveTasks();
    logActivity(createdBy, 'task.created', 'task', task.id, `Created: ${title}`);
    res.status(201).json(task);
});

// List tasks (with filters)
app.get('/api/tasks', (req, res) => {
    let result = [...tasks];
    if (req.query.status) result = result.filter(t => t.status === req.query.status);
    if (req.query.goalId) result = result.filter(t => t.goalId === req.query.goalId);
    if (req.query.claimedBy) result = result.filter(t => t.claimedBy === req.query.claimedBy);
    if (req.query.tenantId) result = result.filter(t => t.tenantId === req.query.tenantId);

    // Enrich with worker names
    result = result.map(t => ({
        ...t,
        claimedByName: t.claimedBy ? workers.find(w => w.id === t.claimedBy)?.name || null : null,
        createdByName: workers.find(w => w.id === t.createdBy)?.name || 'unknown',
    }));

    res.json(result);
});

// Get single task
app.get('/api/tasks/:id', (req, res) => {
    const task = tasks.find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json({
        ...task,
        claimedByName: task.claimedBy ? workers.find(w => w.id === task.claimedBy)?.name || null : null,
        createdByName: workers.find(w => w.id === task.createdBy)?.name || 'unknown',
    });
});

// ATOMIC CLAIM — the core anti-overlap mechanism
app.post('/api/tasks/:id/claim', (req, res) => {
    const { workerId } = req.body;
    if (!workerId) return res.status(400).json({ error: 'workerId required' });

    const task = tasks.find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const worker = workers.find(w => w.id === workerId);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    // CONFLICT CHECK — atomic in single-threaded Node.js
    if (task.claimedBy) {
        const holder = workers.find(w => w.id === task.claimedBy);
        return res.status(409).json({
            error: 'Already claimed',
            claimedBy: { id: task.claimedBy, name: holder?.name || 'unknown', type: holder?.type || 'unknown' },
            claimedAt: task.claimedAt,
        });
    }

    // Check if worker already has a task
    if (worker.currentTaskId) {
        const currentTask = tasks.find(t => t.id === worker.currentTaskId);
        return res.status(409).json({
            error: 'Worker already has an active task',
            currentTask: { id: worker.currentTaskId, title: currentTask?.title || 'unknown' },
        });
    }

    // ATOMIC SET
    const now = new Date().toISOString();
    task.claimedBy = workerId;
    task.claimedAt = now;
    task.status = 'claimed';
    task.updatedAt = now;
    worker.currentTaskId = task.id;
    worker.lastSeen = now;

    saveTasks();
    saveWorkers();
    logActivity(workerId, 'task.claimed', 'task', task.id, `${worker.name} claimed: ${task.title}`);

    res.json(task);
});

// Release claim
app.post('/api/tasks/:id/release', (req, res) => {
    const { workerId } = req.body;
    const task = tasks.find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (task.claimedBy !== workerId) {
        return res.status(403).json({ error: 'Only the claimer can release' });
    }

    const worker = workers.find(w => w.id === workerId);
    task.claimedBy = null;
    task.claimedAt = null;
    task.status = 'backlog';
    task.updatedAt = new Date().toISOString();
    if (worker) { worker.currentTaskId = null; worker.lastSeen = new Date().toISOString(); }

    saveTasks();
    saveWorkers();
    logActivity(workerId, 'task.released', 'task', task.id, `${worker?.name || 'unknown'} released: ${task.title}`);

    res.json(task);
});

// Move to in_progress
app.post('/api/tasks/:id/start', (req, res) => {
    const { workerId } = req.body;
    const task = tasks.find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.claimedBy !== workerId) return res.status(403).json({ error: 'Only the claimer can start' });

    task.status = 'in_progress';
    task.updatedAt = new Date().toISOString();
    saveTasks();
    logActivity(workerId, 'task.started', 'task', task.id, `Started: ${task.title}`);
    res.json(task);
});

// Complete task
app.post('/api/tasks/:id/complete', (req, res) => {
    const { workerId, output } = req.body;
    const task = tasks.find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.claimedBy !== workerId) return res.status(403).json({ error: 'Only the claimer can complete' });

    const now = new Date().toISOString();
    task.status = 'done';
    task.completedBy = workerId;
    task.completedAt = now;
    task.output = output || null;
    task.updatedAt = now;

    const worker = workers.find(w => w.id === workerId);
    if (worker) {
        worker.currentTaskId = null;
        worker.tasksCompleted++;
        worker.lastSeen = now;
    }

    saveTasks();
    saveWorkers();
    logActivity(workerId, 'task.completed', 'task', task.id, `Completed: ${task.title}`);

    // Recalc goal progress
    if (task.goalId) recalcGoalProgress(task.goalId);

    res.json(task);
});

// Update task details
app.patch('/api/tasks/:id', (req, res) => {
    const task = tasks.find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });

    const { title, description, priority, goalId, status } = req.body;
    if (title) task.title = title;
    if (description !== undefined) task.description = description;
    if (priority) task.priority = priority;
    if (goalId !== undefined) task.goalId = goalId;
    if (status && ['backlog', 'review'].includes(status)) task.status = status;
    task.updatedAt = new Date().toISOString();

    saveTasks();
    res.json(task);
});

// ── Goals ────────────────────────────────────────────────────

// Create goal
app.post('/api/goals', (req, res) => {
    const { title, parentId, tenantId, createdBy } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });

    const goal = {
        id: randomUUID(),
        title,
        parentId: parentId || null,
        tenantId: tenantId || null,
        status: 'active',
        progress: 0,
        createdBy: createdBy || null,
        createdAt: new Date().toISOString(),
    };
    goals.push(goal);
    saveGoals();
    if (createdBy) logActivity(createdBy, 'goal.created', 'goal', goal.id, `Goal: ${title}`);
    res.status(201).json(goal);
});

// List goals (tree)
app.get('/api/goals', (_req, res) => {
    const enriched = goals.map(g => ({
        ...g,
        taskCount: tasks.filter(t => t.goalId === g.id).length,
        tasksDone: tasks.filter(t => t.goalId === g.id && t.status === 'done').length,
        children: goals.filter(c => c.parentId === g.id).map(c => c.id),
    }));
    res.json(enriched);
});

// Update goal
app.patch('/api/goals/:id', (req, res) => {
    const goal = goals.find(g => g.id === req.params.id);
    if (!goal) return res.status(404).json({ error: 'Not found' });
    if (req.body.title) goal.title = req.body.title;
    if (req.body.status) goal.status = req.body.status;
    if (req.body.parentId !== undefined) goal.parentId = req.body.parentId;
    saveGoals();
    res.json(goal);
});

// Delete goal
app.delete('/api/goals/:id', (req, res) => {
    const idx = goals.findIndex(g => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    // Unlink tasks
    tasks.filter(t => t.goalId === req.params.id).forEach(t => { t.goalId = null; });
    saveTasks();
    goals.splice(idx, 1);
    saveGoals();
    res.json({ deleted: true });
});

// ── Activity Feed ────────────────────────────────────────────

app.get('/api/activity', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    res.json({
        items: activityLog.slice(offset, offset + limit),
        total: activityLog.length,
    });
});
// ─────────────────────────────────────────────────────────────
// Schema Migrations — Auto-capture on deploy, diff, rollback
// ─────────────────────────────────────────────────────────────

const MIGRATIONS_PATH = path.resolve(__dirname, 'migrations.json');
let migrations = existsSync(MIGRATIONS_PATH) ? JSON.parse(readFileSync(MIGRATIONS_PATH, 'utf-8')) : [];
function saveMigrations() { writeFileSync(MIGRATIONS_PATH, JSON.stringify(migrations, null, 2)); }

// Auto-capture schema after successful deploy
async function captureSchemaSnapshot(tenant) {
    if (!tenant.database) return null;
    try {
        const schemaRes = await fetch(`${SPACETIME_URL}/v2/database/${tenant.database}/schema`);
        if (!schemaRes.ok) return null;
        const schemaText = await schemaRes.text();
        const schema = JSON.parse(schemaText);

        const tables = (schema.typespace?.types || schema.tables || []).filter(t => t.ty?.Product || t.name);
        const reducers = (schema.typespace?.types || schema.reducers || []).filter(r => r.ty?.Reducer || r.name);

        return { tables: tables.length, reducers: reducers.length, raw: schema };
    } catch { return null; }
}

// Hook POST /api/tenants/:id/deploy — capture migration on success
// (We wrap the existing deploy by attaching a post-deploy hook)
app.post('/api/migrations/capture/:tenantId', async (req, res) => {
    const tenant = tenants.find(t => t.id === req.params.tenantId || t.name === req.params.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const schema = await captureSchemaSnapshot(tenant);
    const prevVersion = migrations.filter(m => m.tenantId === tenant.id).length;

    const migration = {
        id: randomUUID(),
        tenantId: tenant.id,
        tenantName: tenant.name,
        version: prevVersion + 1,
        timestamp: new Date().toISOString(),
        status: 'success',
        schemaSnapshot: schema,
        deployedBy: req.body.deployedBy || null,
        notes: req.body.notes || `Deploy v${prevVersion + 1}`,
    };
    migrations.push(migration);
    saveMigrations();
    res.status(201).json(migration);
});

// List migrations
app.get('/api/migrations', (req, res) => {
    let result = [...migrations];
    if (req.query.tenantId) result = result.filter(m => m.tenantId === req.query.tenantId || m.tenantName === req.query.tenantId);
    result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json(result);
});

// Get single migration
app.get('/api/migrations/:id', (req, res) => {
    const m = migrations.find(m => m.id === req.params.id);
    if (!m) return res.status(404).json({ error: 'Migration not found' });
    res.json(m);
});

// Diff between two versions
app.get('/api/migrations/:id/diff', (req, res) => {
    const current = migrations.find(m => m.id === req.params.id);
    if (!current) return res.status(404).json({ error: 'Migration not found' });

    const tenantMigrations = migrations
        .filter(m => m.tenantId === current.tenantId)
        .sort((a, b) => a.version - b.version);

    const prevIdx = tenantMigrations.findIndex(m => m.id === current.id) - 1;
    const prev = prevIdx >= 0 ? tenantMigrations[prevIdx] : null;

    const currentTables = current.schemaSnapshot?.tables || 0;
    const currentReducers = current.schemaSnapshot?.reducers || 0;
    const prevTables = prev?.schemaSnapshot?.tables || 0;
    const prevReducers = prev?.schemaSnapshot?.reducers || 0;

    res.json({
        current: { version: current.version, tables: currentTables, reducers: currentReducers },
        previous: prev ? { version: prev.version, tables: prevTables, reducers: prevReducers } : null,
        diff: {
            tablesAdded: Math.max(0, currentTables - prevTables),
            tablesRemoved: Math.max(0, prevTables - currentTables),
            reducersAdded: Math.max(0, currentReducers - prevReducers),
            reducersRemoved: Math.max(0, prevReducers - currentReducers),
        },
    });
});

// Rollback — mark current as rolled_back, create new migration entry
app.post('/api/migrations/:id/rollback', (req, res) => {
    const target = migrations.find(m => m.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Migration not found' });

    // Mark the latest as rolled_back
    const latest = migrations
        .filter(m => m.tenantId === target.tenantId)
        .sort((a, b) => b.version - a.version)[0];

    if (latest) latest.status = 'rolled_back';

    const rollback = {
        id: randomUUID(),
        tenantId: target.tenantId,
        tenantName: target.tenantName,
        version: (latest?.version || 0) + 1,
        timestamp: new Date().toISOString(),
        status: 'rollback',
        schemaSnapshot: target.schemaSnapshot,
        deployedBy: req.body.deployedBy || null,
        notes: `Rollback to v${target.version}`,
    };
    migrations.push(rollback);
    saveMigrations();
    res.json(rollback);
});

// ─────────────────────────────────────────────────────────────
// Rate Limiting & Quotas
// ─────────────────────────────────────────────────────────────

const QUOTAS_PATH = path.resolve(__dirname, 'quotas.json');
let quotas = existsSync(QUOTAS_PATH) ? JSON.parse(readFileSync(QUOTAS_PATH, 'utf-8')) : {};
function saveQuotas() { writeFileSync(QUOTAS_PATH, JSON.stringify(quotas, null, 2)); }

function getOrCreateQuota(tenantId) {
    if (!quotas[tenantId]) {
        quotas[tenantId] = {
            limits: { requestsPerMinute: 1000, requestsPerDay: 100000, storageMB: 1024, maxConnections: 50 },
            usage: { requestsThisMinute: 0, requestsToday: 0, storageMB: 0, activeConnections: 0, minuteReset: Date.now(), dayReset: Date.now() },
        };
        saveQuotas();
    }
    // Reset counters if time has passed
    const q = quotas[tenantId];
    const now = Date.now();
    if (now - q.usage.minuteReset > 60000) { q.usage.requestsThisMinute = 0; q.usage.minuteReset = now; }
    if (now - q.usage.dayReset > 86400000) { q.usage.requestsToday = 0; q.usage.dayReset = now; }
    return q;
}

// Get all quotas
app.get('/api/quotas', (_req, res) => {
    const result = {};
    for (const tenant of tenants) {
        result[tenant.id] = { name: tenant.name, ...getOrCreateQuota(tenant.id) };
    }
    res.json(result);
});

// Get quota for a tenant
app.get('/api/quotas/:tenantId', (req, res) => {
    const q = getOrCreateQuota(req.params.tenantId);
    res.json(q);
});

// Update quota limits
app.put('/api/quotas/:tenantId', (req, res) => {
    const q = getOrCreateQuota(req.params.tenantId);
    if (req.body.requestsPerMinute !== undefined) q.limits.requestsPerMinute = req.body.requestsPerMinute;
    if (req.body.requestsPerDay !== undefined) q.limits.requestsPerDay = req.body.requestsPerDay;
    if (req.body.storageMB !== undefined) q.limits.storageMB = req.body.storageMB;
    if (req.body.maxConnections !== undefined) q.limits.maxConnections = req.body.maxConnections;
    saveQuotas();
    res.json(q);
});

// Increment usage (called internally or via API)
app.post('/api/quotas/:tenantId/increment', (req, res) => {
    const q = getOrCreateQuota(req.params.tenantId);
    q.usage.requestsThisMinute++;
    q.usage.requestsToday++;
    saveQuotas();

    // Check if over limit
    const overLimit = q.usage.requestsThisMinute > q.limits.requestsPerMinute ||
        q.usage.requestsToday > q.limits.requestsPerDay;

    if (overLimit) return res.status(429).json({ error: 'Rate limit exceeded', quota: q });
    res.json({ ok: true, usage: q.usage });
});

// ─────────────────────────────────────────────────────────────
// Environment Management (dev → staging → prod)
// ─────────────────────────────────────────────────────────────

const ENVIRONMENTS_PATH = path.resolve(__dirname, 'environments.json');
let environments = existsSync(ENVIRONMENTS_PATH) ? JSON.parse(readFileSync(ENVIRONMENTS_PATH, 'utf-8')) : {};
function saveEnvironments() { writeFileSync(ENVIRONMENTS_PATH, JSON.stringify(environments, null, 2)); }

function getOrCreateEnv(tenantId) {
    if (!environments[tenantId]) {
        const tenant = tenants.find(t => t.id === tenantId);
        environments[tenantId] = {
            active: 'dev',
            environments: {
                dev: { databaseName: tenant?.database || `${tenant?.name || tenantId}-dev`, status: 'active', deployedAt: new Date().toISOString() },
                staging: { databaseName: `${tenant?.name || tenantId}-staging`, status: 'not_deployed', deployedAt: null },
                prod: { databaseName: `${tenant?.name || tenantId}-prod`, status: 'not_deployed', deployedAt: null },
            },
            promotionHistory: [],
        };
        saveEnvironments();
    }
    return environments[tenantId];
}

// Get environments for a tenant
app.get('/api/tenants/:id/environments', (req, res) => {
    const env = getOrCreateEnv(req.params.id);
    res.json(env);
});

// Promote environment (dev→staging or staging→prod)
app.post('/api/tenants/:id/promote', (req, res) => {
    const { from, to, promotedBy } = req.body;
    const validPromotions = { dev: 'staging', staging: 'prod' };
    if (!from || !to || validPromotions[from] !== to) {
        return res.status(400).json({ error: 'Invalid promotion. Valid: dev→staging, staging→prod' });
    }

    const env = getOrCreateEnv(req.params.id);
    const now = new Date().toISOString();

    // Copy source config to target
    env.environments[to].status = 'active';
    env.environments[to].deployedAt = now;
    env.active = to;

    env.promotionHistory.push({
        id: randomUUID(),
        from,
        to,
        timestamp: now,
        promotedBy: promotedBy || null,
    });

    saveEnvironments();
    res.json(env);
});

// Set active environment
app.patch('/api/tenants/:id/environments', (req, res) => {
    const env = getOrCreateEnv(req.params.id);
    if (req.body.active && ['dev', 'staging', 'prod'].includes(req.body.active)) {
        env.active = req.body.active;
        saveEnvironments();
    }
    res.json(env);
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
