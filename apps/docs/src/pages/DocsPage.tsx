import { Link, useParams } from "wouter";
import { clsx } from "clsx";

const SECTIONS = [
  { id: "getting-started", label: "Getting Started" },
  { id: "architecture", label: "Architecture" },
  { id: "cli", label: "CLI Reference" },
  { id: "creating-plugins", label: "Creating Plugins" },
  { id: "events", label: "Event Bus" },
  { id: "multi-tenant", label: "Multi-Tenant" },
  { id: "marketplace", label: "Marketplace" },
  { id: "admin", label: "Admin Dashboard" },
  { id: "auth", label: "Auth Plugin" },
  { id: "crm", label: "CRM Plugin" },
  { id: "ticketing", label: "Ticketing Plugin" },
  { id: "lifecycle-hooks", label: "Lifecycle Hooks" },
  { id: "client-loader", label: "Client Loader" },
  { id: "testing", label: "Testing" },
  { id: "deployment", label: "Deployment" },
];

const CONTENT: Record<string, { title: string; body: string }> = {
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

### Tabs

- **Plugins** — installed plugin cards with tags, version, pricing badge
- **Configuration** — auto-generated forms from \`configSchema\` with sidebar navigation
- **Events** — emitter/listener topology + event history with auto-refresh
- **Catalog** — full plugin catalog with search, status filters, and category badges

## Config API

| Method | Path | Description |
|--------|------|-------------|
| GET | \`/api/storm/config\` | All plugin configs |
| GET | \`/api/storm/config/:id\` | Single plugin config |
| PATCH | \`/api/storm/config/:id\` | Update plugin config |

## Events API

| Method | Path | Description |
|--------|------|-------------|
| GET | \`/api/storm/events\` | Emitters, listeners, history |
| GET | \`/api/storm/events?limit=100\` | Custom history limit |

## Catalog API

| Method | Path | Description |
|--------|------|-------------|
| GET | \`/api/storm/catalog\` | All plugins with status + categories |
`,
  },
  auth: {
    title: "Auth Plugin",
    body: `## @stormstack/auth

Email/password authentication with JWT httpOnly cookies, RBAC, and multi-tenant.

### Install

\`\`\`bash
storm add auth             # npm mode
storm add auth --copy      # source copy mode
\`\`\`

### Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | \`/api/auth/register\` | Create account |
| POST | \`/api/auth/login\` | Login (sets httpOnly cookie) |
| POST | \`/api/auth/logout\` | Logout (clears cookie) |
| GET | \`/api/auth/me\` | Current user |

### Events Emitted

- \`user.registered\` — { userId, email, tenantId }
- \`user.logged_in\` — { userId, tenantId }
- \`user.logged_out\` — { userId, tenantId }

### Config Schema

| Field | Type | Default |
|-------|------|---------|
| sessionExpiryHours | number (1-720) | 24 |
| passwordMinLength | number (6-128) | 8 |
| allowRegistration | boolean | true |
| requireEmailVerification | boolean | false |

### Environment

| Variable | Required |
|----------|----------|
| \`SESSION_SECRET\` | Yes (min 32 chars) |

### Schema

- \`storm_users\` — id, email, passwordHash, name, role, emailVerified
- \`storm_tenants\` — multi-tenant workspace
- \`storm_tenant_members\` — user-tenant membership with roles
`,
  },
  crm: {
    title: "CRM Plugin",
    body: `## @stormstack/crm

Contacts, organisations, and deal pipeline.

### Events Emitted

- \`contact.created\` — { contactId, email, tenantId }
- \`deal.created\` — { dealId, title, tenantId }
- \`deal.stage_changed\` — { dealId, from, to, tenantId }
- \`deal.won\` — { dealId, value, tenantId }
- \`deal.lost\` — { dealId, tenantId }

### Event Listeners

- \`ticket.created\` — auto-logs ticket creation in CRM context

### Config Schema

| Field | Type | Default |
|-------|------|---------|
| defaultContactStatus | enum | lead |
| defaultDealStage | enum | new |
| currency | string (3 chars) | EUR |
| pipelineStages | string | new,qualified,proposal,negotiation,won,lost |

### Routes

#### Organizations
- \`GET /api/crm/organizations\` — List
- \`POST /api/crm/organizations\` — Create
- \`GET /api/crm/organizations/:id\` — Detail
- \`PATCH /api/crm/organizations/:id\` — Update
- \`DELETE /api/crm/organizations/:id\` — Delete

#### Contacts
- \`GET /api/crm/contacts\` — List
- \`POST /api/crm/contacts\` — Create
- \`PATCH /api/crm/contacts/:id\` — Update
- \`DELETE /api/crm/contacts/:id\` — Delete

#### Deals
- \`GET /api/crm/deals\` — List
- \`POST /api/crm/deals\` — Create
- \`PATCH /api/crm/deals/:id\` — Update (emits stage_changed/won/lost)
- \`DELETE /api/crm/deals/:id\` — Delete

### Deal Stages

\`new → qualified → proposal → negotiation → won/lost\`
`,
  },
  ticketing: {
    title: "Ticketing Plugin",
    body: `## @stormstack/ticketing

Support tickets with comments, labels, and status workflow.

### Events Emitted

- \`ticket.created\` — { ticketId, title, reporterId, tenantId }
- \`ticket.updated\` — { ticketId, changes, tenantId }
- \`ticket.resolved\` — { ticketId, resolvedBy, tenantId }
- \`ticket.closed\` — { ticketId, tenantId }
- \`ticket.comment_added\` — { ticketId, commentId, authorId, isInternal }

### Config Schema

| Field | Type | Default |
|-------|------|---------|
| defaultPriority | enum | medium |
| autoAssign | boolean | false |
| closedAfterDays | number (1-365) | 30 |
| allowPublicSubmission | boolean | false |

### Routes

#### Tickets
- \`GET /api/ticketing\` — List (filter: \`?status=open\`)
- \`POST /api/ticketing\` — Create
- \`GET /api/ticketing/:id\` — Detail + comments
- \`PATCH /api/ticketing/:id\` — Update
- \`DELETE /api/ticketing/:id\` — Delete

#### Comments
- \`POST /api/ticketing/:id/comments\` — Add comment
- \`PATCH /api/ticketing/:id/comments/:commentId\` — Edit
- \`DELETE /api/ticketing/:id/comments/:commentId\` — Delete

#### Labels
- \`GET /api/ticketing/labels\` — List
- \`POST /api/ticketing/labels\` — Create
- \`DELETE /api/ticketing/labels/:id\` — Delete

### Statuses

\`open → in_progress → waiting → resolved → closed\`

### Priorities

\`low | medium | high | urgent\`
`,
  },
  "lifecycle-hooks": {
    title: "Plugin Lifecycle Hooks",
    body: `## Overview

Storm Stack plugins can define lifecycle hooks that run at specific moments:

- **\`onInstall\`** — runs once when the plugin is first detected (first server boot after adding it)
- **\`onBoot\`** — runs on every server boot, after install
- **\`onUninstall\`** — runs when \`storm remove\` is called

## Defining Hooks

\`\`\`ts
import type { StormPlugin } from "@stormstack/core";

export const myPlugin: StormPlugin = {
  id: "@stormstack/my-plugin",
  name: "My Plugin",
  version: "0.1.0",
  description: "Example plugin with lifecycle hooks",
  lifecycle: {
    async onInstall(ctx) {
      // Seed default data, create indexes, etc.
      ctx.logger.info("First-time setup complete");
    },
    async onBoot(ctx) {
      // Warm caches, start background jobs, etc.
      ctx.logger.info("Plugin booted");
    },
    async onUninstall(ctx) {
      // Clean up external resources
      ctx.logger.info("Plugin removed");
    },
  },
};
\`\`\`

## Execution Order

1. Plugins are loaded in dependency order (topological sort)
2. For each plugin: if it's the first boot, \`onInstall\` runs first
3. Then \`onBoot\` runs (every boot)
4. The plugin is marked as installed in \`storm-lifecycle.json\`

## State Tracking

Storm Stack tracks which plugins have been installed in \`storm-lifecycle.json\` at the project root. This file is auto-managed — don't edit it manually.

When you run \`storm remove <plugin>\`, the CLI:
1. Calls the plugin's \`onUninstall\` hook (if defined)
2. Removes plugin files and wiring
3. Removes the plugin from \`storm-lifecycle.json\`

Re-adding the plugin later will trigger \`onInstall\` again.

## Events

Lifecycle hooks emit events on the event bus:
- \`plugin.installed\` — after \`onInstall\` completes
- \`plugin.booted\` — after \`onBoot\` completes

Other plugins can listen to these:

\`\`\`ts
events: {
  on: {
    "plugin.installed": async ({ pluginId }) => {
      console.log(\\\`New plugin: \\\${pluginId}\\\`);
    },
  },
},
\`\`\`

## Error Handling

If \`onInstall\` or \`onBoot\` throws, the server exits immediately (fail-fast). Fix the issue and restart.

If \`onUninstall\` throws during \`storm remove\`, the removal continues with a warning — uninstall hooks should be best-effort.
`,
  },
  "client-loader": {
    title: "Client-Side Plugin Loader",
    body: `## Overview

The \`@stormstack/react\` package provides a dynamic plugin loader that automatically registers routes and navigation from your plugin manifests. Plugin pages are **lazy-loaded** — only downloaded when the user navigates to them.

## Quick Start — StormApp

The easiest way to wire everything up:

\`\`\`tsx
import { StormApp, createPluginLoader } from "@stormstack/react";

const { components } = createPluginLoader([
  {
    pluginId: "@stormstack/crm",
    components: {
      CrmPage: () => import("./plugins/crm/client/CrmPage"),
      DealsPage: () => import("./plugins/crm/client/DealsPage"),
    },
  },
]);

function App() {
  return (
    <StormApp
      components={components}
      appName="My SaaS"
      loginComponent={LoginPage}
      dashboardComponent={DashboardPage}
    />
  );
}
\`\`\`

\`StormApp\` combines QueryClientProvider + StormProvider + StormLayout + StormRouter into one component. It handles auth guards, login redirect, lazy loading, and dynamic plugin routes automatically.

## createPluginLoader

Maps plugin IDs to their client-side component imports:

\`\`\`ts
const { components, pluginIds } = createPluginLoader([
  {
    pluginId: "@stormstack/crm",
    components: {
      CrmPage: () => import("./pages/ContactsPage"),
      DealsPage: () => import("./pages/DealsPage"),
    },
  },
]);
\`\`\`

Each component is wrapped in \`React.lazy()\` — the import only runs when the route is visited.

## createComponentMapFromGlob

For Vite projects, auto-discover plugin components from a glob pattern:

\`\`\`ts
const glob = import.meta.glob("./plugins/*/client/*.tsx");
const components = createComponentMapFromGlob(glob);
\`\`\`

Component names are derived from filenames: \`./plugins/crm/client/CrmPage.tsx\` registers as \`"CrmPage"\`.

## mergeComponentMaps

Combine plugin components with app-level components:

\`\`\`ts
const allComponents = mergeComponentMaps(
  pluginComponents,
  { SettingsPage: lazy(() => import("./pages/Settings")) },
);
\`\`\`

## PluginErrorBoundary

Each plugin route is automatically wrapped in an error boundary. If a lazy component fails to load, the boundary shows an error message with a retry button instead of crashing the app.

## usePluginComponent

Resolve a component name from the manifest at runtime:

\`\`\`tsx
const CrmPage = usePluginComponent("CrmPage");
if (CrmPage) return <CrmPage />;
\`\`\`

## Component Resolution

When a plugin declares routes in its manifest:

\`\`\`ts
client: {
  routes: [{ path: "/crm", component: "CrmPage", auth: true }],
}
\`\`\`

The \`StormRouter\` looks up \`"CrmPage"\` in the component map. If found, it renders the lazy component with auth guard. If not found, the route is skipped.

## Props Reference

| Component | Key Props |
|-----------|-----------|
| \`StormApp\` | components, appName, loginComponent, dashboardComponent, onLogout |
| \`StormProvider\` | components, apiBase, authEndpoint |
| \`StormRouter\` | fallback, loginPath, notFound, onPluginError |
| \`StormLayout\` | appName, version, onLogout, navProps |
| \`StormNav\` | prepend, append, userRole |
`,
  },
  testing: {
    title: "Plugin Testing",
    body: `## Overview

\`@stormstack/testing\` provides utilities for writing isolated plugin tests without a real database or running server.

\`\`\`bash
npm install -D @stormstack/testing
\`\`\`

## createTestContext

Creates a \`StormContext\` with sensible test defaults — mock db, test env, silent logger, and a live event bus.

\`\`\`ts
import { createTestContext } from "@stormstack/testing";

const ctx = createTestContext();
// ctx.env.NODE_ENV === "test"
// ctx.events is a real StormEventBus
// ctx.logger is silent (no output noise in tests)
\`\`\`

Override any part:

\`\`\`ts
const ctx = createTestContext({
  db: myTestDb,
  env: { STRIPE_KEY: "sk_test_xxx" },
  logger: { error: console.error }, // only log errors
});
\`\`\`

## createTestApp

Full Express app with plugins bootstrapped — ready for HTTP assertions.

\`\`\`ts
import { createTestApp, createMockPlugin } from "@stormstack/testing";
import { myPlugin } from "../src";

const { app, ctx, request, cleanup } = await createTestApp({
  plugins: [myPlugin],
});

const res = await request.get("/api/my-plugin/items");
expect(res.status).toBe(200);

// Always call cleanup when done
cleanup();
\`\`\`

The \`request\` helper provides \`.get()\`, \`.post()\`, \`.put()\`, \`.patch()\`, \`.delete()\` — each returns \`{ status, body, headers, text }\`.

## createMockPlugin

Quick throwaway plugin for testing interactions, dependencies, or lifecycle hooks.

\`\`\`ts
import { createMockPlugin } from "@stormstack/testing";

const dep = createMockPlugin({ id: "@stormstack/dep" });
const main = createMockPlugin({
  requires: ["@stormstack/dep"],
  lifecycle: {
    async onBoot(ctx) { /* ... */ },
  },
});
\`\`\`

Each call auto-increments the plugin ID. Call \`resetMockCounter()\` between tests.

## Event Assertions

Check which events the event bus recorded during a test:

\`\`\`ts
import {
  expectEventEmitted,
  expectEventNotEmitted,
  getEmittedEvents,
} from "@stormstack/testing";

await ctx.events.emit("ticket.created", { ticketId: "1" });

expectEventEmitted(ctx.events, "ticket.created");     // passes
expectEventNotEmitted(ctx.events, "ticket.deleted");   // passes

const events = getEmittedEvents(ctx.events, "ticket.created");
expect(events).toHaveLength(1);
expect(events[0].payload.ticketId).toBe("1");
\`\`\`

## Full Example

\`\`\`ts
import { describe, it, expect, afterEach } from "vitest";
import { createTestContext, createMockPlugin, resetMockCounter, expectEventEmitted } from "@stormstack/testing";

afterEach(() => resetMockCounter());

describe("billing plugin lifecycle", () => {
  it("seeds default plans on install", async () => {
    const seeded: string[] = [];
    const plugin = createMockPlugin({
      lifecycle: {
        async onInstall(ctx) {
          seeded.push("free", "pro", "enterprise");
        },
        async onBoot(ctx) {
          await ctx.events.emit("billing.ready", {});
        },
      },
    });

    const ctx = createTestContext();
    await plugin.lifecycle!.onInstall!(ctx);
    await plugin.lifecycle!.onBoot!(ctx);

    expect(seeded).toEqual(["free", "pro", "enterprise"]);
    expectEventEmitted(ctx.events, "billing.ready");
  });
});
\`\`\`
`,
  },
  deployment: {
    title: "Deployment",
    body: `## Production Build

\`\`\`bash
npm run build
npm start
\`\`\`

## Docker

\`\`\`dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
\`\`\`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`DATABASE_URL\` | Yes | PostgreSQL connection string |
| \`SESSION_SECRET\` | Yes | JWT secret (32+ chars) |
| \`PORT\` | No | Server port (default: 3000) |
| \`NODE_ENV\` | No | production/development |

## Database

\`\`\`bash
npm run db:push     # Apply schema (dev)
npm run db:generate # Generate SQL migration (prod)
\`\`\`

## Hosting

- **Railway** — one-click PostgreSQL + Node deploy
- **Fly.io** — global edge, Dockerfile deploy
- **VPS** — Docker Compose with Traefik
- **Vercel** — not recommended (no long-lived server)
`,
  },
};

export function DocsPage() {
  const params = useParams<{ section?: string }>();
  const activeSection = params.section ?? "getting-started";
  const content = CONTENT[activeSection];

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 flex gap-12">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 hidden md:block">
        <nav className="sticky top-20 space-y-1">
          {SECTIONS.map(({ id, label }) => (
            <Link
              key={id}
              href={`/docs/${id}`}
              className={clsx(
                "block px-3 py-1.5 text-sm rounded-md transition-colors",
                activeSection === id
                  ? "bg-storm-50 text-storm-700 font-medium"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0">
        {content ? (
          <article className="prose prose-gray prose-sm max-w-none prose-headings:font-semibold prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">{content.title}</h1>
            <div className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">
              {content.body}
            </div>
          </article>
        ) : (
          <p className="text-gray-500 text-sm">Section not found.</p>
        )}
      </main>
    </div>
  );
}
