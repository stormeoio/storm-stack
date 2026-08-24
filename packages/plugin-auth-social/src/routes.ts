import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { oauthAccounts } from "./schema";
import { PROVIDERS, buildAuthUrl, exchangeCode, fetchOAuthUser, type OAuthProviderConfig } from "./oauth";
import type { StormContext } from "@stormeoio/core";
import type { OAuthProvider } from "./schema";

export interface SocialAuthConfig {
  google?: OAuthProviderConfig;
  github?: OAuthProviderConfig;
  gitlab?: OAuthProviderConfig;
  /** Where to redirect after successful auth. Default: "/" */
  successRedirect?: string;
  /** Where to redirect on failure. Default: "/login" */
  failureRedirect?: string;
}

export function createSocialAuthRoutes(ctx: StormContext, config: SocialAuthConfig): Router {
  const router = Router();
  const { db, env } = ctx;
  const secret = env["SESSION_SECRET"] ?? "";

  const enabledProviders = Object.entries(config).filter(
    ([key, val]) => key in PROVIDERS && val != null
  ) as [OAuthProvider, OAuthProviderConfig][];

  for (const [providerName, providerConfig] of enabledProviders) {
    const providerDef = PROVIDERS[providerName]!;

    // GET /auth/:provider  → redirect to provider
    router.get(`/${providerName}`, (req, res) => {
      const state = crypto.randomUUID();
      // Store state in a short-lived cookie to verify on callback
      res.cookie(`oauth_state_${providerName}`, state, { httpOnly: true, maxAge: 5 * 60 * 1000 });
      res.redirect(buildAuthUrl(providerDef, providerConfig, state));
    });

    // GET /auth/:provider/callback  → exchange code, upsert user
    router.get(`/${providerName}/callback`, async (req, res) => {
      const { code, state } = req.query as { code?: string; state?: string };
      const storedState = req.cookies?.[`oauth_state_${providerName}`] as string | undefined;

      if (!code || !state || state !== storedState) {
        res.redirect(config.failureRedirect ?? "/login");
        return;
      }

      res.clearCookie(`oauth_state_${providerName}`);

      try {
        const accessToken = await exchangeCode(providerDef, providerConfig, code);
        const oauthUser = await fetchOAuthUser(providerDef, accessToken);

        // Look up existing OAuth account
        const [existing] = await db
          .select()
          .from(oauthAccounts)
          .where(and(eq(oauthAccounts.provider, providerName), eq(oauthAccounts.providerAccountId, oauthUser.id)))
          .limit(1);

        let userId: string;

        if (existing) {
          userId = existing.userId;
          await db.update(oauthAccounts).set({ accessToken, tokenExpiresAt: null }).where(eq(oauthAccounts.id, existing.id));
        } else {
          // Import users table from @stormeoio/auth at runtime to avoid circular deps
          const { users } = await import("@stormeoio/auth");

          // Try to find existing user by email, else create
          const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, oauthUser.email)).limit(1);

          if (existingUser) {
            userId = existingUser.id;
          } else {
            const [newUser] = await db.insert(users).values({
              email: oauthUser.email,
              name: oauthUser.name,
              passwordHash: "",
              emailVerified: true,
            }).returning({ id: users.id });
            if (!newUser) throw new Error("Failed to create user");
            userId = newUser.id;
          }

          await db.insert(oauthAccounts).values({
            userId,
            provider: providerName,
            providerAccountId: oauthUser.id,
            accessToken,
          });
        }

        // Issue JWT cookie via @stormeoio/auth helpers
        const { signToken, setAuthCookie } = await import("@stormeoio/auth");
        const { users } = await import("@stormeoio/auth");
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) throw new Error("User not found after OAuth");

        const token = signToken({ userId: user.id, email: user.email, role: user.role }, secret);
        setAuthCookie(res, token);
        res.redirect(config.successRedirect ?? "/");
      } catch (err) {
        ctx.logger.error("OAuth callback error", { provider: providerName, err });
        res.redirect(config.failureRedirect ?? "/login");
      }
    });
  }

  // GET /auth/providers  → list enabled providers (for frontend)
  router.get("/providers", (req, res) => {
    res.json({ providers: enabledProviders.map(([name]) => name) });
  });

  return router;
}
