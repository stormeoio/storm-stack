import type { DocsContentEntry } from "./docsContentTypes";

export const DOC_CONTENT_CORE: Record<string, DocsContentEntry> = {
  "getting-started": {
    title: "Getting Started",
    body: `## Installation

\`\`\`bash
npx create-storm-app my-app
cd my-app
docker compose up -d
cp .env.example .env
npm install
npm run db:push
npm run dev
\`\`\`

The CLI will ask you which plugins to install and whether to generate a React frontend.

## Project Structure

\`\`\`
my-app/
├── server/index.ts       # Express bootstrap
├── client/src/           # React frontend (optional)
├── docker-compose.yml    # PostgreSQL
├── drizzle.config.ts     # Schema management
├── storm.json            # Plugin configuration
└── .env.example          # Configuration
\`\`\`

## Development

- **Server**: http://localhost:3000 (Express + all plugin APIs)
- **Client**: http://localhost:5173 (Vite + proxy to server)
- **Database**: PostgreSQL via Docker on port 5432

## Scripts

| Command | Description |
|---------|-------------|
| \`storm dev\` | Start server + client |
| \`storm add <plugin>\` | Install a plugin |
| \`storm list\` | Show available plugins |
| \`storm search <query>\` | Search plugins |
| \`storm info\` | Project health check |
| \`npm run db:push\` | Apply schema to database |
`,
  },
  architecture: {
    title: "Architecture",
    body: `## Plugin System

Storm Stack uses a plugin registry with dependency resolution, typed events, and lifecycle management.

\`\`\`
┌─────────────────────────────────────────┐
│            Your Application             │
├─────────────────────────────────────────┤
│  auth  │  crm  │  ticketing  │  ...    │  ← Plugins
├─────────────────────────────────────────┤
│     Events  │  Config  │  Tenant       │  ← Core Services
├─────────────────────────────────────────┤
│           @stormstack/core              │  ← Registry
├─────────────────────────────────────────┤
│  Express 5  │  Drizzle  │  PostgreSQL  │  ← Foundation
└─────────────────────────────────────────┘
\`\`\`

## Boot Sequence

1. Initialize config store + event bus
2. Validate all plugin dependencies
3. Mount global middleware (auth cookies, CORS)
4. Mount tenant resolution middleware
5. Register plugin event handlers
6. Run \`onBoot\` lifecycle hooks
7. Mount plugin routes at \`/api/<plugin-name>\`
8. Mount manifest API at \`/api/storm/\`

## Plugin Interface

Every plugin declares:

- **id** — unique identifier (e.g. \`@stormstack/crm\`)
- **schema** — Drizzle tables it owns
- **routes** — Express router factory
- **client** — nav items, routes, settings panels
- **lifecycle** — onBoot, onInstall, onUninstall
- **events** — emits/on declarations for typed pub/sub
- **configSchema** — Zod schema for auto-generated settings UI
- **requires** — other plugins it depends on
- **env** — required environment variables
`,
  },
  cli: {
    title: "CLI Reference",
    body: `## storm dev

Start the development server (API + client).

\`\`\`bash
storm dev                  # Full stack (server + Vite)
storm dev --port 4000      # Custom API port
storm dev --no-client      # API only
storm dev --client-port 3001  # Custom Vite port
\`\`\`

Spawns \`tsx watch\` for the server and \`vite\` for the client in parallel with colored, prefixed output.

## storm add

Install a plugin.

\`\`\`bash
storm add auth             # npm package mode
storm add crm --copy       # Copy source (shadcn-style)
storm add ticketing --copy --local /path/to/monorepo  # Local dev
storm add stripe --yes     # Skip prompts
\`\`\`

Auto-resolves dependencies: \`storm add crm\` will install auth first if needed.

## storm remove

Uninstall a plugin.

\`\`\`bash
storm remove crm
\`\`\`

Blocks removal if other installed plugins depend on it. Runs \`onUninstall\` lifecycle hook if defined.

## storm update

Check for and apply plugin updates.

\`\`\`bash
storm update                # Check all installed plugins
storm update auth           # Check a single plugin
storm update --dry-run      # See what would change
storm update --yes          # Skip confirmation
\`\`\`

Detects install mode (npm or copy) automatically. For copy-mode plugins, compares local files against upstream and creates a backup before applying changes. If a schema file changed, reminds you to run \`storm migrate generate\`.

## storm list

Show all available plugins with install status.

\`\`\`bash
storm list
\`\`\`

Fetches from the remote registry if available, falls back to local catalog.

## storm search

Search plugins by name, description, or tag.

\`\`\`bash
storm search auth          # Exact name match
storm search crm           # Find CRM-related plugins
storm search payments      # Search by tag
\`\`\`

Scored relevance: exact name (100pts) > exact tag (50) > name prefix (30) > substring (10).

## storm publish

Publish a plugin to the registry.

\`\`\`bash
storm publish auth                # Interactive
storm publish auth --dry-run      # Preview without writing
storm publish auth --dry-run --yes  # Non-interactive preview
\`\`\`

Generates a registry entry and writes it to \`registry.json\`.

## storm info

Show project health and status.

\`\`\`bash
storm info
\`\`\`

Displays: project name/version, installed plugins, config paths, 7 health checks.

## storm init

Initialize \`storm.json\` in an existing project.

\`\`\`bash
storm init
\`\`\`

Auto-detects plugins already imported in your server entry.
`,
  },
  "creating-plugins": {
    title: "Creating Plugins",
    body: `## Minimal Plugin

\`\`\`ts
import type { StormPlugin } from "@stormstack/core";
import { Router } from "express";

export const helloPlugin: StormPlugin = {
  id: "my-org/hello",
  name: "Hello",
  version: "1.0.0",
  description: "A simple greeting plugin",

  routes: ({ ctx, isAuthenticated }) => {
    const router = Router();
    router.get("/greet", isAuthenticated, (req, res) => {
      res.json({ message: "Hello from plugin" });
    });
    return router;
  },
};
\`\`\`

## With Schema + Events

\`\`\`ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod";

export const notes = pgTable("notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  body: text("body"),
  userId: text("user_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notesPlugin: StormPlugin = {
  id: "my-org/notes",
  name: "Notes",
  version: "1.0.0",
  requires: ["@stormstack/auth"],
  schema: { tables: { notes } },

  configSchema: z.object({
    maxNotesPerUser: z.number().min(1).max(1000).default(100),
    allowPublicNotes: z.boolean().default(false),
  }),

  events: {
    emits: ["note.created", "note.deleted"],
    on: {
      "user.registered": async (event) => {
        // Create welcome note for new users
      },
    },
  },

  routes: ({ ctx, isAuthenticated }) => {
    const router = Router();
    // Tenant-scoped CRUD routes...
    return router;
  },
};
\`\`\`

## Client Manifest

\`\`\`ts
client: {
  navItems: [
    { id: "notes", label: "Notes", icon: "StickyNote", path: "/notes" }
  ],
  routes: [
    { path: "/notes", component: "NotesPage", auth: true }
  ],
  settingsPanels: [
    { id: "notes-settings", label: "Notes", pluginId: "my-org/notes" }
  ],
}
\`\`\`
`,
  },
  events: {
    title: "Event Bus",
    body: `## Overview

Storm Stack includes a typed async event bus for inter-plugin communication. Plugins declare which events they emit and listen to — the framework wires everything at boot.

## Declaring Events

\`\`\`ts
export const crmPlugin: StormPlugin = {
  // ...
  events: {
    emits: ["contact.created", "deal.won", "deal.lost"],
    on: {
      "ticket.created": async (event) => {
        // React to ticket creation
        const { ticketId, tenantId } = event.payload;
      },
    },
  },
};
\`\`\`

## Emitting Events

In your routes, emit events fire-and-forget:

\`\`\`ts
ctx.events.emit("contact.created", {
  contactId: row.id,
  email: data.email,
  tenantId: req.tenant!.tenantId,
}, "@stormstack/crm").catch(() => {});
\`\`\`

## Built-in Event Types

20+ typed events via declaration merging on \`StormEvents\`:

| Domain | Events |
|--------|--------|
| Auth | user.registered, user.logged_in, user.logged_out |
| CRM | contact.created/updated/deleted, deal.created/stage_changed/won/lost |
| Ticketing | ticket.created/updated/resolved/closed/comment_added |
| Billing | payment.completed/failed, subscription.created/cancelled |
| System | plugin.booted, plugin.config.updated |

## Wildcard Listener

\`\`\`ts
eventBus.on("*", async (event) => {
  console.log(event.name, event.payload);
});
\`\`\`

## Introspection API

\`GET /api/storm/events\` — returns emitters, listeners, and event history.

Events use \`Promise.allSettled()\` for error isolation — one failing handler won't block others.
`,
  },
  "multi-tenant": {
    title: "Multi-Tenant",
    body: `## Overview

Storm Stack supports two tenant modes, selected at bootstrap:

1. **Single-tenant** (default, zero-config) — user ID = tenant ID
2. **Multi-tenant** — explicit \`storm_tenant_members\` table with roles

## Single-Tenant Mode

Works out of the box. Every authenticated user is their own tenant:

\`\`\`ts
await bootstrapPlugins({ app, ctx });
// req.tenant = { tenantId: userId, userId, role: user.role }
\`\`\`

## Multi-Tenant Mode

Pass a \`tenant\` option with your membership table:

\`\`\`ts
await bootstrapPlugins({
  app, ctx,
  tenant: { tables: { tenantMembers: stormTenantMembers } },
});
\`\`\`

Users select their active tenant via the \`x-storm-tenant\` header.

## Tenant Guards

\`\`\`ts
import { requireTenant, requireTenantRole } from "@stormstack/core";

router.get("/admin", requireTenant, requireTenantRole("admin", "owner"), handler);
\`\`\`

## Query Helpers

\`\`\`ts
import { tenantScope, tenantAnd } from "@stormstack/core";

// Simple tenant filter
const rows = await db.select().from(contacts)
  .where(tenantScope(contacts, req.tenant!.tenantId))
  .limit(100);

// Tenant + additional conditions
const rows = await db.select().from(tickets)
  .where(tenantAnd(tickets, req.tenant!.tenantId, eq(tickets.status, "open")))
  .limit(100);
\`\`\`

All official plugins use \`req.tenant!.tenantId\` for data isolation.
`,
  },
  marketplace: {
    title: "Marketplace",
    body: `## Registry

The plugin registry is a JSON file served over HTTP:

\`\`\`json
{
  "version": 1,
  "plugins": [
    {
      "id": "@stormstack/auth",
      "name": "Auth",
      "shortName": "auth",
      "version": "0.1.0",
      "tags": ["auth", "jwt", "rbac"],
      "status": "available"
    }
  ]
}
\`\`\`

Your \`storm.json\` points to it:

\`\`\`json
{
  "registry": "https://raw.githubusercontent.com/.../registry.json"
}
\`\`\`

## Searching

\`\`\`bash
storm search auth          # By name
storm search payments      # By tag
storm search "support tickets"  # By description
\`\`\`

Search merges local plugins + remote registry. Works offline (local-only fallback).

## Publishing

\`\`\`bash
storm publish my-plugin --dry-run   # Preview the entry
storm publish my-plugin             # Write to registry.json
\`\`\`

This generates a registry entry from your plugin metadata and writes it to the nearest \`registry.json\`. Commit and push to publish.

## Install Modes

1. **npm** (default) — \`storm add auth\` installs the npm package
2. **copy** (shadcn-style) — \`storm add auth --copy\` copies source into your project

Copy mode gives you full ownership of the code. The CLI rewrites imports from \`@stormstack/<plugin>\` to relative paths automatically.
`,
  },
  admin: {
    title: "Admin Dashboard",
    body: `## Overview

StormClaude ships with a built-in admin dashboard at \`/admin\` with three tabs:

### Overview Tab

- Plugin count, configurable count, emitter/listener stats
- Full plugin table with config fields, event counts, and version info
- Recent events feed

### Settings Tab

Auto-generated forms from each plugin's \`configSchema\`:

\`\`\`ts
configSchema: z.object({
  sessionExpiryHours: z.number().min(1).max(720).default(24),
  passwordMinLength: z.number().min(6).max(128).default(8),
  allowRegistration: z.boolean().default(true),
}),
\`\`\`

This becomes a form with number inputs, toggles, and validation — zero UI code needed.

### Events Tab

- Emitter/listener topology map (which plugin emits/listens to what)
- Searchable event history with expandable JSON payload
- Color-coded by domain (auth=blue, CRM=emerald, tickets=purple)
- Auto-refresh every 5 seconds

## StormAdmin Component

Drop-in admin panel from \`@stormstack/react\` — four tabs: plugin overview, configuration, events, and catalog.

\`\`\`tsx
import { StormAdmin } from "@stormstack/react";

// In your routes:
<Route path="/admin" component={() => <StormAdmin />} />
\`\`\`

Props: \`apiBase\` (default \`"/api"\`). The component auto-fetches plugins, config schemas, events, and catalog from the Storm Stack API.

The server must inject an explicit \`requireAdmin\` middleware into
\`bootstrapPlugins\`. Without it, authenticated configuration and event-history
requests fail closed with \`503 STORM_ADMIN_GUARD_REQUIRED\`; a configured policy
returns \`403\` when the current user is not an administrator. \`StormAdmin\`
shows explicit session-expired (\`401\`) and access-denied (\`403\`) states rather
than rendering forms or empty event data.

### Tabs

- **Plugins** — installed plugin cards with tags, version, pricing badge
- **Configuration** — auto-generated forms from \`configSchema\` with sidebar navigation
- **Events** — emitter/listener topology + event history with auto-refresh
- **Catalog** — full plugin catalog with search, status filters, and category badges

## Config API

| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | \`/api/storm/config\` | All plugin configs | Authenticated + injected admin policy |
| GET | \`/api/storm/config/:id\` | Single plugin config | Authenticated + injected admin policy |
| PATCH | \`/api/storm/config/:id\` | Update plugin config | Authenticated + injected admin policy |

## Events API

| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | \`/api/storm/events\` | Emitters, listeners, history | Authenticated + injected admin policy |
| GET | \`/api/storm/events?limit=100\` | Custom history limit | Authenticated + injected admin policy |

## Catalog API

| Method | Path | Description |
|--------|------|-------------|
| GET | \`/api/storm/catalog\` | All plugins with status + categories |
`,
  },
};
