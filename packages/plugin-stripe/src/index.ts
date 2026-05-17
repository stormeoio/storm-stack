import { Router } from "express";
import { z } from "zod";
import type { StormPlugin } from "@stormstack/core/plugin";

export const stripePlugin: StormPlugin = {
  id: "@stormstack/billing",
  name: "Stripe Billing",
  version: "0.1.0",
  description: "Subscriptions, invoices, and payment webhooks via Stripe",
  author: "Stormeo Technologies",
  url: "https://stormstack.dev/catalog/billing",
  tags: ["billing", "payments", "subscriptions", "stripe"],
  pricing: "free",

  requires: ["@stormstack/core"],

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
    const stripe = new (require("stripe"))(process.env.STRIPE_SECRET_KEY);

    // GET /api/plugin-stripe/plans
    router.get("/plans", isAuthenticated, async (req, res) => {
      try {
        const prices = await stripe.prices.list({ active: true, limit: 50 });
        res.json(prices.data);
      } catch (err) {
        ctx.logger.error("Stripe plans fetch failed", { err });
        res.status(500).json({ error: "Impossible de récupérer les plans" });
      }
    });

    // POST /api/plugin-stripe/checkout
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

    // POST /api/plugin-stripe/webhook (no auth — signed by Stripe)
    router.post("/webhook", async (req, res) => {
      const sig = req.headers["stripe-signature"] as string;
      let event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        ctx.logger.error("Stripe webhook signature invalid", { err });
        return res.status(400).json({ error: "Webhook signature invalide" });
      }

      ctx.logger.info("Stripe webhook received", { type: event.type });
      // Plugins can extend this via event emitter — see docs
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
