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

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3002;
const SPACETIME_URL = process.env.SPACETIME_URL || 'http://localhost:3001';
const MODULES_DIR = path.resolve(__dirname, '../../');
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');

// Ensure uploads directory exists
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

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
// Start
// ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`Control Plane backend running on http://localhost:${PORT}`);
    console.log(`SpacetimeDB: ${SPACETIME_URL}`);
    console.log(`Modules dir: ${MODULES_DIR}`);
    console.log(`Tenants: ${tenants.length} registered`);
});
