import type { DocsContentEntry } from "./docsContentTypes";

export const DOC_CONTENT_PLUGINS: Record<string, DocsContentEntry> = {
  auth: {
    title: "Auth Plugin",
    body: `## @stormeoio/auth

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
    body: `## @stormeoio/crm

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
    body: `## @stormeoio/ticketing

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
import type { StormPlugin } from "@stormeoio/core";

export const myPlugin: StormPlugin = {
  id: "@stormeoio/my-plugin",
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

The \`@stormeoio/react\` package provides a dynamic plugin loader that automatically registers routes and navigation from your plugin manifests. Plugin pages are **lazy-loaded** — only downloaded when the user navigates to them.

## Quick Start — StormApp

The easiest way to wire everything up:

\`\`\`tsx
import { StormApp, createPluginLoader } from "@stormeoio/react";

const { components } = createPluginLoader([
  {
    pluginId: "@stormeoio/crm",
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
    pluginId: "@stormeoio/crm",
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
};
