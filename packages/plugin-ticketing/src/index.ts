import type { StormPlugin } from "@stormstack/core";
import { tickets, ticketComments, ticketLabels, ticketStatusEnum, ticketPriorityEnum } from "./schema";
import { createTicketingRoutes } from "./routes";

export { tickets, ticketComments, ticketLabels } from "./schema";
export type { Ticket, InsertTicket, TicketComment, TicketLabel } from "./schema";

export const ticketingPlugin: StormPlugin = {
  id: "@stormstack/ticketing",
  name: "Ticketing",
  version: "0.1.0",
  description: "Tickets support, commentaires internes et labels pour gérer les demandes clients",
  tags: ["support", "tickets", "feedback", "helpdesk"],
  pricing: "free",
  requires: ["@stormstack/auth"],

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
