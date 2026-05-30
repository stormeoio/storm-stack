import type { Express, RequestHandler } from "express";
import type { StormContext } from "./types";
import { registry } from "./registry";
import { mountManifestRoute } from "./manifest-route";
import { initConfigStore } from "./config-store";
import { eventBus } from "./event-bus";
import { createTenantMiddleware, type TenantResolverOptions } from "./tenant";
import { initLifecycleState, isPluginInstalled, markPluginInstalled } from "./lifecycle-state";

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
  /**
   * Multi-tenant configuration. If provided, tenant resolution middleware
   * is mounted globally after auth middleware.
   * If omitted, falls back to single-tenant mode (userId = tenantId).
   */
  tenant?: Omit<TenantResolverOptions, "getDb">;
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

  // 0. Initialize config store, lifecycle state + event bus
  initConfigStore(projectRoot);
  initLifecycleState(projectRoot);
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

  // 4. Mount tenant resolution middleware (after auth middleware from step 3)
  const tenantMiddleware = createTenantMiddleware({
    getDb: () => ctx.db,
    ...opts.tenant,
  });
  app.use(tenantMiddleware);
  console.log(`[storm-stack] ✓ tenant middleware mounted (${opts.tenant?.tables ? "multi-tenant" : "single-tenant"})`);

  // 5. Register plugin event handlers (before boot, so handlers are ready)
  for (const plugin of orderedPlugins) {
    if (plugin.events?.on) {
      for (const [eventName, handler] of Object.entries(plugin.events.on)) {
        eventBus.on(eventName, handler);
        console.log(`[storm-stack] ✓ ${plugin.id} listens → ${eventName}`);
      }
    }
  }

  // 6. Run lifecycle hooks (onInstall for first-time, then onBoot) and mount routes
  for (const plugin of orderedPlugins) {
    const firstTime = !isPluginInstalled(plugin.id);

    if (firstTime && plugin.lifecycle?.onInstall) {
      try {
        await plugin.lifecycle.onInstall(ctx);
        console.log(`[storm-stack] ✓ ${plugin.id} installed`);
      } catch (err) {
        console.error(`[storm-stack] ✗ ${plugin.id} install hook failed:`, err);
        process.exit(1);
      }
      await eventBus.emit("plugin.installed", { pluginId: plugin.id }, plugin.id);
    }

    if (firstTime) {
      markPluginInstalled(plugin.id);
    }

    if (plugin.lifecycle?.onBoot) {
      try {
        await plugin.lifecycle.onBoot(ctx);
        console.log(`[storm-stack] ✓ ${plugin.id} booted`);
      } catch (err) {
        console.error(`[storm-stack] ✗ ${plugin.id} boot failed:`, err);
        process.exit(1);
      }
    }

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
