import type { Express, RequestHandler } from "express";
import type { StormContext } from "./types";
import { registry } from "./registry";
import { mountManifestRoute } from "./manifest-route";
import { initConfigStore } from "./config-store";
import { eventBus } from "./event-bus";

export interface BootstrapOptions {
  app: Express;
  ctx: StormContext;
  /** Base path for all plugin API routes. Default: "/api" */
  apiPrefix?: string;
  /** Project root directory — used for config file storage. Default: process.cwd() */
  projectRoot?: string;
  /**
   * isAuthenticated middleware used by all plugins.
   * If not provided, falls back to a basic req.user check.
   * Typically obtained from @stormstack/auth's createAuthMiddleware().
   */
  isAuthenticated?: RequestHandler;
}

const defaultIsAuthenticated: RequestHandler = (req, res, next) => {
  if (!req.user?.id) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  next();
};

/**
 * Mounts all registered plugins onto the Express app.
 * Call this after registering all plugins and before app.listen().
 */
export async function bootstrapPlugins(opts: BootstrapOptions): Promise<void> {
  const { app, ctx, apiPrefix = "/api", projectRoot = process.cwd(), isAuthenticated = defaultIsAuthenticated } = opts;

  // 0. Initialize config store + event bus
  initConfigStore(projectRoot);
  eventBus.setContext(ctx);
  ctx.events = eventBus;

  // 1. Validate — fail fast if dependencies are missing
  const validation = registry.validate();
  if (!validation.valid) {
    console.error("[storm-stack] Plugin validation failed:");
    for (const err of validation.errors) {
      console.error("  ✗", err);
    }
    process.exit(1);
  }

  // 2. Boot in dependency order
  const orderedPlugins = registry.resolveLoadOrder();

  // 3. Mount appMiddleware for all plugins first (before any routes)
  for (const plugin of orderedPlugins) {
    if (plugin.appMiddleware) {
      const handlers = plugin.appMiddleware(ctx);
      for (const handler of handlers) {
        app.use(handler);
      }
      console.log(`[storm-stack] ✓ ${plugin.id} middleware mounted`);
    }
  }

  // 4. Register plugin event handlers (before boot, so handlers are ready)
  for (const plugin of orderedPlugins) {
    if (plugin.events?.on) {
      for (const [eventName, handler] of Object.entries(plugin.events.on)) {
        eventBus.on(eventName, handler);
        console.log(`[storm-stack] ✓ ${plugin.id} listens → ${eventName}`);
      }
    }
  }

  // 5. Run onBoot lifecycle hooks and mount routes
  for (const plugin of orderedPlugins) {
    if (plugin.lifecycle?.onBoot) {
      try {
        await plugin.lifecycle.onBoot(ctx);
        console.log(`[storm-stack] ✓ ${plugin.id} booted`);
      } catch (err) {
        console.error(`[storm-stack] ✗ ${plugin.id} boot failed:`, err);
        process.exit(1);
      }
    }

    // Emit plugin.booted event
    await eventBus.emit("plugin.booted", { pluginId: plugin.id }, plugin.id);

    if (plugin.routes) {
      const router = plugin.routes({ ctx, isAuthenticated });
      const pluginPath = `${apiPrefix}/${plugin.id.replace("@stormstack/", "").replace("/", "-")}`;
      app.use(pluginPath, router);
      console.log(`[storm-stack] ✓ ${plugin.id} routes → ${pluginPath}`);
    }
  }

  // Mount /api/storm/plugins + /api/storm/manifest + /api/storm/events
  app.use(`${apiPrefix}/storm`, mountManifestRoute(apiPrefix));

  console.log(`[storm-stack] ✓ ${orderedPlugins.length} plugin(s) bootstrapped`);
}
