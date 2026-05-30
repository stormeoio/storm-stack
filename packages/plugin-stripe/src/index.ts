import { Router, type Request } from "express";
import { z } from "zod";
import type { StormPlugin } from "@stormstack/core/plugin";
import Stripe from "stripe";
import { PACKAGE_VERSION } from "./version";

type StripeWebhookRequest = Request & { rawBody?: Buffer };

export const stripePlugin: StormPlugin = {
  id: "@stormstack/stripe",
  name: "Stripe Billing",
  version: PACKAGE_VERSION,
  description: "Subscriptions, invoices, and payment webhooks via Stripe",
  author: "Stormeo Technologies",
  url: "https://stormstack.dev/catalog/stripe",
  tags: ["billing", "payments", "subscriptions", "stripe"],
  pricing: "free",

  requires: ["@stormstack/auth"],

  env: {
    STRIPE_SECRET_KEY: {
      description: "Your Stripe secret key (sk_live_... or sk_test_...)",
      required: true,
      example: "sk_test_51...",
    },
    STRIPE_WEBHOOK_SECRET: {
      description: "Stripe webhook signing secret",
      required: true,
      example: "whsec_...",
    },
  },

  configSchema: z.object({
    currency: z.string().default("eur").describe("Default currency code"),
    taxRate: z.number().min(0).max(100).default(20).describe("Default VAT %"),
    trialDays: z.number().min(0).default(14).describe("Free trial days"),
  }),

  routes({ ctx, isAuthenticated }) {
    const router = Router();
    const secretKey = ctx.env["STRIPE_SECRET_KEY"] ?? process.env.STRIPE_SECRET_KEY;
    const webhookSecret = ctx.env["STRIPE_WEBHOOK_SECRET"] ?? process.env.STRIPE_WEBHOOK_SECRET;
    const stripe = new Stripe(secretKey ?? "", { apiVersion: "2023-10-16" });

    // GET /api/stripe/plans
    router.get("/plans", isAuthenticated, async (req, res) => {
      try {
        const prices = await stripe.prices.list({ active: true, limit: 50 });
        res.json(prices.data);
      } catch (err) {
        ctx.logger.error("Stripe plans fetch failed", { err });
        res.status(500).json({ error: "Impossible de récupérer les plans" });
      }
    });

    // POST /api/stripe/checkout
    router.post("/checkout", isAuthenticated, async (req, res) => {
      const schema = z.object({
        priceId: z.string(),
        successUrl: z.string().url(),
        cancelUrl: z.string().url(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      try {
        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          payment_method_types: ["card"],
          line_items: [{ price: parsed.data.priceId, quantity: 1 }],
          success_url: parsed.data.successUrl,
          cancel_url: parsed.data.cancelUrl,
        });
        res.json({ url: session.url });
      } catch (err) {
        ctx.logger.error("Stripe checkout failed", { err });
        res.status(500).json({ error: "Impossible de créer la session Stripe" });
      }
    });

    // POST /api/stripe/webhook (no auth — signed by Stripe)
    router.post("/webhook", async (req, res) => {
      if (!webhookSecret) {
        ctx.logger.error("Stripe webhook secret missing");
        return res.status(500).json({ error: "Configuration Stripe incomplète" });
      }

      const sig = req.headers["stripe-signature"];
      if (typeof sig !== "string") {
        return res.status(400).json({ error: "Signature Stripe manquante" });
      }

      let event: Stripe.Event;
      try {
        const payload = (req as StripeWebhookRequest).rawBody ?? req.body;
        event = stripe.webhooks.constructEvent(
          payload,
          sig,
          webhookSecret
        );
      } catch (err) {
        ctx.logger.error("Stripe webhook signature invalid", { err });
        return res.status(400).json({ error: "Webhook signature invalide" });
      }

      ctx.logger.info("Stripe webhook received", { type: event.type });
      await ctx.events.emit("stripe.webhook.received", { type: event.type, id: event.id }, "@stormstack/stripe");
      res.json({ received: true });
    });

    return router;
  },

  client: {
    navItems: [
      {
        id: "billing",
        label: "Facturation",
        icon: "CreditCard",
        path: "/billing",
        roles: ["admin", "billing_manager"],
      },
    ],
    settingsPanels: [
      {
        id: "stripe-settings",
        label: "Stripe",
        icon: "CreditCard",
        component: "StripeSettingsPanel",
      },
    ],
  },

  lifecycle: {
    async onBoot(ctx) {
      ctx.logger.info("@storm/plugin-stripe booted", {
        mode: process.env.STRIPE_SECRET_KEY?.startsWith("sk_live") ? "live" : "test",
      });
    },
  },
};
