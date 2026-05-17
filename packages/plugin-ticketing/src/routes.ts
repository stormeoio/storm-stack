import { Router } from "express";
import { eq, and, desc, SQL } from "drizzle-orm";
import { z } from "zod";
import { tickets, ticketComments, ticketLabels } from "./schema";
import type { StormContext } from "@stormstack/core";
import type { RequestHandler } from "express";

const TICKET_STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const ticketSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assigneeId: z.string().optional().nullable(),
  labelId: z.string().optional().nullable(),
});

const updateTicketSchema = ticketSchema.partial().extend({
  status: z.enum(TICKET_STATUSES).optional(),
});

const commentSchema = z.object({
  body: z.string().min(1),
  isInternal: z.boolean().optional(),
});

const labelSchema = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur hexadécimale invalide").optional(),
});

export function createTicketingRoutes(ctx: StormContext, isAuthenticated: RequestHandler): Router {
  const router = Router();
  const { db } = ctx;

  // ── Labels ─────────────────────────────────────────────────────────────────

  router.get("/labels", isAuthenticated, async (req, res) => {
    const rows = await db.select().from(ticketLabels)
      .where(eq(ticketLabels.tenantId, req.user!.id))
      .limit(50);
    res.json({ labels: rows });
  });

  router.post("/labels", isAuthenticated, async (req, res) => {
    const parsed = labelSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
    const [row] = await db.insert(ticketLabels)
      .values({ ...parsed.data, tenantId: req.user!.id })
      .returning();
    res.status(201).json({ label: row });
  });

  router.delete("/labels/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    await db.delete(ticketLabels)
      .where(and(eq(ticketLabels.id, id), eq(ticketLabels.tenantId, req.user!.id)));
    res.json({ ok: true });
  });

  // ── Tickets ────────────────────────────────────────────────────────────────

  router.get("/", isAuthenticated, async (req, res) => {
    const { status } = req.query as { status?: string };
    const tenantId = req.user!.id;

    const conditions: SQL[] = [eq(tickets.tenantId, tenantId)];
    if (status && TICKET_STATUSES.includes(status as typeof TICKET_STATUSES[number])) {
      conditions.push(eq(tickets.status, status as typeof TICKET_STATUSES[number]));
    }

    const rows = await db.select().from(tickets)
      .where(and(...conditions))
      .orderBy(desc(tickets.createdAt))
      .limit(100);
    res.json({ tickets: rows });
  });

  router.post("/", isAuthenticated, async (req, res) => {
    const parsed = ticketSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
    const [row] = await db.insert(tickets)
      .values({ ...parsed.data, tenantId: req.user!.id, reporterId: req.user!.id })
      .returning();
    res.status(201).json({ ticket: row });
  });

  router.get("/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    const [ticket] = await db.select().from(tickets)
      .where(and(eq(tickets.id, id), eq(tickets.tenantId, req.user!.id)))
      .limit(1);
    if (!ticket) { res.status(404).json({ error: "Ticket introuvable" }); return; }
    const comments = await db.select().from(ticketComments)
      .where(eq(ticketComments.ticketId, ticket.id))
      .orderBy(ticketComments.createdAt)
      .limit(200);
    res.json({ ticket, comments });
  });

  router.patch("/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    const parsed = updateTicketSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
    const update: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
    if (parsed.data.status === "resolved" || parsed.data.status === "closed") {
      update["resolvedAt"] = new Date();
    }
    const [row] = await db.update(tickets)
      .set(update)
      .where(and(eq(tickets.id, id), eq(tickets.tenantId, req.user!.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Ticket introuvable" }); return; }
    res.json({ ticket: row });
  });

  router.delete("/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    await db.delete(tickets)
      .where(and(eq(tickets.id, id), eq(tickets.tenantId, req.user!.id)));
    res.json({ ok: true });
  });

  // ── Comments ───────────────────────────────────────────────────────────────

  router.post("/:id/comments", isAuthenticated, async (req, res) => {
    const ticketId = req.params["id"] as string;
    const [ticket] = await db.select({ id: tickets.id }).from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, req.user!.id)))
      .limit(1);
    if (!ticket) { res.status(404).json({ error: "Ticket introuvable" }); return; }
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
    const [row] = await db.insert(ticketComments)
      .values({ ...parsed.data, ticketId: ticket.id, authorId: req.user!.id })
      .returning();
    res.status(201).json({ comment: row });
  });

  router.patch("/:id/comments/:commentId", isAuthenticated, async (req, res) => {
    const commentId = req.params["commentId"] as string;
    const parsed = z.object({ body: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
    const [row] = await db.update(ticketComments)
      .set({ body: parsed.data.body, updatedAt: new Date() })
      .where(and(eq(ticketComments.id, commentId), eq(ticketComments.authorId, req.user!.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Commentaire introuvable" }); return; }
    res.json({ comment: row });
  });

  router.delete("/:id/comments/:commentId", isAuthenticated, async (req, res) => {
    const commentId = req.params["commentId"] as string;
    await db.delete(ticketComments)
      .where(and(eq(ticketComments.id, commentId), eq(ticketComments.authorId, req.user!.id)));
    res.json({ ok: true });
  });

  return router;
}
