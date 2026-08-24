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
    id: "@stormeoio/auth",
    serverImports: [
      `import { authPlugin, createDatabaseRoleGuard } from "@stormeoio/auth";`,
    ],
    registration: "registry.register(authPlugin);",
    schemaPath: "node_modules/@stormeoio/auth/dist/index.js",
  },
  {
    id: "@stormeoio/auth-social",
    requires: ["@stormeoio/auth"],
    serverImports: [`import { createSocialAuthPlugin } from "@stormeoio/auth-social";`],
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
    schemaPath: "node_modules/@stormeoio/auth-social/dist/index.js",
    envLines: ["", "# OAuth (optionnel)", "# GOOGLE_CLIENT_ID=", "# GOOGLE_CLIENT_SECRET=", "# GITHUB_CLIENT_ID=", "# GITHUB_CLIENT_SECRET="],
  },
  {
    id: "@stormeoio/consent",
    requires: ["@stormeoio/auth"],
    serverImports: [`import { consentPlugin } from "@stormeoio/consent";`],
    registration: "registry.register(consentPlugin);",
    schemaPath: "node_modules/@stormeoio/consent/dist/index.js",
    componentImports: [`import { ConsentBanner } from "@stormeoio/consent/client";`],
    componentEntries: ["  ConsentBanner,"],
  },
  {
    id: "@stormeoio/crm",
    requires: ["@stormeoio/auth"],
    serverImports: [`import { crmPlugin } from "@stormeoio/crm";`],
    registration: "registry.register(crmPlugin);",
    schemaPath: "node_modules/@stormeoio/crm/dist/index.js",
    componentImports: [`import { ContactsPage } from "./pages/ContactsPage";`, `import { ContactDetailPage } from "./pages/ContactDetailPage";`, `import { DealsPage } from "./pages/DealsPage";`],
    componentEntries: ["  CrmPage: ContactsPage,", "  ContactDetailPage,", "  DealsPage,"],
  },
  {
    id: "@stormeoio/ticketing",
    requires: ["@stormeoio/auth"],
    serverImports: [`import { ticketingPlugin } from "@stormeoio/ticketing";`],
    registration: "registry.register(ticketingPlugin);",
    schemaPath: "node_modules/@stormeoio/ticketing/dist/index.js",
    componentImports: [`import { TicketsPage } from "./pages/TicketsPage";`],
    componentEntries: ["  TicketsPage,"],
  },
  {
    id: "@stormeoio/stripe",
    requires: ["@stormeoio/auth"],
    serverImports: [`import type { Request } from "express";`, `import { stripePlugin } from "@stormeoio/stripe";`],
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
