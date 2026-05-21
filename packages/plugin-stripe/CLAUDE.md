# @stormstack/stripe — Claude Copilot Guide

## What this plugin does
Stripe integration for payments, subscriptions, and webhook handling. Provides customer management, checkout sessions, and real-time webhook processing.

## API Routes (mounted at `/api/stripe`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /customers | Yes | Create Stripe customer |
| POST | /checkout | Yes | Create checkout session |
| POST | /portal | Yes | Create billing portal session |
| POST | /webhooks | No* | Stripe webhook endpoint |
| GET | /subscription | Yes | Get current subscription status |

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
stripe listen --forward-to localhost:3000/api/stripe/webhooks
```
