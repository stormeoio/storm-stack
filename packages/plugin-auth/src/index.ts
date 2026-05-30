import type { StormPlugin } from "@stormstack/core";
import { z } from "zod";
import { users, tenants, tenantMembers } from "./schema";
import { createAppMiddleware } from "./middleware";
import { createAuthRoutes } from "./routes";

export { isAuthenticated, requireRole, createAppMiddleware, signToken, setAuthCookie, clearAuthCookie, verifyToken } from "./middleware";
export { users, tenants, tenantMembers } from "./schema";
export type { User, InsertUser, Tenant, TenantMember } from "./schema";
export type { AuthTokenPayload } from "./middleware";

export const authPlugin: StormPlugin = {
  id: "@stormstack/auth",
  name: "Auth",
  version: "0.1.0",
  description: "Email/password authentication with JWT cookies, RBAC, and multi-tenant support",
  tags: ["auth", "security", "rbac", "multi-tenant"],
  pricing: "free",

  env: {
    SESSION_SECRET: {
      description: "JWT signing secret — minimum 32 characters",
      required: true,
      example: "a-very-long-random-secret-at-least-32-chars",
    },
  },

  events: {
    emits: ["user.registered", "user.logged_in", "user.logged_out"],
  },

  configSchema: z.object({
    sessionExpiryHours: z.number().min(1).max(720).default(72).describe("Session duration in hours"),
    passwordMinLength: z.number().min(6).max(64).default(8).describe("Minimum password length"),
    allowRegistration: z.boolean().default(true).describe("Allow public sign-up"),
    requireEmailVerification: z.boolean().default(false).describe("Require email verification before login"),
  }),

  schema: {
    tables: { users, tenants, tenantMembers },
  },

  appMiddleware: (ctx) => createAppMiddleware(ctx.env["SESSION_SECRET"] ?? ""),

  routes: ({ ctx }) => createAuthRoutes(ctx),

  client: {
    routes: [
      { path: "/login", component: "LoginPage", auth: false },
      { path: "/register", component: "RegisterPage", auth: false },
    ],
  },

  lifecycle: {
    async onBoot(ctx) {
      if (!ctx.env["SESSION_SECRET"] || ctx.env["SESSION_SECRET"].length < 32) {
        throw new Error("SESSION_SECRET must be at least 32 characters");
      }
    },
  },
};
