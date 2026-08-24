import type { RequestHandler } from "express";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { StormContext } from "@stormeoio/core";
import { consentPreferences } from "./schema";

export const consentConfigSchema = z.object({
  policyVersion: z.string().trim().min(1).max(100).default("1.0")
    .describe("Version de la politique de confidentialité"),
});

export const consentPreferencesSchema = z.object({
  necessary: z.literal(true),
  analytics: z.boolean(),
  marketing: z.boolean(),
  policyVersion: z.string().trim().min(1).max(100).optional(),
}).strict();

export const consentWithdrawalSchema = z.object({}).strict();

export function createConsentRoutes(
  ctx: StormContext,
  isAuthenticated: RequestHandler,
  getPolicyVersion: () => string = () => "1.0",
): Router {
  const router = Router();
  const { db, events } = ctx;

  router.get("/state", isAuthenticated, async (req, res) => {
    const policyVersion = getPolicyVersion();
    const [consent] = await db
      .select()
      .from(consentPreferences)
      .where(eq(consentPreferences.userId, req.user!.id))
      .limit(1);

    res.set("Cache-Control", "private, no-store");
    res.json({ consent: consent ?? null, policyVersion });
  });

  router.put("/preferences", isAuthenticated, async (req, res) => {
    const parsed = consentPreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Préférences de consentement invalides",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const policyVersion = getPolicyVersion();
    if (parsed.data.policyVersion && parsed.data.policyVersion !== policyVersion) {
      res.status(409).json({
        error: "La politique de confidentialité a changé. Rechargez vos préférences.",
        policyVersion,
      });
      return;
    }

    const now = new Date();
    const values = {
      userId: req.user!.id,
      necessary: true as const,
      analytics: parsed.data.analytics,
      marketing: parsed.data.marketing,
      policyVersion,
      withdrawnAt: null,
      updatedAt: now,
    };

    const [consent] = await db
      .insert(consentPreferences)
      .values(values)
      .onConflictDoUpdate({
        target: consentPreferences.userId,
        set: {
          necessary: true,
          analytics: parsed.data.analytics,
          marketing: parsed.data.marketing,
          policyVersion,
          withdrawnAt: null,
          updatedAt: now,
        },
      })
      .returning();

    if (!consent) {
      res.status(500).json({ error: "Impossible d’enregistrer vos préférences" });
      return;
    }

    res.set("Cache-Control", "private, no-store");
    res.json({ consent });
    events.emit("consent.preferences_updated", {
      userId: req.user!.id,
      policyVersion: consent.policyVersion,
    }, "@stormeoio/consent").catch(() => {});
  });

  router.post("/withdraw", isAuthenticated, async (req, res) => {
    const parsed = consentWithdrawalSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Demande de retrait invalide",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const policyVersion = getPolicyVersion();
    const now = new Date();
    const values = {
      userId: req.user!.id,
      necessary: true as const,
      analytics: false,
      marketing: false,
      policyVersion,
      withdrawnAt: now,
      updatedAt: now,
    };

    const [consent] = await db
      .insert(consentPreferences)
      .values(values)
      .onConflictDoUpdate({
        target: consentPreferences.userId,
        set: {
          necessary: true,
          analytics: false,
          marketing: false,
          policyVersion,
          withdrawnAt: now,
          updatedAt: now,
        },
      })
      .returning();

    if (!consent) {
      res.status(500).json({ error: "Impossible de retirer votre consentement" });
      return;
    }

    res.set("Cache-Control", "private, no-store");
    res.json({ consent });
    events.emit("consent.withdrawn", {
      userId: req.user!.id,
      policyVersion: consent.policyVersion,
      withdrawnAt: consent.withdrawnAt?.toISOString() ?? now.toISOString(),
    }, "@stormeoio/consent").catch(() => {});
  });

  return router;
}
