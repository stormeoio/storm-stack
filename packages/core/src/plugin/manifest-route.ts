import { Router } from "express";
import { registry } from "./registry";

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
  { id: "@stormstack/auth", shortName: "auth", name: "Auth", description: "Email/password authentication with JWT cookies, RBAC, and multi-tenant support", tags: ["auth", "security", "rbac", "multi-tenant"], pricing: "free", requires: [], envVars: { SESSION_SECRET: { description: "JWT signing secret (min 32 chars)", required: true, example: "change-me-32-chars-min" } }, version: "0.1.0", category: "security" },
  { id: "@stormstack/auth-social", shortName: "auth-social", name: "Auth Social", description: "OAuth2 authentication with Google, GitHub, and GitLab", tags: ["auth", "oauth", "google", "github"], pricing: "free", requires: ["@stormstack/auth"], envVars: { GOOGLE_CLIENT_ID: { description: "Google OAuth client ID", required: false }, GITHUB_CLIENT_ID: { description: "GitHub OAuth client ID", required: false } }, version: "0.1.0", category: "security" },
  { id: "@stormstack/crm", shortName: "crm", name: "CRM", description: "Contacts, organisations et pipeline commercial pour agences et SaaS", tags: ["crm", "contacts", "pipeline", "sales"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: "0.1.0", category: "business" },
  { id: "@stormstack/ticketing", shortName: "ticketing", name: "Ticketing", description: "Support tickets, commentaires, labels et workflow de traitement", tags: ["ticketing", "support", "helpdesk"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: "0.1.0", category: "business" },
  { id: "@stormstack/stripe", shortName: "stripe", name: "Stripe", description: "Paiements Stripe, webhooks, abonnements et gestion des clients", tags: ["stripe", "payments", "billing", "webhooks"], pricing: "free", requires: ["@stormstack/auth"], envVars: { STRIPE_SECRET_KEY: { description: "Stripe secret key", required: true, example: "sk_test_..." }, STRIPE_WEBHOOK_SECRET: { description: "Stripe webhook secret", required: true, example: "whsec_..." } }, version: "0.1.0", category: "payments" },
  { id: "@stormstack/billing", shortName: "billing", name: "Billing", description: "Facturation, abonnements récurrents, devis et avoirs", tags: ["billing", "invoicing", "subscriptions"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: "0.1.0", category: "payments" },
  { id: "@stormstack/cms", shortName: "cms", name: "CMS", description: "Gestion de contenu, pages, articles et SEO", tags: ["cms", "content", "pages", "seo"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: "0.1.0", category: "content" },
  { id: "@stormstack/messaging", shortName: "messaging", name: "Messaging", description: "Messagerie interne, emails transactionnels et notifications", tags: ["messaging", "email", "notifications", "im"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: "0.1.0", category: "communication" },
  { id: "@stormstack/drive", shortName: "drive", name: "Drive", description: "Stockage de fichiers, GED et partage sécurisé", tags: ["drive", "files", "storage", "ged"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: "0.1.0", category: "content" },
  { id: "@stormstack/monitoring", shortName: "monitoring", name: "Monitoring", description: "Uptime monitoring, health checks et alertes", tags: ["monitoring", "uptime", "health", "alerts"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: "0.1.0", category: "devops" },
  { id: "@stormstack/rgpd", shortName: "rgpd", name: "RGPD", description: "Conformité RGPD, consentement et registre des traitements", tags: ["rgpd", "gdpr", "privacy", "compliance"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: "0.1.0", category: "security" },
  { id: "@stormstack/design", shortName: "design", name: "Design System", description: "Thème, composants UI, branding et tokens", tags: ["design", "ui", "theme", "branding"], pricing: "free", requires: [], envVars: {}, version: "0.1.0", category: "ui" },
  { id: "@stormstack/search", shortName: "search", name: "Search", description: "Recherche full-text, filtres avancés et indexation", tags: ["search", "fulltext", "indexing"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: "0.1.0", category: "content" },
  { id: "@stormstack/integrations", shortName: "integrations", name: "Integrations", description: "Webhooks, API publique et connecteurs tiers", tags: ["integrations", "webhooks", "api"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: "0.1.0", category: "devops" },
  { id: "@stormstack/vault", shortName: "vault", name: "Vault", description: "Stockage chiffré, gestion de secrets et clés API", tags: ["vault", "encryption", "secrets"], pricing: "free", requires: ["@stormstack/auth"], envVars: {}, version: "0.1.0", category: "security" },
  { id: "@stormstack/dock", shortName: "dock", name: "Dock", description: "Dock macOS-style, raccourcis et widgets flottants", tags: ["dock", "ui", "widgets", "shortcuts"], pricing: "free", requires: [], envVars: {}, version: "0.1.0", category: "ui" },
];

const AVAILABLE_IDS = new Set(["@stormstack/auth", "@stormstack/auth-social", "@stormstack/crm", "@stormstack/ticketing", "@stormstack/stripe"]);

/**
 * Mounts GET /api/storm/manifest  → client-side plugin manifests
 * Mounts GET /api/storm/plugins   → installed plugin metadata
 * Mounts GET /api/storm/catalog   → full catalog (installed + available + coming-soon)
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

  return router;
}
