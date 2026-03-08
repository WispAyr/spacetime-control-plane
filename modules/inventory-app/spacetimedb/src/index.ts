import { schema, table, t } from 'spacetimedb/server';

const spacetimedb = schema({
  item: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      name: t.string(),
      category: t.string(),
      quantity: t.u32(),
      location: t.string(),
    }
  ),
  task: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      title: t.string(),
      assignee: t.string(),
      status: t.string(),
      priority: t.u32(),
    }
  ),
});

export default spacetimedb;

export const init = spacetimedb.init(ctx => {
  ctx.db.item.insert({ id: 0n, name: 'Laptop', category: 'Electronics', quantity: 12, location: 'Warehouse A' });
  ctx.db.item.insert({ id: 0n, name: 'Monitor', category: 'Electronics', quantity: 8, location: 'Warehouse A' });
  ctx.db.item.insert({ id: 0n, name: 'Desk Chair', category: 'Furniture', quantity: 24, location: 'Warehouse B' });
  ctx.db.item.insert({ id: 0n, name: 'Standing Desk', category: 'Furniture', quantity: 6, location: 'Warehouse B' });
  ctx.db.item.insert({ id: 0n, name: 'Webcam', category: 'Electronics', quantity: 30, location: 'Warehouse A' });

  ctx.db.task.insert({ id: 0n, title: 'Restock monitors', assignee: 'Alice', status: 'open', priority: 1 });
  ctx.db.task.insert({ id: 0n, title: 'Audit warehouse B', assignee: 'Bob', status: 'in_progress', priority: 2 });
  ctx.db.task.insert({ id: 0n, title: 'Order new chairs', assignee: 'Charlie', status: 'done', priority: 3 });
});

export const addItem = spacetimedb.reducer(
  { name: t.string(), category: t.string(), quantity: t.u32(), location: t.string() },
  (ctx, args) => {
    ctx.db.item.insert({ id: 0n, ...args });
  }
);

export const addTask = spacetimedb.reducer(
  { title: t.string(), assignee: t.string(), status: t.string(), priority: t.u32() },
  (ctx, args) => {
    ctx.db.task.insert({ id: 0n, ...args });
  }
);

export const updateTaskStatus = spacetimedb.reducer(
  { id: t.u64(), status: t.string() },
  (ctx, { id, status }) => {
    const task = ctx.db.task.id.find(id);
    if (task) {
      ctx.db.task.id.delete(id);
      ctx.db.task.insert({ ...task, status });
    }
  }
);
