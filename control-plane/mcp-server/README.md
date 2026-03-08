# SpacetimeDB MCP Server

An MCP (Model Context Protocol) server that exposes a SpacetimeDB instance to AI agents like Claude, Gemini, or any MCP-compatible client.

## Quick Start

```bash
cd control-plane/mcp-server
npm install
SPACETIME_URL=http://localhost:3001 SPACETIME_DATABASES=test-module-7970f,inventory-app-xk5yl node index.js
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SPACETIME_URL` | `http://localhost:3001` | SpacetimeDB instance URL |
| `SPACETIME_DATABASES` | (empty) | Comma-separated list of pre-registered database names |

### Claude Desktop / Gemini Code Assist

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "spacetime": {
      "command": "node",
      "args": ["/Users/ewanrichardson/Development/spacetime/control-plane/mcp-server/index.js"],
      "env": {
        "SPACETIME_URL": "http://localhost:3001",
        "SPACETIME_DATABASES": "test-module-7970f,inventory-app-xk5yl,control-plane-module-8zn73"
      }
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `spacetime_ping` | Check if SpacetimeDB is reachable |
| `spacetime_list_databases` | List all known databases with stats |
| `spacetime_add_database` | Register a new database name |
| `spacetime_get_schema` | Get full schema (tables + reducers) |
| `spacetime_list_tables` | List tables with column info |
| `spacetime_describe_table` | Detailed table info + sample data |
| `spacetime_list_reducers` | List reducers with parameter signatures |
| `spacetime_query` | Run SQL and get results as markdown table |
| `spacetime_call_reducer` | Call a reducer with JSON arguments |

## Example Usage (by an AI agent)

```
Agent: Use spacetime_list_databases to see what's running
→ 3 known databases:
  🟢 test-module-7970f: 1 tables, 3 reducers, 4 rows
  🟢 inventory-app-xk5yl: 2 tables, 4 reducers, 8 rows
  🟢 control-plane-module-8zn73: 3 tables, 7 reducers, 10 rows

Agent: Use spacetime_query to find low-stock items
→ SELECT * FROM item WHERE quantity < 10
  | id | name | category | quantity | location |
  | --- | --- | --- | --- | --- |
  | 2 | Monitor | Electronics | 8 | Warehouse A |
  | 4 | Standing Desk | Furniture | 6 | Warehouse B |

Agent: Use spacetime_call_reducer to add stock
→ addItem({"name": "Monitor", "category": "Electronics", "quantity": 20, "location": "Warehouse A"})
  ✓ Reducer "addItem" called successfully
```
