---
name: Health Monitoring
description: Check tenant health and generate status reports
icon: 📊
category: observability
parameters:
  - name: tenantId
    type: string
    required: false
    description: Omit to check all tenants
---

# Health Monitoring

Perform health checks on deployed tenants and generate status reports.

## Prerequisites

- SpacetimeDB instance must be reachable
- At least one tenant should be deployed

## Workflow

### 1. System Health Check
- Ping SpacetimeDB identity endpoint
- Check backend service uptime
- Verify disk space and memory usage

### 2. Per-Tenant Health Check
For each deployed tenant:
- Fetch schema to confirm database is accessible
- Count tables and reducers
- Check for recent deploy errors
- Verify quota usage is within limits

### 3. Generate Status Report
```json
{
  "timestamp": "<iso-date>",
  "system": { "backend": "healthy", "spacetimedb": "healthy|unreachable" },
  "tenants": [
    {
      "name": "...",
      "status": "online|error|unreachable",
      "tables": 5,
      "reducers": 3,
      "quotaUsage": "45%",
      "lastDeploy": "<iso-date>"
    }
  ],
  "alerts": []
}
```

### 4. Check Alert Conditions
- Tenant unreachable for >1 consecutive check
- Quota usage >80%
- Deploy failure in last hour
- No successful deploy in >7 days

### 5. Record Activity
- Log health check results
- Fire webhooks for any alerts

## Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Quota usage | >80% | >95% |
| Response time | >2s | >5s |
| Failed deploys | 2 in 1h | 5 in 1h |
| Uptime gap | >1h | >24h |
