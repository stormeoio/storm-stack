import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { organizations, contacts, deals } from "./schema";
import type { StormContext } from "@stormstack/core";
import type { RequestHandler } from "express";

const orgSchema = z.object({
  name: z.string().min(1),
  website: z.string().url().optional().nullable(),
  industry: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const contactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  status: z.enum(["lead", "prospect", "client", "churned"]).optional(),
  organizationId: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const dealSchema = z.object({
  title: z.string().min(1),
  stage: z.enum(["new", "qualified", "proposal", "negotiation", "won", "lost"]).optional(),
  value: z.string().optional().nullable(),
  currency: z.string().length(3).optional(),
  contactId: z.string().optional().nullable(),
  organizationId: z.string().optional().nullable(),
  expectedCloseDate: z.string().datetime().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export function createCrmRoutes(ctx: StormContext, isAuthenticated: RequestHandler): Router {
  const router = Router();
  const { db } = ctx;

  // ── Organizations ──────────────────────────────────────────────────────────

  router.get("/organizations", isAuthenticated, async (req, res) => {
    const tenantId = req.user!.id;
    const rows = await db.select().from(organizations)
      .where(eq(organizations.tenantId, tenantId))
      .orderBy(desc(organizations.createdAt))
      .limit(100);
    res.json({ organizations: rows });
  });

  router.post("/organizations", isAuthenticated, async (req, res) => {
    const parsed = orgSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
    const [row] = await db.insert(organizations)
      .values({ ...parsed.data, tenantId: req.user!.id })
      .returning();
    res.status(201).json({ organization: row });
  });

  router.get("/organizations/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    const [row] = await db.select().from(organizations)
      .where(and(eq(organizations.id, id), eq(organizations.tenantId, req.user!.id)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Introuvable" }); return; }
    res.json({ organization: row });
  });

  router.patch("/organizations/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    const parsed = orgSchema.partial().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
    const [row] = await db.update(organizations)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(organizations.id, id), eq(organizations.tenantId, req.user!.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Introuvable" }); return; }
    res.json({ organization: row });
  });

  router.delete("/organizations/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    await db.delete(organizations)
      .where(and(eq(organizations.id, id), eq(organizations.tenantId, req.user!.id)));
    res.json({ ok: true });
  });

  // ── Contacts ───────────────────────────────────────────────────────────────

  router.get("/contacts", isAuthenticated, async (req, res) => {
    const rows = await db.select().from(contacts)
      .where(eq(contacts.tenantId, req.user!.id))
      .orderBy(desc(contacts.createdAt))
      .limit(100);
    res.json({ contacts: rows });
  });

  router.post("/contacts", isAuthenticated, async (req, res) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
    const [row] = await db.insert(contacts)
      .values({ ...parsed.data, tenantId: req.user!.id })
      .returning();
    res.status(201).json({ contact: row });
  });

  router.get("/contacts/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    const [row] = await db.select().from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.tenantId, req.user!.id)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Introuvable" }); return; }
    res.json({ contact: row });
  });

  router.patch("/contacts/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    const parsed = contactSchema.partial().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
    const [row] = await db.update(contacts)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.tenantId, req.user!.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Introuvable" }); return; }
    res.json({ contact: row });
  });

  router.delete("/contacts/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    await db.delete(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.tenantId, req.user!.id)));
    res.json({ ok: true });
  });

  // ── Deals ──────────────────────────────────────────────────────────────────

  router.get("/deals", isAuthenticated, async (req, res) => {
    const rows = await db.select().from(deals)
      .where(eq(deals.tenantId, req.user!.id))
      .orderBy(desc(deals.createdAt))
      .limit(100);
    res.json({ deals: rows });
  });

  router.post("/deals", isAuthenticated, async (req, res) => {
    const parsed = dealSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
    const { expectedCloseDate, ...rest } = parsed.data;
    const [row] = await db.insert(deals).values({
      ...rest,
      tenantId: req.user!.id,
      expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
    }).returning();
    res.status(201).json({ deal: row });
  });

  router.patch("/deals/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    const parsed = dealSchema.partial().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
    const { expectedCloseDate, ...rest } = parsed.data;
    const setValues: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    if (expectedCloseDate !== undefined) {
      setValues["expectedCloseDate"] = expectedCloseDate ? new Date(expectedCloseDate) : null;
    }
    const [row] = await db.update(deals)
      .set(setValues)
      .where(and(eq(deals.id, id), eq(deals.tenantId, req.user!.id)))
      .returning();
    if (!row) { res.status(404).json({ error: "Introuvable" }); return; }
    res.json({ deal: row });
  });

  router.delete("/deals/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    await db.delete(deals)
      .where(and(eq(deals.id, id), eq(deals.tenantId, req.user!.id)));
    res.json({ ok: true });
  });

  return router;
}
