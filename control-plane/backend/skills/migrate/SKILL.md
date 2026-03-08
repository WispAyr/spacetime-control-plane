---
name: Schema Migration
description: Run a schema migration with diff analysis and version tracking
icon: 🔄
category: operations
parameters:
  - name: tenantId
    type: string
    required: true
  - name: notes
    type: string
    required: false
---

# Schema Migration

Track schema changes between deploys with automatic diff generation and version history.

## Prerequisites

- Tenant must be deployed with an active database
- At least one prior schema snapshot should exist for meaningful diffs

## Workflow

### 1. Capture Pre-Migration Snapshot
- Fetch current schema via `GET /v1/database/<db>/schema?expand=true`
- Save to `snapshots/<tenant>/schema-<timestamp>.json`

### 2. Deploy New Module Version
- Follow the **Deploy Module** skill workflow
- This creates the new schema in SpacetimeDB

### 3. Capture Post-Migration Snapshot
- Fetch updated schema after deploy
- Save new snapshot

### 4. Generate Schema Diff
- Compare table names: detect added, removed, modified tables
- Compare column counts and types within modified tables
- Compare reducer signatures

### 5. Create Migration Record
```json
{
  "id": "<uuid>",
  "tenantId": "<tenant-id>",
  "version": "<auto-increment>",
  "timestamp": "<iso-date>",
  "status": "applied",
  "schemaSnapshot": "<snapshot-filename>",
  "diffs": [{ "type": "added|removed|modified", "table": "..." }],
  "deployedBy": "<worker-id>",
  "notes": "<optional>"
}
```

### 6. Record Activity
- Log migration in activity feed with version and diff summary

## Error Handling

| Error | Recovery |
|-------|----------|
| Deploy fails | Migration status = `failed`, keep old snapshot |
| Schema fetch fails | Retry once, then log as `unknown` diff |

## Rollback

Use `POST /api/migrations/:id/rollback` to:
1. Find the target migration's schema snapshot
2. Mark current migration as `rolled_back`
3. Create a new rollback migration entry
