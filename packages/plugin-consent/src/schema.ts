import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const consentPreferences = pgTable("storm_consent_preferences", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  necessary: boolean("necessary").notNull().default(true),
  analytics: boolean("analytics").notNull().default(false),
  marketing: boolean("marketing").notNull().default(false),
  policyVersion: text("policy_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIdx: uniqueIndex("storm_consent_preferences_user_id_idx").on(table.userId),
  necessaryAlwaysTrue: check(
    "storm_consent_preferences_necessary_true",
    sql`${table.necessary} = true`,
  ),
}));

export type ConsentPreference = typeof consentPreferences.$inferSelect;
export type InsertConsentPreference = typeof consentPreferences.$inferInsert;
