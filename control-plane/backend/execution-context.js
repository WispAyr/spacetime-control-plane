/**
 * Execution Context — Sandboxed process wrapper for CLI commands.
 * 
 * Wraps spacetime CLI commands with:
 *   - Unique execution IDs for audit trails
 *   - stdout/stderr capture into structured logs
 *   - Configurable timeouts (default 60s)
 *   - Tenant-level mutex to prevent concurrent deploys
 *   - Persistent execution history in executions.json
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __ecDirname = path.dirname(fileURLToPath(import.meta.url));
const EXECUTIONS_PATH = path.resolve(__ecDirname, 'executions.json');

let executions = [];
if (existsSync(EXECUTIONS_PATH)) {
    try { executions = JSON.parse(readFileSync(EXECUTIONS_PATH, 'utf-8')); } catch { executions = []; }
}
function saveExecutions() {
    if (executions.length > 200) executions = executions.slice(0, 200);
    writeFileSync(EXECUTIONS_PATH, JSON.stringify(executions, null, 2));
}

// Tenant-level mutex — prevent concurrent deploys
const activeLocks = new Map();

export class ExecutionContext {
    constructor({ tenantId, tenantName, operation, skillId = null, workerId = null, timeoutMs = 60000 }) {
        this.id = randomUUID();
        this.tenantId = tenantId;
        this.tenantName = tenantName;
        this.operation = operation;
        this.skillId = skillId;
        this.workerId = workerId;
        this.timeoutMs = timeoutMs;
        this.status = 'pending';
        this.stdout = '';
        this.stderr = '';
        this.exitCode = null;
        this.startedAt = null;
        this.completedAt = null;
        this.durationMs = null;
        this.error = null;
    }

    acquireLock() {
        if (activeLocks.has(this.tenantId)) {
            const existing = activeLocks.get(this.tenantId);
            throw new Error(`Tenant ${this.tenantName} already has an active ${existing.operation} (exec: ${existing.id})`);
        }
        activeLocks.set(this.tenantId, { id: this.id, operation: this.operation });
    }

    releaseLock() {
        if (activeLocks.get(this.tenantId)?.id === this.id) {
            activeLocks.delete(this.tenantId);
        }
    }

    async execute(command, args = [], options = {}) {
        this.acquireLock();
        this.status = 'running';
        this.startedAt = new Date().toISOString();
        this._save();

        return new Promise((resolve, reject) => {
            const proc = execFile(command, args, {
                timeout: this.timeoutMs,
                maxBuffer: 10 * 1024 * 1024,
                ...options,
            }, (error, stdout, stderr) => {
                this.stdout = stdout || '';
                this.stderr = stderr || '';
                this.completedAt = new Date().toISOString();
                this.durationMs = new Date(this.completedAt) - new Date(this.startedAt);
                this.releaseLock();

                if (error) {
                    this.status = 'failed';
                    this.exitCode = error.code || 1;
                    this.error = error.message;
                    this._save();
                    reject({ executionId: this.id, error: error.message, stdout: this.stdout, stderr: this.stderr });
                } else {
                    this.status = 'completed';
                    this.exitCode = 0;
                    this._save();
                    resolve({ executionId: this.id, stdout: this.stdout, stderr: this.stderr, exitCode: 0 });
                }
            });

            proc.on('error', (err) => {
                this.status = 'failed';
                this.error = err.message;
                this.completedAt = new Date().toISOString();
                this.durationMs = new Date(this.completedAt) - new Date(this.startedAt);
                this.releaseLock();
                this._save();
                reject({ executionId: this.id, error: err.message });
            });
        });
    }

    toJSON() {
        return {
            id: this.id, tenantId: this.tenantId, tenantName: this.tenantName,
            operation: this.operation, skillId: this.skillId, workerId: this.workerId,
            status: this.status, exitCode: this.exitCode,
            stdout: this.stdout?.slice(0, 2000), stderr: this.stderr?.slice(0, 1000),
            error: this.error, startedAt: this.startedAt,
            completedAt: this.completedAt, durationMs: this.durationMs,
        };
    }

    _save() {
        const idx = executions.findIndex(e => e.id === this.id);
        if (idx >= 0) executions[idx] = this.toJSON();
        else executions.unshift(this.toJSON());
        saveExecutions();
    }
}

export function getExecutions() { return executions; }
export function getExecution(id) { return executions.find(e => e.id === id); }
export function getActiveLocks() { return Object.fromEntries(activeLocks); }
