import { pgTable, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";

export const contactStatusEnum = pgEnum("crm_contact_status", ["lead", "prospect", "client", "churned"]);
export const dealStageEnum = pgEnum("crm_deal_stage", ["new", "qualified", "proposal", "negotiation", "won", "lost"]);

export const organizations = pgTable("crm_organizations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  website: text("website"),
  industry: text("industry"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("crm_org_tenant_idx").on(t.tenantId),
}));

export const contacts = pgTable("crm_contacts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id").notNull(),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  status: contactStatusEnum("status").notNull().default("lead"),
  assignedTo: text("assigned_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("crm_contact_tenant_idx").on(t.tenantId),
  orgIdx: index("crm_contact_org_idx").on(t.organizationId),
}));

export const deals = pgTable("crm_deals", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id").notNull(),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  stage: dealStageEnum("stage").notNull().default("new"),
  value: text("value"),
  currency: text("currency").notNull().default("EUR"),
  expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
  assignedTo: text("assigned_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("crm_deal_tenant_idx").on(t.tenantId),
  stageIdx: index("crm_deal_stage_idx").on(t.stage),
}));

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type InsertContact = typeof contacts.$inferInsert;
export type Deal = typeof deals.$inferSelect;
export type InsertDeal = typeof deals.$inferInsert;
