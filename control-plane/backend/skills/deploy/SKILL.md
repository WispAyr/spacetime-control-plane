---
name: Deploy Module
description: Deploy a SpacetimeDB module to an instance
icon: 🚀
category: operations
parameters:
  - name: tenantId
    type: string
    required: true
  - name: environment
    type: string
    default: dev
    options: [dev, staging, prod]
---

# Deploy Module

Deploy a SpacetimeDB module to the target instance, with pre-flight checks and rollback capability.

## Prerequisites

- Tenant must be registered with a valid `moduleDir`
- SpacetimeDB instance must be reachable
- Module must have a valid `spacetime.json` or `spacetimedb/` directory

## Workflow

### 1. Pre-Flight Checks
- Verify tenant exists and has a module directory
- Check SpacetimeDB connectivity via health endpoint
- Capture current schema snapshot (for rollback)
- Verify no other deploy is in progress for this tenant

### 2. Install Dependencies
```bash
cd <moduleDir>/spacetimedb
npm install  # if package.json exists and no node_modules
```

### 3. Publish Module
```bash
spacetime publish <database-name> --project-path <moduleDir> --skip-clippy -s <spacetime-url>
```

### 4. Post-Deploy Verification
- Fetch new schema to confirm tables/reducers are present
- Compare with pre-deploy snapshot to detect changes
- Log deploy result to tenant's `deployHistory`
- Update tenant status to `deployed`

### 5. Record Activity
- Log activity entry with worker ID and deploy output
- Fire webhooks for `tenant.deployed` event

## Error Handling

| Error | Recovery |
|-------|----------|
| CLI not found | Return error with install instructions |
| Publish fails | Set tenant status to `error`, log failure |
| Schema mismatch | Warn but don't block — may be intentional |
| Timeout (>60s) | Kill process, set status to `error` |

## Rollback

If deploy fails after a successful previous deploy:
1. Restore previous schema snapshot
2. Re-publish previous module version
3. Log rollback in deploy history
