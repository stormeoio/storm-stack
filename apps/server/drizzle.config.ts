import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "../../packages/plugin-auth/src/schema.ts",
    "../../packages/plugin-crm/src/schema.ts",
    "../../packages/plugin-ticketing/src/schema.ts",
    "../../packages/plugin-auth-social/src/schema.ts",
  ],
  out: "./drizzle",
  dbCredentials: {
    url: process.env["DATABASE_URL"]!,
  },
});
