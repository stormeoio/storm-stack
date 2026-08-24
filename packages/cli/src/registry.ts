import { VERSION } from "./version";

export interface ClientComponentMapping {
  /** Name used in the server manifest (e.g. "CrmPage") */
  manifestName: string;
  /** Export name from the client module (e.g. "ContactsPage") */
  exportName: string;
}

export interface RootComponentMapping {
  /** React export mounted once in client/src/App.tsx. */
  exportName: string;
  /** Only render the component once StormProvider exposes an authenticated user. */
  authenticated?: boolean;
}

export interface PluginMeta {
  id: string;
  shortName: string;
  name: string;
  description: string;
  exportName: string;
  exportIsFactory: boolean;
  requires: string[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  files: string[];
  /** Client-side component files (for --copy mode, relative to plugin src/) */
  clientFiles?: string[];
  /** Maps manifest component names to export names for storm-components.ts */
  clientComponents?: ClientComponentMapping[];
  /** Optional application-level component mounted outside plugin routes. */
  rootComponent?: RootComponentMapping;
  envVars?: Record<string, { description: string; required: boolean; example?: string }>;
  status: "available" | "coming-soon";
}

export const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/stormeoio/storm-stack/v${VERSION}`;

export const PLUGINS: PluginMeta[] = [
  {
    id: "@stormstack/auth",
    shortName: "auth",
    name: "Auth",
    description: "Email/password + JWT cookies + RBAC + multi-tenant",
    exportName: "authPlugin",
    exportIsFactory: false,
    requires: [],
    dependencies: { bcryptjs: "^2.4.3", jsonwebtoken: "^9.0.0", "cookie-parser": "^1.4.6" },
    devDependencies: { "@types/bcryptjs": "^2.4.6", "@types/jsonwebtoken": "^9.0.0", "@types/cookie-parser": "^1.4.7" },
    files: ["index.ts", "schema.ts", "routes.ts", "middleware.ts"],
    clientFiles: ["client/LoginPage.tsx", "client/RegisterPage.tsx"],
    clientComponents: [
      { manifestName: "LoginPage", exportName: "LoginPage" },
      { manifestName: "RegisterPage", exportName: "RegisterPage" },
    ],
    envVars: {
      SESSION_SECRET: { description: "JWT signing secret (min 32 chars)", required: true, example: "change-me-to-a-long-random-secret" },
    },
    status: "available",
  },
  {
    id: "@stormstack/auth-social",
    shortName: "auth-social",
    name: "Auth Social",
    description: "OAuth2 Google/GitHub/GitLab",
    exportName: "authSocialPlugin",
    exportIsFactory: true,
    requires: ["@stormstack/auth"],
    dependencies: {},
    devDependencies: {},
    files: ["index.ts", "schema.ts", "routes.ts", "oauth.ts"],
    envVars: {
      GOOGLE_CLIENT_ID: { description: "Google OAuth client ID", required: false },
      GOOGLE_CLIENT_SECRET: { description: "Google OAuth client secret", required: false },
      GITHUB_CLIENT_ID: { description: "GitHub OAuth client ID", required: false },
      GITHUB_CLIENT_SECRET: { description: "GitHub OAuth client secret", required: false },
    },
    status: "available",
  },
  {
    id: "@stormstack/consent",
    shortName: "consent",
    name: "Consentement",
    description: "Préférences de consentement et cookies par utilisateur",
    exportName: "consentPlugin",
    exportIsFactory: false,
    requires: ["@stormstack/auth"],
    dependencies: {},
    devDependencies: {},
    files: [
      "index.ts",
      "schema.ts",
      "routes.ts",
      "version.ts",
      "client/index.ts",
      "client/ConsentBanner.tsx",
      "client/endpoints.ts",
    ],
    clientFiles: ["client/index.ts", "client/ConsentBanner.tsx", "client/endpoints.ts"],
    clientComponents: [
      { manifestName: "ConsentBanner", exportName: "ConsentBanner" },
    ],
    rootComponent: { exportName: "ConsentBanner", authenticated: true },
    status: "available",
  },
  {
    id: "@stormstack/crm",
    shortName: "crm",
    name: "CRM",
    description: "Contacts, organisations et pipeline commercial",
    exportName: "crmPlugin",
    exportIsFactory: false,
    requires: ["@stormstack/auth"],
    dependencies: {},
    devDependencies: {},
    files: ["index.ts", "schema.ts", "routes.ts"],
    clientFiles: ["client/CrmPage.tsx", "client/ContactDetailPage.tsx", "client/DealsPage.tsx"],
    clientComponents: [
      { manifestName: "CrmPage", exportName: "CrmPage" },
      { manifestName: "ContactDetailPage", exportName: "ContactDetailPage" },
      { manifestName: "DealsPage", exportName: "DealsPage" },
    ],
    status: "available",
  },
  {
    id: "@stormstack/ticketing",
    shortName: "ticketing",
    name: "Ticketing",
    description: "Support tickets, commentaires, labels",
    exportName: "ticketingPlugin",
    exportIsFactory: false,
    requires: ["@stormstack/auth"],
    dependencies: {},
    devDependencies: {},
    files: ["index.ts", "schema.ts", "routes.ts"],
    clientFiles: ["client/TicketsPage.tsx", "client/TicketDetailPage.tsx"],
    clientComponents: [
      { manifestName: "TicketsPage", exportName: "TicketsPage" },
      { manifestName: "TicketDetailPage", exportName: "TicketDetailPage" },
    ],
    status: "available",
  },
  {
    id: "@stormstack/stripe",
    shortName: "stripe",
    name: "Stripe",
    description: "Paiements Stripe, webhooks, abonnements",
    exportName: "stripePlugin",
    exportIsFactory: false,
    requires: ["@stormstack/auth"],
    dependencies: { stripe: "^14.0.0" },
    devDependencies: {},
    files: ["index.ts"],
    envVars: {
      STRIPE_SECRET_KEY: { description: "Stripe secret key", required: true, example: "sk_test_..." },
      STRIPE_WEBHOOK_SECRET: { description: "Stripe webhook signing secret", required: true, example: "whsec_..." },
    },
    status: "available",
  },
  {
    id: "@stormstack/billing",
    shortName: "billing",
    name: "Billing",
    description: "Facturation, abonnements récurrents, devis",
    exportName: "billingPlugin",
    exportIsFactory: false,
    requires: ["@stormstack/auth"],
    dependencies: {},
    devDependencies: {},
    files: [],
    status: "coming-soon",
  },
  {
    id: "@stormstack/cms",
    shortName: "cms",
    name: "CMS",
    description: "Gestion de contenu, pages, articles",
    exportName: "cmsPlugin",
    exportIsFactory: false,
    requires: ["@stormstack/auth"],
    dependencies: {},
    devDependencies: {},
    files: [],
    status: "coming-soon",
  },
  {
    id: "@stormstack/messaging",
    shortName: "messaging",
    name: "Messaging",
    description: "Messagerie interne, emails transactionnels",
    exportName: "messagingPlugin",
    exportIsFactory: false,
    requires: ["@stormstack/auth"],
    dependencies: {},
    devDependencies: {},
    files: [],
    status: "coming-soon",
  },
  {
    id: "@stormstack/drive",
    shortName: "drive",
    name: "Drive",
    description: "Stockage de fichiers, GED, partage",
    exportName: "drivePlugin",
    exportIsFactory: false,
    requires: ["@stormstack/auth"],
    dependencies: {},
    devDependencies: {},
    files: [],
    status: "coming-soon",
  },
  {
    id: "@stormstack/monitoring",
    shortName: "monitoring",
    name: "Monitoring",
    description: "Uptime, health checks, alertes",
    exportName: "monitoringPlugin",
    exportIsFactory: false,
    requires: ["@stormstack/auth"],
    dependencies: {},
    devDependencies: {},
    files: [],
    status: "coming-soon",
  },
];

export function resolvePlugin(nameOrId: string): PluginMeta | undefined {
  return PLUGINS.find(
    (p) => p.id === nameOrId || p.shortName === nameOrId || p.id === `@stormstack/${nameOrId}`,
  );
}

export function pluginSourceUrl(plugin: PluginMeta, file: string): string {
  return `${GITHUB_RAW_BASE}/packages/plugin-${plugin.shortName}/src/${file}`;
}
