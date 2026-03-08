# Spacetime Control Plane

A **general-purpose visual control plane** for [SpacetimeDB](https://spacetimedb.com) applications — with multi-tenant management, real-time monitoring, AI agent observability, row-level security policies, backup/restore, and full MCP integration.

> Think Supabase Studio + Retool + AI observability — but for SpacetimeDB.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![SpacetimeDB](https://img.shields.io/badge/SpacetimeDB-v2.0.3-purple.svg)
![MCP](https://img.shields.io/badge/MCP-15_tools-green.svg)
![Pages](https://img.shields.io/badge/UI-11_pages-blue.svg)
![API](https://img.shields.io/badge/API-33+_endpoints-orange.svg)

## Features

### 🗄️ Multi-Database Management
- **Database Switcher** — Toggle between multiple SpacetimeDB modules from the TopBar
- **Topology Graph** — Draggable SVG visualization of all databases connected to your instance
- **Overview Cards** — Stats dashboard with table counts, reducer counts, and live row counts

### 📊 Schema Browser & Data Grid
- **Auto-discovery** — Connects to any SpacetimeDB module and introspects the schema at runtime
- **Live Data Grid** — Real-time table data with 3-second auto-refresh
- **Schema Inspector** — Column names, types, constraints (PK, auto_inc, unique)

### ⚡ Reducer Caller & SQL Console
- **Interactive Reducer Forms** — Click any reducer to expand a typed parameter form, invoke it, and see success/error feedback
- **SQL Console** — Write and execute SQL queries with results rendered as tables

### 🤖 AI Observability
- **Activity Feed** — Timeline of AI agent actions (queries, reducer calls, suggestions) with approve/reject workflow
- **Rules Panel** — Human-editable rules that govern AI behavior (toggle on/off, priority ordering)
- **AI Chat** — Real-time conversation between humans and AI agents via shared SpacetimeDB tables

### 👥 Tenant Management
- **Auto-Discovery** — Scans workspace for SpacetimeDB modules
- **One-Click Deploy** — Register modules and publish to SpacetimeDB from the UI
- **Deploy History** — Track all deployments with success/failure logs
- **Log Streaming** — View module logs (batch fetch + SSE streaming)
- **Backup & Restore** — Full data export per tenant via SQL, download/restore from JSON

### 📈 Monitoring Dashboard
- **Aggregate Stats** — Tenants, deployed, errors, total deploys — real-time cards
- **Tenant Health Grid** — Online/offline status indicators per tenant
- **Click-to-Expand** — Per-table row counts, column counts, deploy success/fail rates
- **Deploy Timeline** — Recent deploys with ✓/✗ status per tenant
- **Auto-Refresh** — Polls every 10 seconds (toggleable)

### 🛡️ Row-Level Security
- **Policy Manager** — Define per-table, per-operation access policies
- **Enforcement Toggle** — Enable/disable policies without deleting them
- **Code Generation** — Auto-generates TypeScript guard functions + `enforceRLS` middleware
- **SpacetimeDB Compatible** — Generated code uses `ReducerContext.sender` identity checks

### 🔐 Security & Auth
- **JWT Sessions** — Login with admin password, 24-hour tokens
- **API Keys** — Generate `stcp_*` keys with scoped permissions (read/write/deploy)
- **Key Management** — Masked display, last-used tracking, one-click revoke
- **Integration Guide** — Built-in code examples for JWT and API key auth

### 🔌 MCP Server
- **15 MCP Tools** — Full SpacetimeDB + Control Plane access for any MCP-compatible AI
- **stdio Transport** — Drop-in local integration
- **Zero Config** — Just point it at your SpacetimeDB URL

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Control Plane UI (11 pages)                 │
│  ┌──────┬──────┬─────┬──────┬──────┬───────┬───────┬──────────┐ │
│  │Tables│Reduc.│ SQL │Agent │Events│Tenants│Monitor│ Policies │ │
│  └──┬───┴──┬───┴──┬──┴──┬───┴──┬───┴───┬───┴───┬───┴────┬─────┘ │
│     └──────┴──────┴─────┴──────┴───────┴───────┴────────┘       │
│                           │                                       │
│  ┌────────────────────────▼──────────────────────────────────┐   │
│  │              Backend Service (:3002)                        │   │
│  │  33+ REST endpoints: tenants, deploy, logs, monitoring,    │   │
│  │  auth, backup, schema, RLS policies, files                 │   │
│  └────────────────────────┬──────────────────────────────────┘   │
└───────────────────────────┼──────────────────────────────────────┘
                            │
          ┌─────────────────▼───────────────┐
          │       SpacetimeDB :3001         │
          │  ┌───────────────────────────┐  │
          │  │   App Module A            │  │  ← your app
          │  │   App Module B            │  │  ← another app
          │  │   Control Plane AI Module │  │  ← AI observability
          │  └───────────────────────────┘  │
          └─────────────────▲───────────────┘
                            │
          ┌─────────────────┴───────────────┐
          │       MCP Server (stdio)        │
          │    15 tools for AI agents       │
          └─────────────────────────────────┘
```

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [SpacetimeDB CLI](https://spacetimedb.com/install) v2.0.3+

### 1. Start SpacetimeDB

```bash
spacetime start
```

### 2. Publish a Test Module

```bash
cd modules/test-module
cd spacetimedb && npm install && cd ..
spacetime publish test-module --server http://localhost:3001
```

### 3. Start the Control Plane

```bash
# Frontend
cd control-plane
npm install
npm run dev

# Backend (required for tenant management, monitoring, auth, backup)
cd control-plane/backend
npm install
npm start
```

Open `http://localhost:5174` → Connect to your SpacetimeDB instance.

### 4. (Optional) Start the MCP Server

```bash
cd control-plane/mcp-server
npm install
SPACETIME_URL=http://localhost:3001 node index.js
```

## Pages

| Page | Sidebar | Description |
|------|---------|-------------|
| **Tables** | ⊞ | Browse tables with live data grid and schema inspector |
| **Reducers** | ƒ | View signatures, expand to fill params and call reducers |
| **SQL** | > | Write SQL, execute with ⌘↵, results as table |
| **AI Agent** | ◉ | Activity feed (approve/reject) + rules panel (toggle) |
| **Events** | ⚡ | AI chat with message bubbles |
| **Tenants** | ◎ | Manage modules, deploy, logs, backup |
| **Monitor** | 📊 | Real-time stats, health grid, deploy timeline |
| **Policies** | 🛡️ | Row-level security policies with code generation |
| **Security** | 🔐 | JWT sessions, API key management |
| **Settings** | ⚙ | Topology graph + database overview cards |

## Backend API

The backend service (`control-plane/backend/server.js`) provides 33+ REST endpoints:

| Category | Endpoints | Description |
|----------|-----------|-------------|
| **Tenants** | CRUD, register, discover | Manage tenant modules |
| **Deploy** | POST publish | One-click deploy via CLI |
| **Logs** | GET batch, SSE stream | Module log viewing |
| **Monitoring** | Overview, per-tenant stats | Real-time health data |
| **Schema** | Snapshot, diff | Migration tracking |
| **Auth** | Login, verify, key CRUD | JWT + API key auth |
| **Backup** | Create, list, download, restore | Full data export/import |
| **RLS** | Policy CRUD, codegen | Row-level security |
| **Files** | Upload, list | Media reference storage |
| **System** | Health check | Backend status |

## MCP Tools

| Tool | Description |
|------|-------------|
| `spacetime_ping` | Check if SpacetimeDB is reachable |
| `spacetime_list_databases` | List all known databases with live stats |
| `spacetime_add_database` | Register a database name |
| `spacetime_get_schema` | Full schema (tables + reducers) as JSON |
| `spacetime_list_tables` | Table listing with column details |
| `spacetime_describe_table` | Detailed table info + sample rows |
| `spacetime_list_reducers` | Reducer signatures |
| `spacetime_query` | Run SQL, get markdown table results |
| `spacetime_call_reducer` | Call a reducer with JSON arguments |
| `cp_list_tenants` | List registered tenants with status |
| `cp_deploy_tenant` | Deploy a module to SpacetimeDB |
| `cp_monitoring_overview` | Aggregate stats for all tenants |
| `cp_backup_tenant` | Full data backup for a tenant |
| `cp_create_api_key` | Generate scoped API key |
| `cp_add_rls_policy` | Create row-level security policy |

### MCP Configuration

```json
{
  "mcpServers": {
    "spacetime": {
      "command": "node",
      "args": ["<path-to>/control-plane/mcp-server/index.js"],
      "env": {
        "SPACETIME_URL": "http://localhost:3001",
        "SPACETIME_DATABASES": "your-database-name"
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SPACETIME_URL` | `http://localhost:3001` | SpacetimeDB instance URL |
| `PORT` | `3002` | Backend service port |
| `ADMIN_PASSWORD` | `spacetime` | Admin login password |
| `JWT_SECRET` | auto-generated | JWT signing secret |
| `BACKEND_URL` | `http://localhost:3002` | MCP → backend URL |

## Testing

```bash
cd control-plane
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Vanilla CSS (glassmorphism design system) |
| Backend | Node.js + Express |
| Auth | JWT (jsonwebtoken) + API keys |
| Testing | Vitest + React Testing Library |
| Database | SpacetimeDB v2.0.3 |
| Modules | SpacetimeDB TypeScript SDK |
| MCP | @modelcontextprotocol/sdk (stdio) |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -am 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

MIT License — see [LICENSE](LICENSE) for details.

## Credits

- [SpacetimeDB](https://spacetimedb.com) — The database engine
- [Model Context Protocol](https://modelcontextprotocol.io) — AI integration standard
- Built with ❤️ by [Ewan Richardson](https://github.com/WispAyr)
