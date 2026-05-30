# Storm Stack

A plugin-based framework for building full-stack SaaS applications with Express, React, Drizzle ORM, and PostgreSQL.

## Quick Start

```bash
npx create-storm-app my-app
cd my-app
docker compose up -d
cp .env.example .env
npm install
npm run db:push
npm run dev
```

## Packages

| Package | Description |
|---------|-------------|
| [`@stormstack/core`](./packages/core) | Plugin registry & bootstrap engine |
| [`@stormstack/auth`](./packages/plugin-auth) | Email/password + JWT + RBAC |
| [`@stormstack/auth-social`](./packages/plugin-auth-social) | OAuth2 Google/GitHub/GitLab |
| [`@stormstack/crm`](./packages/plugin-crm) | Contacts, organisations, pipeline |
| [`@stormstack/ticketing`](./packages/plugin-ticketing) | Support tickets & helpdesk |
| [`@stormstack/stripe`](./packages/plugin-stripe) | Stripe payments & webhooks |
| [`@stormstack/react`](./packages/react) | React app shell, router, admin UI |
| [`@stormstack/testing`](./packages/testing) | Plugin test helpers |
| [`@stormstack/cli`](./packages/cli) | Plugin install, publish, migrations, Docker |
| [`create-storm-app`](./packages/create-storm-app) | CLI scaffold |

## Architecture

```
┌─────────────────────────────────────────────┐
│               Your Application              │
├─────────────────────────────────────────────┤
│  @stormstack/auth  │  @stormstack/crm  │ …  │  ← Plugins
├─────────────────────────────────────────────┤
│              @stormstack/core                │  ← Registry + Bootstrap
├─────────────────────────────────────────────┤
│   Express 5  │  Drizzle ORM  │  PostgreSQL  │  ← Foundation
└─────────────────────────────────────────────┘
```

Each plugin provides:
- **Schema** — Drizzle tables and enums
- **Routes** — Express router factory
- **Client manifest** — nav items, dock items, routes, settings panels
- **Lifecycle hooks** — onBoot, onInstall, onUninstall
- **Middleware** — app-level Express middleware

## Creating a plugin

```ts
import type { StormPlugin } from "@stormstack/core";
import { Router } from "express";
import { myTable } from "./schema";

export const myPlugin: StormPlugin = {
  id: "my-org/analytics",
  name: "Analytics",
  version: "1.0.0",
  description: "Page views and event tracking",
  requires: ["@stormstack/auth"],

  schema: { tables: { myTable } },

  routes: ({ ctx, isAuthenticated }) => {
    const router = Router();
    router.get("/events", isAuthenticated, async (req, res) => {
      const rows = await ctx.db.select().from(myTable).limit(100);
      res.json({ events: rows });
    });
    return router;
  },

  client: {
    navItems: [{ id: "analytics", label: "Analytics", icon: "BarChart", path: "/analytics" }],
  },
};
```

## Adding Plugins

Use the `storm` CLI to add plugins to an existing project:

```bash
# Install as npm package
npx @stormstack/cli add auth

# Or copy source code into your project (shadcn-style)
npx @stormstack/cli add crm --copy

# List all available plugins
npx @stormstack/cli list
```

The CLI auto-wires everything: imports, registry registration, Drizzle schema, npm dependencies.

## Development

Requires Node.js `>=20.19.0`. This repository pins `20.20.2` in `.nvmrc`.

```bash
git clone https://github.com/stormeoio/storm-stack.git
cd storm-stack
nvm use
npm install
npm run build
npm run lint
npm run typecheck
npm test
npm run pack:all
```

Release preparation and npm publishing are documented in [`docs/RELEASE.md`](./docs/RELEASE.md).

## MVP Status

Storm Stack v0.1.0 is release-ready locally: the monorepo lints, typechecks, builds, passes the full Vitest suite, smoke-tests an app generated outside the monorepo, and packs all public packages through `npm run release:check`. Publishing still requires a GitHub remote plus npm credentials.

## Roadmap

- [x] Plugin manifest TypeScript types
- [x] Plugin registry + topological sort
- [x] Bootstrap system (Express 5 mount)
- [x] Plugin event bus with typed pub/sub
- [x] Plugin lifecycle state (`onInstall`, `onBoot`, `onUninstall`)
- [x] Multi-tenant middleware and scoped query helpers
- [x] Auto-generated plugin settings UI from Zod schemas
- [x] `@stormstack/auth` — JWT + RBAC + multi-tenant
- [x] `@stormstack/auth-social` — OAuth2 (Google, GitHub, GitLab)
- [x] `@stormstack/crm` — contacts, organisations, pipeline
- [x] `@stormstack/ticketing` — tickets, comments, labels
- [x] `@stormstack/stripe` — payments and webhooks
- [x] `@stormstack/react` — app shell, dynamic router, admin dashboard
- [x] `@stormstack/testing` — plugin test utilities
- [x] `create-storm-app` — full-stack scaffold CLI
- [x] `apps/stormclaude` — admin dashboard
- [x] `storm add <plugin>` CLI — shadcn-style plugin management
- [x] `storm search`, `storm publish`, `storm create-plugin`
- [x] `storm deps`, `storm migrate`, `storm docker`, `storm update`
- [x] Storm Catalog (plugin marketplace registry + UI)
- [ ] npm publish (v0.1.0)
- [ ] Public GitHub remote + release tags

## License

MIT — framework and official plugins are free and open source.

---

*Built by [Stormeo](https://stormeo.io) — extracted from StormeoOS v3.7+*
