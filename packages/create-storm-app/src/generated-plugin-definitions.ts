interface GeneratedPluginDefinition {
  id: string;
  requires?: string[];
  serverImports: string[];
  registration: string;
  schemaPath?: string;
  envLines?: string[];
  componentImports?: string[];
  componentEntries?: string[];
}

// Generator-local source of truth; this intentionally is not a second manifest API.
export const generatedPluginDefinitions: GeneratedPluginDefinition[] = [
  {
    id: "@stormstack/auth",
    serverImports: [
      `import { authPlugin, createDatabaseRoleGuard } from "@stormstack/auth";`,
    ],
    registration: "registry.register(authPlugin);",
    schemaPath: "node_modules/@stormstack/auth/dist/index.js",
  },
  {
    id: "@stormstack/auth-social",
    requires: ["@stormstack/auth"],
    serverImports: [`import { createSocialAuthPlugin } from "@stormstack/auth-social";`],
    registration: `if (env["GOOGLE_CLIENT_ID"] || env["GITHUB_CLIENT_ID"]) {
  const socialPlugin = createSocialAuthPlugin({
    google: env["GOOGLE_CLIENT_ID"]
      ? { clientId: env["GOOGLE_CLIENT_ID"]!, clientSecret: env["GOOGLE_CLIENT_SECRET"]!, callbackUrl: "http://localhost:" + PORT + "/api/auth-social/google/callback" }
      : undefined,
    github: env["GITHUB_CLIENT_ID"]
      ? { clientId: env["GITHUB_CLIENT_ID"]!, clientSecret: env["GITHUB_CLIENT_SECRET"]!, callbackUrl: "http://localhost:" + PORT + "/api/auth-social/github/callback" }
      : undefined,
  });
  registry.register(socialPlugin);
}`,
    schemaPath: "node_modules/@stormstack/auth-social/dist/index.js",
    envLines: ["", "# OAuth (optionnel)", "# GOOGLE_CLIENT_ID=", "# GOOGLE_CLIENT_SECRET=", "# GITHUB_CLIENT_ID=", "# GITHUB_CLIENT_SECRET="],
  },
  {
    id: "@stormstack/consent",
    requires: ["@stormstack/auth"],
    serverImports: [`import { consentPlugin } from "@stormstack/consent";`],
    registration: "registry.register(consentPlugin);",
    schemaPath: "node_modules/@stormstack/consent/dist/index.js",
    componentImports: [`import { ConsentBanner } from "@stormstack/consent/client";`],
    componentEntries: ["  ConsentBanner,"],
  },
  {
    id: "@stormstack/crm",
    requires: ["@stormstack/auth"],
    serverImports: [`import { crmPlugin } from "@stormstack/crm";`],
    registration: "registry.register(crmPlugin);",
    schemaPath: "node_modules/@stormstack/crm/dist/index.js",
    componentImports: [`import { ContactsPage } from "./pages/ContactsPage";`, `import { ContactDetailPage } from "./pages/ContactDetailPage";`, `import { DealsPage } from "./pages/DealsPage";`],
    componentEntries: ["  CrmPage: ContactsPage,", "  ContactDetailPage,", "  DealsPage,"],
  },
  {
    id: "@stormstack/ticketing",
    requires: ["@stormstack/auth"],
    serverImports: [`import { ticketingPlugin } from "@stormstack/ticketing";`],
    registration: "registry.register(ticketingPlugin);",
    schemaPath: "node_modules/@stormstack/ticketing/dist/index.js",
    componentImports: [`import { TicketsPage } from "./pages/TicketsPage";`],
    componentEntries: ["  TicketsPage,"],
  },
  {
    id: "@stormstack/stripe",
    requires: ["@stormstack/auth"],
    serverImports: [`import type { Request } from "express";`, `import { stripePlugin } from "@stormstack/stripe";`],
    registration: "registry.register(stripePlugin);",
    envLines: ["", "# Stripe", "STRIPE_SECRET_KEY=sk_test_...", "STRIPE_WEBHOOK_SECRET=whsec_..."],
  },
];

export function resolveGeneratedPluginIds(pluginIds: string[]): string[] {
  const knownIds = new Set(generatedPluginDefinitions.map(({ id }) => id));
  const unknownIds = pluginIds.filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) {
    throw new Error(`Unknown generated plugin(s): ${unknownIds.join(", ")}`);
  }

  const resolved = new Set(pluginIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of generatedPluginDefinitions) {
      if (!resolved.has(definition.id)) continue;
      for (const dependency of definition.requires ?? []) {
        if (!resolved.has(dependency)) {
          resolved.add(dependency);
          changed = true;
        }
      }
    }
  }

  return generatedPluginDefinitions
    .filter(({ id }) => resolved.has(id))
    .map(({ id }) => id);
}

export function selectGeneratedPluginDefinitions(pluginIds: string[]): GeneratedPluginDefinition[] {
  const resolvedIds = new Set(resolveGeneratedPluginIds(pluginIds));
  return generatedPluginDefinitions.filter(({ id }) => resolvedIds.has(id));
}
