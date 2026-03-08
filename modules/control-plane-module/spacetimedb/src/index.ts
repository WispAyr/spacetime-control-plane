import { schema, table, t } from 'spacetimedb/server';

/**
 * Spacetime Control Plane — AI Observability Module
 *
 * This module provides shared state for AI agent coordination:
 * - agent_action: tracks what agents do (observable, approvable)
 * - agent_rule: human-editable rules that govern agent behavior
 * - chat_message: natural language conversation between humans and agents
 */
const spacetimedb = schema({
  agent_action: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      agent_id: t.string(),
      action_type: t.string(), // 'reducer_call' | 'query' | 'rule_trigger' | 'suggestion'
      target_db: t.string(),   // which database was acted upon
      description: t.string(), // human-readable
      details: t.string(),     // JSON payload
      status: t.string(),      // 'pending' | 'approved' | 'rejected' | 'executed' | 'undone'
      requires_approval: t.bool(),
      created_at: t.u64(),     // unix millis
      executed_at: t.u64(),    // unix millis, 0 if not yet
    }
  ),
  agent_rule: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      name: t.string(),
      description: t.string(),
      condition: t.string(),   // natural language or structured
      action: t.string(),      // what to do when triggered
      enabled: t.bool(),
      priority: t.u32(),
    }
  ),
  chat_message: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      sender_name: t.string(),
      sender_type: t.string(), // 'human' | 'agent'
      text: t.string(),
      timestamp: t.u64(),      // unix millis
    }
  ),
});

export default spacetimedb;

// --- Init: Seed some demo data ---
export const init = spacetimedb.init(ctx => {
  // Demo rules
  ctx.db.agent_rule.insert({
    id: 0n, name: 'Auto-approve queries', description: 'Automatically approve read-only SQL queries',
    condition: 'action_type == "query"', action: 'auto_approve', enabled: true, priority: 1,
  });
  ctx.db.agent_rule.insert({
    id: 0n, name: 'Require approval for writes', description: 'All reducer calls require human approval',
    condition: 'action_type == "reducer_call"', action: 'require_approval', enabled: true, priority: 2,
  });
  ctx.db.agent_rule.insert({
    id: 0n, name: 'Alert on high-priority tasks', description: 'Notify when tasks with priority < 2 are created',
    condition: 'table == "task" && priority < 2', action: 'alert', enabled: false, priority: 3,
  });

  // Demo agent actions
  const now = BigInt(Date.now());
  ctx.db.agent_action.insert({
    id: 0n, agent_id: 'openclaw-1', action_type: 'query', target_db: 'inventory-app',
    description: 'Queried item inventory levels', details: '{"sql": "SELECT * FROM item WHERE quantity < 10"}',
    status: 'executed', requires_approval: false, created_at: now - 60000n, executed_at: now - 59000n,
  });
  ctx.db.agent_action.insert({
    id: 0n, agent_id: 'openclaw-1', action_type: 'reducer_call', target_db: 'inventory-app',
    description: 'Suggested: Restock monitors (quantity: 8 → 20)',
    details: '{"reducer": "addItem", "args": {"name": "Monitor", "quantity": 12}}',
    status: 'pending', requires_approval: true, created_at: now - 30000n, executed_at: 0n,
  });
  ctx.db.agent_action.insert({
    id: 0n, agent_id: 'openclaw-1', action_type: 'suggestion', target_db: 'test-module',
    description: 'Noticed: Person table has no unique constraint on name',
    details: '{"suggestion": "Consider adding a unique index on person.name to prevent duplicates"}',
    status: 'pending', requires_approval: false, created_at: now - 10000n, executed_at: 0n,
  });

  // Demo chat
  ctx.db.chat_message.insert({
    id: 0n, sender_name: 'Ewan', sender_type: 'human',
    text: 'What items are running low in inventory?', timestamp: now - 120000n,
  });
  ctx.db.chat_message.insert({
    id: 0n, sender_name: 'OpenClaw', sender_type: 'agent',
    text: 'I found 2 items below 10 units:\n• Standing Desk: 6 units (Warehouse B)\n• Monitor: 8 units (Warehouse A)\n\nWould you like me to create restock tasks?',
    timestamp: now - 115000n,
  });
  ctx.db.chat_message.insert({
    id: 0n, sender_name: 'Ewan', sender_type: 'human',
    text: 'Yes, create a restock task for monitors', timestamp: now - 60000n,
  });
  ctx.db.chat_message.insert({
    id: 0n, sender_name: 'OpenClaw', sender_type: 'agent',
    text: 'I\'ve proposed a restock action for monitors (8 → 20 units). It requires your approval — check the Activity feed to approve.',
    timestamp: now - 55000n,
  });
});

// --- Reducers ---

export const logAction = spacetimedb.reducer(
  {
    agent_id: t.string(), action_type: t.string(), target_db: t.string(),
    description: t.string(), details: t.string(), requires_approval: t.bool(),
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
    ctx.db.chat_message.insert({
      id: 0n, ...args, timestamp: BigInt(Date.now()),
    });
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
