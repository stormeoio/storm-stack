# @stormstack/stripe

Stripe plugin for Storm Stack - active prices, subscription checkout, and signed webhook handling.

## Installation

```bash
npm install @stormstack/stripe
```

## Usage

```ts
import { stripePlugin } from "@stormstack/stripe";
import { registry } from "@stormstack/core";

registry.register(stripePlugin);
```

For generated apps, `create-storm-app` and `storm add stripe` configure the Express JSON parser to preserve the raw webhook body required by Stripe signature verification.

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stripe/plans` | List active Stripe prices |
| POST | `/api/stripe/checkout` | Create a subscription checkout session |
| POST | `/api/stripe/webhook` | Receive signed Stripe webhook events |

## Events

| Event | Payload |
|-------|---------|
| `stripe.webhook.received` | `{ type: string; id: string }` |

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key (`sk_test_...` or `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Yes | Webhook signing secret (`whsec_...`) |

## Requires

- `@stormstack/auth`

## License

MIT
