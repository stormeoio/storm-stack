# @stormstack/stripe — Claude Copilot Guide

## What this plugin does
Stripe integration for payments, checkout sessions, and webhook handling.

## API Routes (mounted at `/api/stripe`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /plans | Yes | List active Stripe prices |
| POST | /checkout | Yes | Create checkout session |
| POST | /webhook | No* | Stripe webhook endpoint |

*Webhook endpoint uses Stripe signature verification instead of JWT auth.

## Exports
```ts
import { stripePlugin } from "@stormstack/stripe";
```

## Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| STRIPE_SECRET_KEY | Yes | Stripe secret key (sk_test_... or sk_live_...) |
| STRIPE_WEBHOOK_SECRET | Yes | Webhook signing secret (whsec_...) |
| STRIPE_PRICE_ID | No | Default price ID for checkout |

## Requires
- `@stormstack/auth` — uses `isAuthenticated` + user context

## Common Customizations

### Add subscription tiers
Edit the checkout session creation to accept different `priceId` values.

### Handle additional webhook events
Add cases to the webhook handler switch statement in `index.ts`:
```ts
case "invoice.payment_failed":
  // Handle failed payment
  break;
```

### Connect to Stripe CLI for local testing
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```
