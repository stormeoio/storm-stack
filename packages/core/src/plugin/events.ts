// ─── Built-in Storm event definitions ────────────────────────────────────────
// Plugins declare their events here via declaration merging on StormEvents.
// This file is the canonical registry of all known event shapes.

import type { StormEvents } from "./event-bus";

/**
 * Extend StormEvents with standard plugin events.
 * This uses TypeScript declaration merging — each plugin can add its own events.
 */
declare module "./event-bus" {
  interface StormEvents {
    // ── Auth events ──────────────────────────────────────────────────────────
    "user.registered": { userId: string; email: string };
    "user.logged_in": { userId: string; email: string };
    "user.logged_out": { userId: string };

    // ── CRM events ───────────────────────────────────────────────────────────
    "contact.created": { contactId: string; email?: string | null; tenantId: string };
    "contact.updated": { contactId: string; changes: string[]; tenantId: string };
    "contact.deleted": { contactId: string; tenantId: string };
    "organization.created": { organizationId: string; name: string; tenantId: string };
    "deal.created": { dealId: string; title: string; tenantId: string };
    "deal.stage_changed": { dealId: string; from: string; to: string; tenantId: string };
    "deal.won": { dealId: string; value?: string | null; tenantId: string };
    "deal.lost": { dealId: string; tenantId: string };

    // ── Ticketing events ─────────────────────────────────────────────────────
    "ticket.created": { ticketId: string; title: string; reporterId: string; tenantId: string };
    "ticket.updated": { ticketId: string; changes: string[]; tenantId: string };
    "ticket.resolved": { ticketId: string; resolvedBy?: string; tenantId: string };
    "ticket.closed": { ticketId: string; tenantId: string };
    "ticket.comment_added": { ticketId: string; commentId: string; authorId: string; isInternal: boolean };

    // ── Billing events ───────────────────────────────────────────────────────
    "payment.completed": { amount: number; currency: string; customerId?: string };
    "payment.failed": { amount: number; currency: string; error: string };
    "subscription.created": { subscriptionId: string; planId: string };
    "subscription.cancelled": { subscriptionId: string; reason?: string };
  }
}

// Force TypeScript to treat this as a module
export {};
