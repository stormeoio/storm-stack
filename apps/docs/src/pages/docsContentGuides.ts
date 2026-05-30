import type { DocsContentEntry } from "./docsContentTypes";

export const DOC_CONTENT_GUIDES: Record<string, DocsContentEntry> = {
  testing: {
    title: "Plugin Testing",
    body: `## Overview

\`@stormstack/testing\` provides utilities for writing isolated plugin tests without a real database or running server.

\`\`\`bash
npm install -D @stormstack/testing
\`\`\`

## createTestContext

Creates a \`StormContext\` with sensible test defaults — mock db, test env, silent logger, and a live event bus.

\`\`\`ts
import { createTestContext } from "@stormstack/testing";

const ctx = createTestContext();
// ctx.env.NODE_ENV === "test"
// ctx.events is a real StormEventBus
// ctx.logger is silent (no output noise in tests)
\`\`\`

Override any part:

\`\`\`ts
const ctx = createTestContext({
  db: myTestDb,
  env: { STRIPE_KEY: "sk_test_xxx" },
  logger: { error: console.error }, // only log errors
});
\`\`\`

## createTestApp

Full Express app with plugins bootstrapped — ready for HTTP assertions.

\`\`\`ts
import { createTestApp, createMockPlugin } from "@stormstack/testing";
import { myPlugin } from "../src";

const { app, ctx, request, cleanup } = await createTestApp({
  plugins: [myPlugin],
});

const res = await request.get("/api/my-plugin/items");
expect(res.status).toBe(200);

// Always call cleanup when done
cleanup();
\`\`\`

The \`request\` helper provides \`.get()\`, \`.post()\`, \`.put()\`, \`.patch()\`, \`.delete()\` — each returns \`{ status, body, headers, text }\`.

## createMockPlugin

Quick throwaway plugin for testing interactions, dependencies, or lifecycle hooks.

\`\`\`ts
import { createMockPlugin } from "@stormstack/testing";

const dep = createMockPlugin({ id: "@stormstack/dep" });
const main = createMockPlugin({
  requires: ["@stormstack/dep"],
  lifecycle: {
    async onBoot(ctx) { /* ... */ },
  },
});
\`\`\`

Each call auto-increments the plugin ID. Call \`resetMockCounter()\` between tests.

## Event Assertions

Check which events the event bus recorded during a test:

\`\`\`ts
import {
  expectEventEmitted,
  expectEventNotEmitted,
  getEmittedEvents,
} from "@stormstack/testing";

await ctx.events.emit("ticket.created", { ticketId: "1" });

expectEventEmitted(ctx.events, "ticket.created");     // passes
expectEventNotEmitted(ctx.events, "ticket.deleted");   // passes

const events = getEmittedEvents(ctx.events, "ticket.created");
expect(events).toHaveLength(1);
expect(events[0].payload.ticketId).toBe("1");
\`\`\`

## Full Example

\`\`\`ts
import { describe, it, expect, afterEach } from "vitest";
import { createTestContext, createMockPlugin, resetMockCounter, expectEventEmitted } from "@stormstack/testing";

afterEach(() => resetMockCounter());

describe("billing plugin lifecycle", () => {
  it("seeds default plans on install", async () => {
    const seeded: string[] = [];
    const plugin = createMockPlugin({
      lifecycle: {
        async onInstall(ctx) {
          seeded.push("free", "pro", "enterprise");
        },
        async onBoot(ctx) {
          await ctx.events.emit("billing.ready", {});
        },
      },
    });

    const ctx = createTestContext();
    await plugin.lifecycle!.onInstall!(ctx);
    await plugin.lifecycle!.onBoot!(ctx);

    expect(seeded).toEqual(["free", "pro", "enterprise"]);
    expectEventEmitted(ctx.events, "billing.ready");
  });
});
\`\`\`
`,
  },
  deployment: {
    title: "Deployment",
    body: `## Production Build

\`\`\`bash
npm run build
npm start
\`\`\`

## Docker

\`\`\`dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
\`\`\`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`DATABASE_URL\` | Yes | PostgreSQL connection string |
| \`SESSION_SECRET\` | Yes | JWT secret (32+ chars) |
| \`PORT\` | No | Server port (default: 3000) |
| \`NODE_ENV\` | No | production/development |

## Database

\`\`\`bash
npm run db:push     # Apply schema (dev)
npm run db:generate # Generate SQL migration (prod)
\`\`\`

## Hosting

- **Railway** — one-click PostgreSQL + Node deploy
- **Fly.io** — global edge, Dockerfile deploy
- **VPS** — Docker Compose with Traefik
- **Vercel** — not recommended (no long-lived server)
`,
  },
};
