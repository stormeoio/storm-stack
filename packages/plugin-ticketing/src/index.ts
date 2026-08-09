import type { StormPlugin } from "@stormstack/core";
import { z } from "zod";
import { tickets, ticketComments, ticketLabels, ticketStatusEnum, ticketPriorityEnum } from "./schema";
import { createTicketingRoutes } from "./routes";
import { PACKAGE_VERSION } from "./version";

export {
  tickets,
  ticketComments,
  ticketLabels,
  ticketStatusEnum,
  ticketPriorityEnum,
} from "./schema";
export type { Ticket, InsertTicket, TicketComment, TicketLabel } from "./schema";

export const ticketingPlugin: StormPlugin = {
  id: "@stormstack/ticketing",
  name: "Ticketing",
  version: PACKAGE_VERSION,
  description: "Tickets support, commentaires internes et labels pour gérer les demandes clients",
  tags: ["support", "tickets", "feedback", "helpdesk"],
  pricing: "free",
  requires: ["@stormstack/auth"],

  events: {
    emits: [
      "ticket.created",
      "ticket.updated",
      "ticket.resolved",
      "ticket.closed",
      "ticket.comment_added",
    ],
  },

  configSchema: z.object({
    defaultPriority: z.enum(["low", "medium", "high", "urgent"]).default("medium").describe("Default priority for new tickets"),
    autoAssign: z.boolean().default(false).describe("Auto-assign tickets to available agents"),
    closedAfterDays: z.number().min(1).max(365).default(30).describe("Auto-close resolved tickets after N days"),
    allowPublicSubmission: z.boolean().default(true).describe("Allow unauthenticated ticket submission"),
  }),

  schema: {
    tables: { tickets, ticketComments, ticketLabels },
    enums: { ticketStatusEnum, ticketPriorityEnum },
  },

  routes: ({ ctx, isAuthenticated }) => createTicketingRoutes(ctx, isAuthenticated),

  client: {
    navItems: [
      { id: "ticketing", label: "Support", icon: "LifeBuoy", path: "/support", roles: ["admin", "member"] },
    ],
    routes: [
      { path: "/support", component: "TicketsPage", auth: true },
      { path: "/support/:id", component: "TicketDetailPage", auth: true },
    ],
  },
};
