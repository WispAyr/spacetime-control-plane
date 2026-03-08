import { schema, table, t } from 'spacetimedb/server';

/**
 * Spacetime Control Plane — SpacetimeDB Module
 *
 * This module IS the control plane's own database (dogfooding).
 * All control plane state lives here — no JSON files.
 *
 * Tables:
 *   AI Observability: agent_action, agent_rule, chat_message
 *   Tenants:          cp_tenant, cp_deploy_event
 *   Work:             cp_worker, cp_task, cp_goal, cp_activity
 *   Security:         cp_api_key, cp_rls_policy
 *   Memory:           cp_memory_note, cp_memory_pattern
 *   Infrastructure:   cp_webhook, cp_quota, cp_environment, cp_execution
 */
const spacetimedb = schema({
  // ── AI Observability (existing) ──────────────────────────────
  agent_action: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      agent_id: t.string(),
      action_type: t.string(),
      target_db: t.string(),
      description: t.string(),
      details: t.string(),
      status: t.string(),
      requires_approval: t.bool(),
      created_at: t.u64(),
      executed_at: t.u64(),
    }
  ),
  agent_rule: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      name: t.string(),
      description: t.string(),
      condition: t.string(),
      action: t.string(),
      enabled: t.bool(),
      priority: t.u32(),
    }
  ),
  chat_message: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      sender_name: t.string(),
      sender_type: t.string(),
      text: t.string(),
      timestamp: t.u64(),
    }
  ),

  // ── Tenants ──────────────────────────────────────────────────
  cp_tenant: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      name: t.string(),
      description: t.string(),
      status: t.string(),        // 'new' | 'deployed' | 'deploying' | 'error'
      database: t.string(),
      module_dir: t.string(),
      template: t.string(),
      created_at: t.u64(),
      last_deployed_at: t.u64(), // 0 if never
    }
  ),
  cp_deploy_event: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      tenant_id: t.string(),
      timestamp: t.u64(),
      success: t.bool(),
      output: t.string(),        // first 500 chars
      error: t.string(),
    }
  ),

  // ── Workers ──────────────────────────────────────────────────
  cp_worker: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      name: t.string(),
      worker_type: t.string(),   // 'human' | 'ai'
      status: t.string(),        // 'active' | 'idle' | 'offline'
      last_seen: t.u64(),
      tasks_completed: t.u32(),
      current_task_id: t.string(),
      created_at: t.u64(),
    }
  ),

  // ── Tasks ────────────────────────────────────────────────────
  cp_task: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      title: t.string(),
      description: t.string(),
      goal_id: t.string(),
      tenant_id: t.string(),
      skill_id: t.string(),
      status: t.string(),        // 'backlog' | 'claimed' | 'in_progress' | 'review' | 'done'
      priority: t.string(),      // 'low' | 'medium' | 'high' | 'critical'
      claimed_by: t.string(),
      claimed_at: t.u64(),
      completed_by: t.string(),
      completed_at: t.u64(),
      output: t.string(),
      summary: t.string(),
      created_by: t.string(),
      created_at: t.u64(),
      updated_at: t.u64(),
    }
  ),

  // ── Goals ────────────────────────────────────────────────────
  cp_goal: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      title: t.string(),
      description: t.string(),
      target_date: t.string(),
      progress: t.u32(),         // 0-100
      status: t.string(),        // 'active' | 'completed' | 'paused'
      created_by: t.string(),
      created_at: t.u64(),
    }
  ),

  // ── Activity Feed ────────────────────────────────────────────
  cp_activity: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      timestamp: t.u64(),
      worker_id: t.string(),
      worker_name: t.string(),
      worker_type: t.string(),
      action: t.string(),
      target_type: t.string(),
      target_id: t.string(),
      details: t.string(),
    }
  ),

  // ── API Keys ─────────────────────────────────────────────────
  cp_api_key: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      name: t.string(),
      key_hash: t.string(),
      scopes: t.string(),        // JSON array string
      active: t.bool(),
      created_at: t.u64(),
      last_used_at: t.u64(),
    }
  ),

  // ── RLS Policies ─────────────────────────────────────────────
  cp_rls_policy: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      tenant_id: t.string(),
      table_name: t.string(),
      operation: t.string(),     // 'read' | 'insert' | 'update' | 'delete' | 'all'
      condition: t.string(),
      description: t.string(),
      enforcement: t.string(),   // 'enforced' | 'permissive' | 'disabled'
      created_at: t.u64(),
      updated_at: t.u64(),
    }
  ),

  // ── Webhooks ─────────────────────────────────────────────────
  cp_webhook: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      url: t.string(),
      events: t.string(),        // JSON array string
      active: t.bool(),
      secret: t.string(),
      created_at: t.u64(),
    }
  ),

  // ── Quotas ───────────────────────────────────────────────────
  cp_quota: table(
    { public: true },
    {
      tenant_id: t.string().primaryKey(),
      requests_per_minute: t.u32(),
      requests_per_day: t.u32(),
      storage_mb: t.u32(),
      max_connections: t.u32(),
      // Usage counters
      requests_this_minute: t.u32(),
      requests_today: t.u32(),
      minute_reset: t.u64(),
      day_reset: t.u64(),
    }
  ),

  // ── Environments ─────────────────────────────────────────────
  cp_environment: table(
    { public: true },
    {
      id: t.string().primaryKey(),   // tenant_id:env_name composite
      tenant_id: t.string(),
      env_name: t.string(),          // 'dev' | 'staging' | 'prod'
      database_name: t.string(),
      status: t.string(),            // 'active' | 'not_deployed'
      deployed_at: t.u64(),
    }
  ),

  // ── Memory Notes ─────────────────────────────────────────────
  cp_memory_note: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      worker_id: t.string(),
      content: t.string(),
      tags: t.string(),              // JSON array string
      created_at: t.u64(),
    }
  ),

  // ── Memory Patterns ──────────────────────────────────────────
  cp_memory_pattern: table(
    { public: true },
    {
      id: t.string().primaryKey(),   // worker_id:key composite
      worker_id: t.string(),
      pattern_key: t.string(),
      pattern_value: t.string(),
      count: t.u32(),
      last_used: t.u64(),
    }
  ),

  // ── Execution Audit Trail ────────────────────────────────────
  cp_execution: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      tenant_id: t.string(),
      tenant_name: t.string(),
      operation: t.string(),
      skill_id: t.string(),
      worker_id: t.string(),
      status: t.string(),           // 'pending' | 'running' | 'completed' | 'failed'
      exit_code: t.i32(),
      stdout: t.string(),
      stderr: t.string(),
      error_msg: t.string(),
      started_at: t.u64(),
      completed_at: t.u64(),
      duration_ms: t.u64(),
    }
  ),
});

export default spacetimedb;

// ── Init: Seed demo data ────────────────────────────────────────

export const init = spacetimedb.init(ctx => {
  const now = BigInt(Date.now());

  // Demo rules
  ctx.db.agent_rule.insert({
    id: 0n, name: 'Auto-approve queries', description: 'Automatically approve read-only SQL queries',
    condition: 'action_type == "query"', action: 'auto_approve', enabled: true, priority: 1,
  });
  ctx.db.agent_rule.insert({
    id: 0n, name: 'Require approval for writes', description: 'All reducer calls require human approval',
    condition: 'action_type == "reducer_call"', action: 'require_approval', enabled: true, priority: 2,
  });
});

// ── AI Observability Reducers (existing) ────────────────────────

export const logAction = spacetimedb.reducer(
  {
    agent_id: t.string(), action_type: t.string(), target_db: t.string(),
    description: t.string(), details: t.string(), requires_approval: t.bool()
  },
  (ctx, args) => {
    ctx.db.agent_action.insert({
      id: 0n, ...args,
      status: args.requires_approval ? 'pending' : 'executed',
      created_at: BigInt(Date.now()),
      executed_at: args.requires_approval ? 0n : BigInt(Date.now()),
    });
  }
);

export const approveAction = spacetimedb.reducer(
  { action_id: t.u64() },
  (ctx, { action_id }) => {
    const action = ctx.db.agent_action.id.find(action_id);
    if (action && action.status === 'pending') {
      ctx.db.agent_action.id.delete(action_id);
      ctx.db.agent_action.insert({ ...action, status: 'approved', executed_at: BigInt(Date.now()) });
    }
  }
);

export const rejectAction = spacetimedb.reducer(
  { action_id: t.u64() },
  (ctx, { action_id }) => {
    const action = ctx.db.agent_action.id.find(action_id);
    if (action && action.status === 'pending') {
      ctx.db.agent_action.id.delete(action_id);
      ctx.db.agent_action.insert({ ...action, status: 'rejected' });
    }
  }
);

export const sendMessage = spacetimedb.reducer(
  { sender_name: t.string(), sender_type: t.string(), text: t.string() },
  (ctx, args) => {
    ctx.db.chat_message.insert({ id: 0n, ...args, timestamp: BigInt(Date.now()) });
  }
);

export const addRule = spacetimedb.reducer(
  { name: t.string(), description: t.string(), condition: t.string(), action: t.string(), priority: t.u32() },
  (ctx, args) => {
    ctx.db.agent_rule.insert({ id: 0n, ...args, enabled: true });
  }
);

export const toggleRule = spacetimedb.reducer(
  { rule_id: t.u64() },
  (ctx, { rule_id }) => {
    const rule = ctx.db.agent_rule.id.find(rule_id);
    if (rule) {
      ctx.db.agent_rule.id.delete(rule_id);
      ctx.db.agent_rule.insert({ ...rule, enabled: !rule.enabled });
    }
  }
);

// ── Tenant Reducers ─────────────────────────────────────────────

export const upsertTenant = spacetimedb.reducer(
  {
    id: t.string(), name: t.string(), description: t.string(), status: t.string(),
    database: t.string(), module_dir: t.string(), template: t.string(),
    created_at: t.u64(), last_deployed_at: t.u64()
  },
  (ctx, args) => {
    const existing = ctx.db.cp_tenant.id.find(args.id);
    if (existing) ctx.db.cp_tenant.id.delete(args.id);
    ctx.db.cp_tenant.insert(args);
  }
);

export const deleteTenant = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => { ctx.db.cp_tenant.id.delete(id); }
);

export const insertDeployEvent = spacetimedb.reducer(
  {
    id: t.string(), tenant_id: t.string(), timestamp: t.u64(),
    success: t.bool(), output: t.string(), error: t.string()
  },
  (ctx, args) => { ctx.db.cp_deploy_event.insert(args); }
);

// ── Worker Reducers ─────────────────────────────────────────────

export const upsertWorker = spacetimedb.reducer(
  {
    id: t.string(), name: t.string(), worker_type: t.string(), status: t.string(),
    last_seen: t.u64(), tasks_completed: t.u32(), current_task_id: t.string(), created_at: t.u64()
  },
  (ctx, args) => {
    const existing = ctx.db.cp_worker.id.find(args.id);
    if (existing) ctx.db.cp_worker.id.delete(args.id);
    ctx.db.cp_worker.insert(args);
  }
);

export const deleteWorker = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => { ctx.db.cp_worker.id.delete(id); }
);

// ── Task Reducers ───────────────────────────────────────────────

export const upsertTask = spacetimedb.reducer(
  {
    id: t.string(), title: t.string(), description: t.string(), goal_id: t.string(),
    tenant_id: t.string(), skill_id: t.string(), status: t.string(), priority: t.string(),
    claimed_by: t.string(), claimed_at: t.u64(), completed_by: t.string(), completed_at: t.u64(),
    output: t.string(), summary: t.string(), created_by: t.string(), created_at: t.u64(), updated_at: t.u64()
  },
  (ctx, args) => {
    const existing = ctx.db.cp_task.id.find(args.id);
    if (existing) ctx.db.cp_task.id.delete(args.id);
    ctx.db.cp_task.insert(args);
  }
);

export const deleteTask = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => { ctx.db.cp_task.id.delete(id); }
);

// ── Goal Reducers ───────────────────────────────────────────────

export const upsertGoal = spacetimedb.reducer(
  {
    id: t.string(), title: t.string(), description: t.string(), target_date: t.string(),
    progress: t.u32(), status: t.string(), created_by: t.string(), created_at: t.u64()
  },
  (ctx, args) => {
    const existing = ctx.db.cp_goal.id.find(args.id);
    if (existing) ctx.db.cp_goal.id.delete(args.id);
    ctx.db.cp_goal.insert(args);
  }
);

export const deleteGoal = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => { ctx.db.cp_goal.id.delete(id); }
);

// ── Activity Reducers ───────────────────────────────────────────

export const insertActivity = spacetimedb.reducer(
  {
    id: t.string(), timestamp: t.u64(), worker_id: t.string(), worker_name: t.string(),
    worker_type: t.string(), action: t.string(), target_type: t.string(),
    target_id: t.string(), details: t.string()
  },
  (ctx, args) => { ctx.db.cp_activity.insert(args); }
);

// ── API Key Reducers ────────────────────────────────────────────

export const upsertApiKey = spacetimedb.reducer(
  {
    id: t.string(), name: t.string(), key_hash: t.string(), scopes: t.string(),
    active: t.bool(), created_at: t.u64(), last_used_at: t.u64()
  },
  (ctx, args) => {
    const existing = ctx.db.cp_api_key.id.find(args.id);
    if (existing) ctx.db.cp_api_key.id.delete(args.id);
    ctx.db.cp_api_key.insert(args);
  }
);

export const deleteApiKey = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => { ctx.db.cp_api_key.id.delete(id); }
);

// ── RLS Policy Reducers ─────────────────────────────────────────

export const upsertRlsPolicy = spacetimedb.reducer(
  {
    id: t.string(), tenant_id: t.string(), table_name: t.string(), operation: t.string(),
    condition: t.string(), description: t.string(), enforcement: t.string(),
    created_at: t.u64(), updated_at: t.u64()
  },
  (ctx, args) => {
    const existing = ctx.db.cp_rls_policy.id.find(args.id);
    if (existing) ctx.db.cp_rls_policy.id.delete(args.id);
    ctx.db.cp_rls_policy.insert(args);
  }
);

export const deleteRlsPolicy = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => { ctx.db.cp_rls_policy.id.delete(id); }
);

// ── Webhook Reducers ────────────────────────────────────────────

export const upsertWebhook = spacetimedb.reducer(
  {
    id: t.string(), url: t.string(), events: t.string(), active: t.bool(),
    secret: t.string(), created_at: t.u64()
  },
  (ctx, args) => {
    const existing = ctx.db.cp_webhook.id.find(args.id);
    if (existing) ctx.db.cp_webhook.id.delete(args.id);
    ctx.db.cp_webhook.insert(args);
  }
);

export const deleteWebhook = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => { ctx.db.cp_webhook.id.delete(id); }
);

// ── Quota Reducers ──────────────────────────────────────────────

export const upsertQuota = spacetimedb.reducer(
  {
    tenant_id: t.string(), requests_per_minute: t.u32(), requests_per_day: t.u32(),
    storage_mb: t.u32(), max_connections: t.u32(), requests_this_minute: t.u32(),
    requests_today: t.u32(), minute_reset: t.u64(), day_reset: t.u64()
  },
  (ctx, args) => {
    const existing = ctx.db.cp_quota.tenant_id.find(args.tenant_id);
    if (existing) ctx.db.cp_quota.tenant_id.delete(args.tenant_id);
    ctx.db.cp_quota.insert(args);
  }
);

// ── Environment Reducers ────────────────────────────────────────

export const upsertEnvironment = spacetimedb.reducer(
  {
    id: t.string(), tenant_id: t.string(), env_name: t.string(),
    database_name: t.string(), status: t.string(), deployed_at: t.u64()
  },
  (ctx, args) => {
    const existing = ctx.db.cp_environment.id.find(args.id);
    if (existing) ctx.db.cp_environment.id.delete(args.id);
    ctx.db.cp_environment.insert(args);
  }
);

// ── Memory Reducers ─────────────────────────────────────────────

export const insertMemoryNote = spacetimedb.reducer(
  {
    id: t.string(), worker_id: t.string(), content: t.string(),
    tags: t.string(), created_at: t.u64()
  },
  (ctx, args) => { ctx.db.cp_memory_note.insert(args); }
);

export const deleteMemoryNote = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => { ctx.db.cp_memory_note.id.delete(id); }
);

export const upsertMemoryPattern = spacetimedb.reducer(
  {
    id: t.string(), worker_id: t.string(), pattern_key: t.string(),
    pattern_value: t.string(), count: t.u32(), last_used: t.u64()
  },
  (ctx, args) => {
    const existing = ctx.db.cp_memory_pattern.id.find(args.id);
    if (existing) ctx.db.cp_memory_pattern.id.delete(args.id);
    ctx.db.cp_memory_pattern.insert(args);
  }
);

// ── Execution Reducers ──────────────────────────────────────────

export const upsertExecution = spacetimedb.reducer(
  {
    id: t.string(), tenant_id: t.string(), tenant_name: t.string(), operation: t.string(),
    skill_id: t.string(), worker_id: t.string(), status: t.string(), exit_code: t.i32(),
    stdout: t.string(), stderr: t.string(), error_msg: t.string(),
    started_at: t.u64(), completed_at: t.u64(), duration_ms: t.u64()
  },
  (ctx, args) => {
    const existing = ctx.db.cp_execution.id.find(args.id);
    if (existing) ctx.db.cp_execution.id.delete(args.id);
    ctx.db.cp_execution.insert(args);
  }
);
