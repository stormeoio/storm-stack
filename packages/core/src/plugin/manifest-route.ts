import { Router } from "express";
import { registry } from "./registry";

/**
 * Mounts GET /api/storm/manifest  → client-side plugin manifests
 * Mounts GET /api/storm/plugins   → plugin metadata list
 * Call this once inside bootstrapPlugins.
 */
export function mountManifestRoute(apiPrefix: string): Router {
  const router = Router();

  router.get("/plugins", (req, res) => {
    const plugins = registry.getAll().map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      tags: p.tags ?? [],
      pricing: p.pricing ?? "free",
    }));
    res.json({ plugins });
  });

  router.get("/manifest", (req, res) => {
    const navItems = registry.getAll().flatMap((p) => p.client?.navItems ?? []);
    const dockItems = registry.getAll().flatMap((p) => p.client?.dockItems ?? []);
    const routes = registry.getAll().flatMap((p) => p.client?.routes ?? []);
    const settingsPanels = registry.getAll().flatMap((p) => p.client?.settingsPanels ?? []);
    res.json({ navItems, dockItems, routes, settingsPanels });
  });

  return router;
}
