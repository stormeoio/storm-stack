# @stormstack/core

Plugin registry and bootstrap engine for Storm Stack applications.

## Installation

```bash
npm install @stormstack/core
```

## Usage

```ts
import { registry, bootstrapPlugins } from "@stormstack/core";
import express from "express";

const app = express();
app.use(express.json());

// Register plugins
registry.register(myPlugin);

// Bootstrap all plugins onto Express
await bootstrapPlugins({ app, ctx: { db, env, logger } });

app.listen(3000);
```

## What it provides

- **Plugin Registry** — register, validate, and resolve plugin load order
- **Bootstrap** — mount middleware, lifecycle hooks, and routes in dependency order
- **Manifest API** — `GET /api/storm/plugins` and `GET /api/storm/manifest`
- **Type system** — `StormPlugin`, `StormContext`, `PluginRouteFactory`, etc.

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
