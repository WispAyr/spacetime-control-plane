---
name: RLS Guard Generation
description: Generate row-level security reducer guards from policies
icon: 🛡️
category: security
parameters:
  - name: tenantId
    type: string
    required: true
---

# RLS Guard Generation

Generate TypeScript reducer guard functions from defined RLS policies, ready to paste into SpacetimeDB modules.

## Prerequisites

- Tenant must have at least one enforced RLS policy
- Policies must have valid conditions using `ctx.sender` syntax

## Workflow

### 1. Load Policies
- Fetch all enforced policies for the target tenant
- Group policies by table name

### 2. Validate Conditions
- Check that each policy condition is syntactically valid
- Verify referenced tables exist in the current schema

### 3. Generate Guard Functions
For each table with policies, generate:
- Individual guard function per operation (read, insert, update, delete)
- Combined `enforceRLS()` middleware function
- TypeScript imports for SpacetimeDB SDK types

### 4. Generate Middleware
```typescript
function enforceRLS(ctx: ReducerContext, table: string, op: string, row: any): boolean {
    const guard = guards[table]?.[op];
    if (!guard) return true;  // No policy = allow
    return guard(ctx, row);
}
```

### 5. Output
- Return generated code as a string
- Include metadata: policy count, table count, generation timestamp
- Code is copy-paste ready for SpacetimeDB modules

## Error Handling

| Error | Recovery |
|-------|----------|
| No enforced policies | Return comment-only placeholder |
| Invalid condition syntax | Skip policy, add warning comment |
| Unknown table | Include guard but add TODO comment |
