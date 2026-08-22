import { Router, type RequestHandler } from "express";
import { registry } from "./registry";
import { getPluginConfig, setPluginConfig, getAllConfigs, zodSchemaToDescriptor, type FieldDescriptor } from "./config-store";
import { eventBus } from "./event-bus";
import { PACKAGE_VERSION } from "../version";
import { rejectUnconfiguredStormAdmin, requireStormUser } from "./admin-guards";

// ─── Full catalog of known plugins (installed + available + coming-soon) ─────

interface CatalogEntry {
  id: string;
  shortName: string;
  name: string;
  description: string;
  tags: string[];
  pricing: "free" | "premium" | "enterprise";
  requires: string[];
  envVars: Record<string, { description: string; required: boolean; example?: string }>;
  status: "installed" | "available" | "coming-soon";
  version: string;
  category: string;
}

const CATALOG_REGISTRY: Omit<CatalogEntry, "status">[] = [
  { id: "@stormstack/auth", shortName: "auth", name: "Auth", description: "Email/password authentication with JWT cookies, RBAC, and multi-tenant support", tags: ["auth", "security", "rbac", "multi-tenant"], pricing: "free", requires: [], envVars: { SESSION_SECRET: { description: "JWT signing secret (min 32 chars)", required: true, example: "change-me-32-chars-min" } }, version: PACKAGE_VERSION, category: "security" },
  { id: "@stormstack/auth-social", shortName: "auth-social", name: "Auth Social", description: "OAuth2 authentication with Google, GitHub, and GitLab", tags: ["auth", "oauth", "google", "github"], pricing: "free", requires: ["@stormstack/auth"], envVars: { GOOGLE_CLIENT_ID: { description: "Google OAuth client ID", required: false }, GITHUB_CLIENT_ID: { description: "GitHub OAuth client ID", required: false } }, version: PACKAGE_VERSION, category: "security" },
  { id: "@stormstack/consent", shortName: "consent", name: "Consentement", description: "Préférences de consentement et cookies par utilisateur", tags: ["consent", "cookies", "privacy", "rgpd", "gdpr"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: PACKAGE_VERSION, category: "compliance" },
  { id: "@stormstack/crm", shortName: "crm", name: "CRM", description: "Contacts, organisations et pipeline commercial pour agences et SaaS", tags: ["crm", "contacts", "pipeline", "sales"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: PACKAGE_VERSION, category: "business" },
  { id: "@stormstack/ticketing", shortName: "ticketing", name: "Ticketing", description: "Support tickets, commentaires, labels et workflow de traitement", tags: ["ticketing", "support", "helpdesk"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: PACKAGE_VERSION, category: "business" },
  { id: "@stormstack/stripe", shortName: "stripe", name: "Stripe", description: "Paiements Stripe, webhooks, abonnements et gestion des clients", tags: ["stripe", "payments", "billing", "webhooks"], pricing: "free", requires: ["@stormstack/auth"], envVars: { STRIPE_SECRET_KEY: { description: "Stripe secret key", required: true, example: "sk_test_..." }, STRIPE_WEBHOOK_SECRET: { description: "Stripe webhook secret", required: true, example: "whsec_..." } }, version: PACKAGE_VERSION, category: "payments" },
  { id: "@stormstack/billing", shortName: "billing", name: "Billing", description: "Facturation, abonnements récurrents, devis et avoirs", tags: ["billing", "invoicing", "subscriptions"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: PACKAGE_VERSION, category: "payments" },
  { id: "@stormstack/cms", shortName: "cms", name: "CMS", description: "Gestion de contenu, pages, articles et SEO", tags: ["cms", "content", "pages", "seo"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: PACKAGE_VERSION, category: "content" },
  { id: "@stormstack/messaging", shortName: "messaging", name: "Messaging", description: "Messagerie interne, emails transactionnels et notifications", tags: ["messaging", "email", "notifications", "im"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: PACKAGE_VERSION, category: "communication" },
  { id: "@stormstack/drive", shortName: "drive", name: "Drive", description: "Stockage de fichiers, GED et partage sécurisé", tags: ["drive", "files", "storage", "ged"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: PACKAGE_VERSION, category: "content" },
  { id: "@stormstack/monitoring", shortName: "monitoring", name: "Monitoring", description: "Uptime monitoring, health checks et alertes", tags: ["monitoring", "uptime", "health", "alerts"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: PACKAGE_VERSION, category: "devops" },
];

const AVAILABLE_IDS = new Set(["@stormstack/auth", "@stormstack/auth-social", "@stormstack/consent", "@stormstack/crm", "@stormstack/ticketing", "@stormstack/stripe"]);

/**
 * Mounts public discovery endpoints and protected administration endpoints.
 * Call this once inside bootstrapPlugins.
 */
export interface ManifestRouteGuards {
  /** Authentication guard for reads that expose stored application settings. */
  isAuthenticated?: RequestHandler;
  /**
   * Authorization guard for project-wide administration operations.
   * Omission fails closed with 503 instead of trusting req.user.role.
   */
  requireAdmin?: RequestHandler;
}

export function mountManifestRoute(
  _apiPrefix: string,
  guards: ManifestRouteGuards = {},
): Router {
  const router = Router();
  const isAuthenticated = guards.isAuthenticated ?? requireStormUser;
  const requireAdmin = guards.requireAdmin ?? rejectUnconfiguredStormAdmin;

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

    // Build config schemas for the settings UI
    const configSchemas: Record<string, Record<string, FieldDescriptor>> = {};
    for (const plugin of registry.getAll()) {
      if (plugin.configSchema) {
        configSchemas[plugin.id] = zodSchemaToDescriptor(plugin.configSchema);
      }
    }

    res.json({ navItems, dockItems, routes, settingsPanels, configSchemas });
  });

  router.get("/catalog", (req, res) => {
    const installedIds = new Set(registry.getAll().map((p) => p.id));

    const catalog: CatalogEntry[] = CATALOG_REGISTRY.map((entry) => ({
      ...entry,
      status: installedIds.has(entry.id)
        ? "installed" as const
        : AVAILABLE_IDS.has(entry.id)
          ? "available" as const
          : "coming-soon" as const,
    }));

    const categories = [...new Set(catalog.map((e) => e.category))].sort();

    res.json({ catalog, categories });
  });

  // ─── Plugin config API ──────────────────────────────────────────────────

  /** GET /api/storm/config — all plugin configs (admin only; may contain secrets) */
  router.get("/config", isAuthenticated, requireAdmin, (_req, res) => {
    res.json({ configs: getAllConfigs() });
  });

  /** GET /api/storm/config/:pluginId — single plugin config (admin only) */
  router.get("/config/:pluginId", isAuthenticated, requireAdmin, (req, res) => {
    const pluginId = decodeURIComponent(req.params["pluginId"] as string);
    const plugin = registry.get(pluginId);
    if (!plugin) {
      res.status(404).json({ error: `Plugin "${pluginId}" not found` });
      return;
    }
    if (!plugin.configSchema) {
      res.status(404).json({ error: `Plugin "${pluginId}" has no configurable settings` });
      return;
    }
    res.json({ pluginId, config: getPluginConfig(pluginId) });
  });

  /** GET /api/storm/events — event bus introspection and history (admin only) */
  router.get("/events", isAuthenticated, requireAdmin, (req, res) => {
    const plugins = registry.getAll();
    const emitters: Record<string, string[]> = {};
    const listeners: Record<string, string[]> = {};

    for (const plugin of plugins) {
      if (plugin.events?.emits?.length) {
        emitters[plugin.id] = plugin.events.emits;
      }
      if (plugin.events?.on) {
        listeners[plugin.id] = Object.keys(plugin.events.on);
      }
    }

    const limit = Math.min(Number(req.query["limit"]) || 50, 200);
    const history = eventBus.getHistory(limit);

    res.json({ emitters, listeners, history });
  });

  /** PATCH /api/storm/config/:pluginId — update plugin config */
  router.patch("/config/:pluginId", isAuthenticated, requireAdmin, (req, res) => {
    const pluginId = decodeURIComponent(req.params["pluginId"] as string);
    const plugin = registry.get(pluginId);
    if (!plugin) {
      res.status(404).json({ error: `Plugin "${pluginId}" not found` });
      return;
    }
    if (!plugin.configSchema) {
      res.status(400).json({ error: `Plugin "${pluginId}" has no configurable settings` });
      return;
    }

    const result = setPluginConfig(pluginId, req.body);
    if (!result.success) {
      res.status(400).json({ error: "Validation failed", details: result.errors });
      return;
    }
    res.json({ pluginId, config: result.data });
  });

  return router;
}
