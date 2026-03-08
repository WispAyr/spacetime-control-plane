# Spacetime Control Plane

A **general-purpose visual control plane** for [SpacetimeDB](https://spacetimedb.com) applications — with multi-database management, AI agent observability, interactive SQL/reducer tools, and full MCP (Model Context Protocol) integration.

> Think Supabase Studio + Retool + AI observability — but for SpacetimeDB.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![SpacetimeDB](https://img.shields.io/badge/SpacetimeDB-v2.0.3-purple.svg)
![MCP](https://img.shields.io/badge/MCP-compatible-green.svg)

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

### 🔌 MCP Server
- **9 MCP Tools** — Full SpacetimeDB access for any MCP-compatible AI (Claude, Gemini, etc.)
- **stdio Transport** — Drop-in local integration
- **Zero Config** — Just point it at your SpacetimeDB URL

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Control Plane UI                     │
│  ┌─────────┬──────────┬─────────┬──────────────────┐ │
│  │ Tables  │ Reducers │   SQL   │   AI Agent/Chat  │ │
│  └────┬────┴────┬─────┴────┬────┴────────┬─────────┘ │
│       │         │          │             │            │
│  ┌────▼─────────▼──────────▼─────────────▼─────────┐ │
│  │           SpacetimeDB HTTP Client               │ │
│  │              (v2.0.3 API /v1/*)                  │ │
│  └────────────────────┬────────────────────────────┘ │
└───────────────────────┼──────────────────────────────┘
                        │
          ┌─────────────▼──────────────┐
          │     SpacetimeDB :3001      │
          │  ┌──────────────────────┐  │
          │  │   App Module A       │  │  ← your app
          │  │   App Module B       │  │  ← another app
          │  │   Control Plane AI   │  │  ← AI observability
          │  └──────────────────────┘  │
          └─────────────▲──────────────┘
                        │
          ┌─────────────┴──────────────┐
          │      MCP Server (stdio)    │
          │   9 tools for AI agents    │
          └────────────────────────────┘
```

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [SpacetimeDB CLI](https://spacetimedb.com/install) v2.0.3+

### 1. Start SpacetimeDB

```bash
spacetime start
```

This starts a local instance on `http://localhost:3000` (or `:3001` depending on your config).

### 2. Publish a Test Module

```bash
cd modules/test-module
cd spacetimedb && npm install && cd ..
spacetime publish test-module --server http://localhost:3001
```

### 3. Start the Control Plane

```bash
cd control-plane
npm install
npm run dev
```

Open `http://localhost:5174` → Connect to your SpacetimeDB instance.

### 4. (Optional) Start the MCP Server

```bash
cd control-plane/mcp-server
npm install
SPACETIME_URL=http://localhost:3001 node index.js
```

## Project Structure

```
spacetime-control-plane/
├── control-plane/              # React + Vite frontend
│   ├── src/
│   │   ├── components/         # Sidebar, TopBar, ConnectDialog
│   │   ├── hooks/              # useConnection (multi-instance/multi-db context)
│   │   ├── lib/                # SpacetimeDB HTTP client
│   │   ├── pages/              # TablesPage, ReducersPage, SqlConsolePage,
│   │   │                       # AgentPage, EventsPage, SettingsPage, InstancesPage
│   │   └── test/               # Vitest setup
│   └── mcp-server/             # MCP server (Node.js, stdio)
│       ├── index.js            # 9 tools + 1 resource
│       └── README.md           # MCP configuration guide
│
├── modules/                    # SpacetimeDB server modules
│   ├── test-module/            # Simple person table + reducers
│   ├── inventory-app/          # Item + task tables with CRUD
│   └── control-plane-module/   # AI observability (agent_action, agent_rule, chat_message)
│
└── README.md                   # This file
```

## Pages

| Page | Sidebar | Description |
|------|---------|-------------|
| **Tables** | ⊞ | Browse tables with live data grid and schema inspector |
| **Reducers** | ƒ | View signatures, expand to fill params and call reducers |
| **SQL** | > | Write SQL, execute with ⌘↵, results as table |
| **AI Agent** | ◉ | Activity feed (approve/reject) + rules panel (toggle) |
| **Events** | ⚡ | AI chat with message bubbles |
| **Instances** | ◎ | Manage SpacetimeDB connections |
| **Settings** | ⚙ | Topology graph + database overview cards |

## MCP Integration

The MCP server exposes your SpacetimeDB instance to AI agents. Add to your AI tool configuration:

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

### Available MCP Tools

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

## Testing

```bash
cd control-plane
npm test              # Run all 49 tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

Test coverage includes:
- **Schema parsing** — SpacetimeDB v9 typespace resolution, lifecycle reducers, private tables
- **SQL result parsing** — COUNT, empty results, null handling
- **HTTP client** — Mocked fetch for ping, getSchema, sql, callReducer
- **Components** — Sidebar navigation, active state, AI indicator

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Vanilla CSS (glassmorphism design system) |
| Testing | Vitest + React Testing Library |
| Database | SpacetimeDB v2.0.3 |
| Modules | SpacetimeDB TypeScript SDK |
| MCP | @modelcontextprotocol/sdk (stdio) |

## Design System

The UI uses a custom glassmorphism design system with:
- Dark theme with glass blur effects
- JetBrains Mono for code, Inter for UI text
- Accent palette: blue, green, amber, red, purple, cyan
- Panel system with headers, bodies, and scrollable content
- Badge system for status indicators
- Fade-in animations

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
