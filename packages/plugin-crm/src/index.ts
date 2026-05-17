import type { StormPlugin } from "@stormstack/core";
import { organizations, contacts, deals, contactStatusEnum, dealStageEnum } from "./schema";
import { createCrmRoutes } from "./routes";

export { organizations, contacts, deals } from "./schema";
export type { Organization, InsertOrganization, Contact, InsertContact, Deal, InsertDeal } from "./schema";

export const crmPlugin: StormPlugin = {
  id: "@stormstack/crm",
  name: "CRM",
  version: "0.1.0",
  description: "Contacts, organisations et pipeline commercial pour agences et SaaS",
  tags: ["crm", "contacts", "pipeline", "sales"],
  pricing: "free",
  requires: ["@stormstack/auth"],

  schema: {
    tables: { organizations, contacts, deals },
    enums: { contactStatusEnum, dealStageEnum },
  },

  routes: ({ ctx, isAuthenticated }) => createCrmRoutes(ctx, isAuthenticated),

  client: {
    navItems: [
      { id: "crm", label: "CRM", icon: "Users", path: "/crm", roles: ["admin", "member"] },
    ],
    routes: [
      { path: "/crm", component: "CrmPage", auth: true },
      { path: "/crm/contacts/:id", component: "ContactDetailPage", auth: true },
      { path: "/crm/organizations/:id", component: "OrganizationDetailPage", auth: true },
      { path: "/crm/deals", component: "DealsPage", auth: true },
    ],
  },
};
