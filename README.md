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

```bash
git clone https://github.com/stormeoio/storm-stack.git
cd storm-stack
npm install
npm run build
npm run typecheck
```

## Roadmap

- [x] Plugin manifest TypeScript types
- [x] Plugin registry + topological sort
- [x] Bootstrap system (Express 5 mount)
- [x] `@stormstack/auth` — JWT + RBAC + multi-tenant
- [x] `@stormstack/auth-social` — OAuth2 (Google, GitHub, GitLab)
- [x] `@stormstack/crm` — contacts, organisations, pipeline
- [x] `@stormstack/ticketing` — tickets, comments, labels
- [x] `create-storm-app` — full-stack scaffold CLI
- [x] `apps/stormclaude` — admin dashboard
- [x] `storm add <plugin>` CLI — shadcn-style plugin management
- [ ] npm publish (v0.1.0)
- [ ] Storm Catalog (plugin marketplace)

## License

MIT — framework and official plugins are free and open source.

---

*Built by [Stormeo](https://stormeo.io) — extracted from StormeoOS v3.7+*
