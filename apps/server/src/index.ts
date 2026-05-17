import "dotenv/config";
import express from "express";
import cors from "cors";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { registry, bootstrapPlugins } from "@stormstack/core";
import type { StormContext, StormEnv } from "@stormstack/core";
import { authPlugin } from "@stormstack/auth";
import { crmPlugin } from "@stormstack/crm";
import { ticketingPlugin } from "@stormstack/ticketing";
import { createSocialAuthPlugin } from "@stormstack/auth-social";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);

const env: StormEnv = {
  DATABASE_URL: process.env["DATABASE_URL"] ?? "",
  SESSION_SECRET: process.env["SESSION_SECRET"] ?? "",
  NODE_ENV: (process.env["NODE_ENV"] as StormEnv["NODE_ENV"]) ?? "development",
  GOOGLE_CLIENT_ID: process.env["GOOGLE_CLIENT_ID"],
  GOOGLE_CLIENT_SECRET: process.env["GOOGLE_CLIENT_SECRET"],
  GITHUB_CLIENT_ID: process.env["GITHUB_CLIENT_ID"],
  GITHUB_CLIENT_SECRET: process.env["GITHUB_CLIENT_SECRET"],
};

if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool);

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[info] ${msg}`, meta ?? ""),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[warn] ${msg}`, meta ?? ""),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[error] ${msg}`, meta ?? ""),
};

const ctx: StormContext = { db, env, logger };

registry.register(authPlugin);
registry.register(crmPlugin);
registry.register(ticketingPlugin);

if (env["GOOGLE_CLIENT_ID"] || env["GITHUB_CLIENT_ID"]) {
  const socialPlugin = createSocialAuthPlugin({
    google: env["GOOGLE_CLIENT_ID"]
      ? { clientId: env["GOOGLE_CLIENT_ID"]!, clientSecret: env["GOOGLE_CLIENT_SECRET"]!, callbackUrl: `http://localhost:${PORT}/api/auth-social/google/callback` }
      : undefined,
    github: env["GITHUB_CLIENT_ID"]
      ? { clientId: env["GITHUB_CLIENT_ID"]!, clientSecret: env["GITHUB_CLIENT_SECRET"]!, callbackUrl: `http://localhost:${PORT}/api/auth-social/github/callback` }
      : undefined,
  });
  registry.register(socialPlugin);
}

async function main() {
  const app = express();

  app.use(cors({ origin: "http://localhost:5173", credentials: true }));
  app.use(express.json());

  await bootstrapPlugins({ app, ctx });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.listen(PORT, () => {
    console.log(`[stormclaude] Server running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
