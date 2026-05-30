import type { StormPlugin } from "@stormstack/core";
import { z } from "zod";
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

  events: {
    emits: [
      "contact.created",
      "contact.updated",
      "contact.deleted",
      "organization.created",
      "deal.created",
      "deal.stage_changed",
      "deal.won",
      "deal.lost",
    ],
    on: {
      /** When a ticket is created, log it — future: link to contact activity feed */
      "ticket.created": async (event, ctx) => {
        const { ticketId, tenantId } = event.payload as { ticketId: string; tenantId: string };
        ctx.logger.info("[crm] Ticket created — could enrich contact activity", {
          ticketId,
          tenantId,
        });
      },
    },
  },

  configSchema: z.object({
    defaultContactStatus: z.enum(["lead", "prospect", "client", "churned"]).default("lead").describe("Default status for new contacts"),
    defaultDealStage: z.enum(["discovery", "proposal", "negotiation", "closed_won", "closed_lost"]).default("discovery").describe("Default stage for new deals"),
    currency: z.string().default("EUR").describe("Default currency for deals"),
    pipelineStages: z.number().min(3).max(10).default(5).describe("Number of pipeline columns"),
  }),

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
      { path: "/crm/deals", component: "DealsPage", auth: true },
    ],
  },
};
