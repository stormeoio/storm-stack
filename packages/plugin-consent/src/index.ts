import { getPluginConfig, type StormPlugin } from "@stormstack/core";
import { consentConfigSchema, createConsentRoutes } from "./routes";
import { consentPreferences } from "./schema";
import { PACKAGE_VERSION } from "./version";

export { consentConfigSchema, createConsentRoutes, consentPreferencesSchema } from "./routes";
export { consentPreferences } from "./schema";
export type { ConsentPreference, InsertConsentPreference } from "./schema";

export const consentPlugin: StormPlugin = {
  id: "@stormstack/consent",
  name: "Consentement",
  version: PACKAGE_VERSION,
  description: "Préférences de consentement et cookies, persistées par utilisateur",
  tags: ["consent", "cookies", "privacy", "rgpd", "gdpr"],
  pricing: "free",
  requires: ["@stormstack/auth"],

  events: {
    emits: ["consent.preferences_updated"],
  },

  configSchema: consentConfigSchema,

  schema: {
    tables: { consentPreferences },
  },

  routes: ({ ctx, isAuthenticated }) => createConsentRoutes(
    ctx,
    isAuthenticated,
    () => consentConfigSchema.parse(getPluginConfig("@stormstack/consent")).policyVersion,
  ),
};
