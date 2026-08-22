# @stormstack/core

Plugin registry and bootstrap engine for Storm Stack applications.

## Installation

```bash
npm install @stormstack/core
```

## Usage

```ts
import { registry, bootstrapPlugins } from "@stormstack/core";
import { createDatabaseRoleGuard } from "@stormstack/auth";
import express from "express";

const app = express();
app.use(express.json());

// Register plugins
registry.register(myPlugin);

// Bootstrap all plugins onto Express. Administration authorization must be explicit.
await bootstrapPlugins({
  app,
  ctx: { db, env, logger },
  requireAdmin: createDatabaseRoleGuard(db, "admin"),
});

app.listen(3000);
```

## What it provides

- **Plugin Registry** — register, validate, and resolve plugin load order
- **Bootstrap** — mount middleware, lifecycle hooks, and routes in dependency order
- **Manifest API** — `GET /api/storm/plugins` and `GET /api/storm/manifest`
- **Type system** — `StormPlugin`, `StormContext`, `PluginRouteFactory`, etc.

## Administration authorization

`GET /api/storm/config`, `GET /api/storm/config/:pluginId`,
`PATCH /api/storm/config/:pluginId`, and `GET /api/storm/events` require both an
authenticated user and an application-provided `requireAdmin` middleware. Core
does not trust `req.user.role` by default because that value may come from a
still-valid JWT after the user's database role has changed.

Omitting `requireAdmin` is deliberately fail-closed:

- unauthenticated requests receive `401` from `isAuthenticated`;
- authenticated requests receive `503` with code `STORM_ADMIN_GUARD_REQUIRED`;
- an injected policy should return `403` when the current user is authenticated
  but is not an administrator.

Migration from `0.1.0`: inject a current-source-of-truth guard when calling
`bootstrapPlugins`. With `@stormstack/auth`, use:

```ts
import { createDatabaseRoleGuard } from "@stormstack/auth";

await bootstrapPlugins({
  app,
  ctx,
  requireAdmin: createDatabaseRoleGuard(ctx.db, "admin"),
});
```

Generated projects, `storm add auth`, and `storm update` wire this guard
automatically. Custom authentication systems must provide an equivalent
middleware that revalidates current administrator rights.

## Creating a plugin

```ts
import type { StormPlugin } from "@stormstack/core";

export const myPlugin: StormPlugin = {
  id: "my-org/my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  description: "Does something useful",
  routes: ({ ctx, isAuthenticated }) => {
    const router = Router();
    router.get("/hello", isAuthenticated, (req, res) => {
      res.json({ hello: "world" });
    });
    return router;
  },
};
```

## License

MIT
