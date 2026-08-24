import type { StormPlugin } from "@stormstack/core";
import { oauthAccounts, oauthProviderEnum } from "./schema";
import { createSocialAuthRoutes, type SocialAuthConfig } from "./routes";
import { PACKAGE_VERSION } from "./version";

export { oauthAccounts, oauthProviderEnum } from "./schema";
export type { OAuthAccount, InsertOAuthAccount, OAuthProvider } from "./schema";
export type { SocialAuthConfig } from "./routes";

export function createSocialAuthPlugin(config: SocialAuthConfig): StormPlugin {
  const enabledProviders = (["google", "github", "gitlab"] as const).filter((p) => config[p] != null);

  return {
    id: "@stormstack/auth-social",
    name: "Auth Social",
    version: PACKAGE_VERSION,
    description: `OAuth2 login via ${enabledProviders.join(", ")}`,
    tags: ["auth", "oauth", "social", "google", "github"],
    pricing: "free",
    requires: ["@stormstack/auth"],

    env: {
      ...(config.google ? {
        GOOGLE_CLIENT_ID: { description: "Google OAuth2 Client ID", required: true },
        GOOGLE_CLIENT_SECRET: { description: "Google OAuth2 Client Secret", required: true },
      } : {}),
      ...(config.github ? {
        GITHUB_CLIENT_ID: { description: "GitHub OAuth App Client ID", required: true },
        GITHUB_CLIENT_SECRET: { description: "GitHub OAuth App Client Secret", required: true },
      } : {}),
      ...(config.gitlab ? {
        GITLAB_CLIENT_ID: { description: "GitLab OAuth2 Application ID", required: true },
        GITLAB_CLIENT_SECRET: { description: "GitLab OAuth2 Secret", required: true },
      } : {}),
    },

    schema: {
      tables: { oauthAccounts },
      enums: { oauthProviderEnum },
    },

    routes: ({ ctx }) => createSocialAuthRoutes(ctx, config),

    client: {
      routes: [
        { path: "/auth/social/callback", component: "SocialAuthCallbackPage", auth: false },
      ],
    },
  };
}
