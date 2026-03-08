---
name: Backup & Restore
description: Create and restore database backups for tenants
icon: 💾
category: operations
parameters:
  - name: tenantId
    type: string
    required: true
  - name: action
    type: string
    default: create
    options: [create, restore, list]
---

# Backup & Restore

Create point-in-time backups of tenant databases and restore from previous backups.

## Prerequisites

- Tenant must be deployed with an active database
- Backup directory must be writable (`backend/backups/`)

## Workflow — Create Backup

### 1. Validate Tenant
- Confirm tenant exists and has a deployed database
- Check available disk space

### 2. Export Data
- For each table in the schema, run `SELECT * FROM <table>`
- Capture full schema via schema endpoint
- Package into a timestamped backup file

### 3. Save Backup
```
backups/<tenant-name>/
  backup-<timestamp>.json
    ├── metadata: { tenant, database, timestamp, tables, rowCounts }
    ├── schema: { full schema snapshot }
    └── data: { table_name: [rows...] }
```

### 4. Record Activity
- Log backup creation in activity feed
- Update tenant metadata with `lastBackupAt`

## Workflow — Restore Backup

### 1. Select Backup
- List available backups for tenant
- User selects target backup by timestamp

### 2. Verify Compatibility
- Compare backup schema with current schema
- Warn on structural differences

### 3. Restore Data
- Clear existing table data (if confirmed)
- Insert rows from backup using reducers or SQL

### 4. Record Activity
- Log restore operation with backup timestamp

## Error Handling

| Error | Recovery |
|-------|----------|
| Table query fails | Skip table, log warning, continue |
| Disk full | Abort backup, clean partial files |
| Schema mismatch on restore | Warn user, require confirmation |
