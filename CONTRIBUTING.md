# Contributing to Storm Stack

Thanks for your interest in contributing! Storm Stack is built on a plugin architecture — the best way to contribute is to create and share plugins.

## Creating a Plugin

The fastest way to scaffold a new plugin:

```bash
storm create-plugin my-plugin
```

This generates a ready-to-build plugin with:
- `src/index.ts` — StormPlugin definition (config, events, routes, client manifest)
- `src/schema.ts` — Drizzle ORM table (PostgreSQL)
- `src/routes.ts` — Express CRUD routes with Zod validation and tenant scoping
- `package.json` — dual ESM/CJS build via tsup
- `tsconfig.json` and `tsup.config.ts` — TypeScript and build config
- `README.md` — usage docs with route table

## Plugin Structure

Every plugin exports a `StormPlugin` object:

```ts
import type { StormPlugin } from "@stormeoio/core";

export const myPlugin: StormPlugin = {
  id: "@my-org/my-plugin",
  name: "MyPlugin",
  version: "0.1.0",
  description: "What the plugin does",
  tags: ["my-plugin"],
  pricing: "free",
  requires: ["@stormeoio/auth"],

  schema: { tables: { myItems } },

  configSchema: z.object({
    enabled: z.boolean().default(true),
  }),

  events: {
    emits: ["my-plugin.created", "my-plugin.updated", "my-plugin.deleted"],
  },

  routes: ({ ctx, isAuthenticated }) =>
    createMyPluginRoutes(ctx, isAuthenticated),

  client: {
    navItems: [{ id: "my-plugin", label: "MyPlugin", icon: "Puzzle", path: "/my-plugin" }],
    routes: [{ path: "/my-plugin", component: "MyPluginPage", auth: true }],
  },
};
```

## Development Workflow

```bash
# 1. Clone the monorepo
git clone https://github.com/stormeoio/storm-stack.git
cd storm-stack
npm install

# 2. Build all packages
npx turbo build

# 3. Scaffold your plugin inside the monorepo
storm create-plugin my-plugin
cd packages/plugin-my-plugin

# 4. Develop
npm run dev    # watch mode
npm run build  # production build

# 5. Test in a real project
cd /tmp && npx @stormeoio/create-storm-app test-app && cd test-app
storm add my-plugin --local /path/to/storm-stack --copy
storm dev
```

## Publishing to the Registry

```bash
# Preview the registry entry
storm publish my-plugin --dry-run

# Publish (appends to registry.json)
storm publish my-plugin
```

Then open a pull request adding your plugin to `registry.json`.

## Guidelines

- **One plugin, one concern.** A CRM plugin shouldn't bundle billing.
- **Tenant-scoped queries.** Always filter by `tenantId` in routes.
- **Zod validation.** Every POST/PATCH/PUT body must use `safeParse`.
- **Typed events.** Declare events in `events.emits` and emit via `ctx.events.emit()`.
- **Config schema.** Use `configSchema` (Zod) for settings — the admin dashboard auto-generates forms.
- **No `any`.** Use proper TypeScript types throughout.
- **Tests.** Add vitest tests for your routes and logic.

## Monorepo Layout

```
packages/
  core/              — Runtime: registry, event bus, bootstrap, tenant, config
  cli/               — CLI: add, remove, list, search, publish, create-plugin, dev
  create-storm-app/  — npx @stormeoio/create-storm-app scaffolder
  react/             — React components (settings forms, admin)
  plugin-auth/       — Auth plugin (JWT, RBAC, multi-tenant)
  plugin-crm/        — CRM plugin (contacts, orgs, deals)
  plugin-ticketing/  — Ticketing plugin (tickets, comments, labels)
  plugin-stripe/     — Stripe plugin (payments, webhooks)
  plugin-*/          — Other official plugins

apps/
  stormclaude/       — Reference app (server + client)
  docs/              — Documentation site
```

## Code Style

- TypeScript strict mode
- ESM + CJS dual output (tsup)
- Express 5 for routes
- Drizzle ORM for database
- Zod for validation
- No runtime dependencies on the full monorepo — plugins are self-contained

## License

MIT. By contributing, you agree that your contributions will be licensed under MIT.
