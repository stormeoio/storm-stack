import type { Express } from "express";
import type { StormContext } from "./types";
import { registry } from "./registry";

export interface BootstrapOptions {
  app: Express;
  ctx: StormContext;
  /** Base path for all plugin API routes. Default: "/api" */
  apiPrefix?: string;
}

/**
 * Mounts all registered plugins onto the Express app.
 * Call this after registering all plugins and before app.listen().
 */
export async function bootstrapPlugins(opts: BootstrapOptions): Promise<void> {
  const { app, ctx, apiPrefix = "/api" } = opts;

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

  for (const plugin of orderedPlugins) {
    // Run onBoot lifecycle hook
    if (plugin.lifecycle?.onBoot) {
      try {
        await plugin.lifecycle.onBoot(ctx);
        console.log(`[storm-stack] ✓ ${plugin.id} booted`);
      } catch (err) {
        console.error(`[storm-stack] ✗ ${plugin.id} boot failed:`, err);
        process.exit(1);
      }
    }

    // Mount routes
    if (plugin.routes) {
      const router = plugin.routes({
        ctx,
        isAuthenticated: (req, res, next) => {
          if (!req.session?.userId) {
            return res.status(401).json({ error: "Non authentifié" });
          }
          next();
        },
      });
      const pluginPath = `${apiPrefix}/${plugin.id.replace("@stormstack/", "").replace("/", "-")}`;
      app.use(pluginPath, router);
      console.log(`[storm-stack] ✓ ${plugin.id} routes → ${pluginPath}`);
    }
  }

  console.log(
    `[storm-stack] ✓ ${orderedPlugins.length} plugin(s) bootstrapped`
  );
}
