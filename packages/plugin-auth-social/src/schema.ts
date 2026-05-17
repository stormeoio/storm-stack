import { pgTable, text, timestamp, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";

export const oauthProviderEnum = pgEnum("oauth_provider", ["google", "github", "gitlab"]);

export const oauthAccounts = pgTable("oauth_accounts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  provider: oauthProviderEnum("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  providerAccountIdx: uniqueIndex("oauth_provider_account_idx").on(t.provider, t.providerAccountId),
}));

export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type InsertOAuthAccount = typeof oauthAccounts.$inferInsert;
export type OAuthProvider = "google" | "github" | "gitlab";
