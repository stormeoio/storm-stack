import fs from "fs";
import path from "path";
import type { ScaffoldOptions } from "./prompts";

const hasAuth = (plugins: string[]) => plugins.includes("@stormstack/auth");

function renderPackageJson(opts: ScaffoldOptions): string {
  const pluginDeps: Record<string, string> = {};
  for (const p of opts.plugins) {
    pluginDeps[p] = "^0.1.0";
  }

  return JSON.stringify(
    {
      name: opts.projectName,
      version: "0.1.0",
      private: true,
      scripts: {
        dev: "tsx watch src/index.ts",
        build: "tsc",
        start: "node dist/index.js",
        "db:push": "drizzle-kit push",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        "@stormstack/core": "^0.1.0",
        ...pluginDeps,
        "drizzle-orm": "^0.30.0",
        express: "^5.0.0",
        pg: "^8.11.0",
        zod: "^3.22.0",
      },
      devDependencies: {
        "@types/express": "^5.0.0",
        "@types/node": "^20.0.0",
        "@types/pg": "^8.11.0",
        "drizzle-kit": "^0.21.0",
        tsx: "^4.0.0",
        typescript: "^5.4.0",
      },
    },
    null,
    2
  );
}

function renderTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "CommonJS",
        moduleResolution: "node",
        lib: ["ES2022"],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        outDir: "./dist",
        rootDir: "./src",
        resolveJsonModule: true,
      },
      include: ["src/**/*.ts"],
      exclude: ["node_modules", "dist"],
    },
    null,
    2
  );
}

function renderEnvExample(opts: ScaffoldOptions): string {
  const lines = [
    "DATABASE_URL=postgres://user:password@localhost:5432/mydb",
    "NODE_ENV=development",
  ];
  if (hasAuth(opts.plugins)) {
    lines.push("SESSION_SECRET=change-me-to-a-random-32-char-secret-minimum");
  }
  for (const plugin of opts.plugins) {
    if (plugin === "@stormstack/billing") {
      lines.push("STRIPE_SECRET_KEY=sk_test_...");
      lines.push("STRIPE_WEBHOOK_SECRET=whsec_...");
    }
  }
  return lines.join("\n") + "\n";
}

function renderServerIndex(opts: ScaffoldOptions): string {
  const importLines: string[] = [
    `import express from "express";`,
    `import { bootstrapPlugins, registry } from "@stormstack/core";`,
    `import { db } from "./db";`,
    `import { env } from "./env";`,
  ];
  const setupLines: string[] = [];
  const authLines: string[] = [];

  if (hasAuth(opts.plugins)) {
    importLines.push(`import { authPlugin, createAppMiddleware, isAuthenticated } from "@stormstack/auth";`);
    setupLines.push(`registry.register(authPlugin);`);
    authLines.push(`const authMiddleware = createAppMiddleware(env.SESSION_SECRET);`);
    authLines.push(`for (const mw of authMiddleware) app.use(mw);`);
  }

  for (const plugin of opts.plugins) {
    if (plugin === "@stormstack/auth") continue;
    const name = plugin.replace("@stormstack/", "") + "Plugin";
    importLines.push(`import { ${name} } from "${plugin}";`);
    setupLines.push(`registry.register(${name});`);
  }

  const bootstrapOpts = hasAuth(opts.plugins)
    ? `{ app, ctx, isAuthenticated }`
    : `{ app, ctx }`;

  return `${importLines.join("\n")}

const app = express();
app.use(express.json());

const ctx = { db, env, logger: console };

${setupLines.join("\n")}
${authLines.length ? "\n" + authLines.join("\n") : ""}

await bootstrapPlugins(${bootstrapOpts});

const PORT = Number(process.env["PORT"] ?? 3000);
app.listen(PORT, () => {
  console.log(\`[storm-stack] Server running on http://localhost:\${PORT}\`);
});
`;
}

function renderDb(): string {
  return `import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "./env";

const pool = new Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle(pool);
`;
}

function renderEnv(opts: ScaffoldOptions): string {
  const fields: string[] = [
    `DATABASE_URL: z.string().url(),`,
    `NODE_ENV: z.enum(["development", "production", "test"]).default("development"),`,
  ];

  if (hasAuth(opts.plugins)) {
    fields.push(`SESSION_SECRET: z.string().min(32),`);
  }
  if (opts.plugins.includes("@stormstack/billing")) {
    fields.push(`STRIPE_SECRET_KEY: z.string(),`);
    fields.push(`STRIPE_WEBHOOK_SECRET: z.string(),`);
  }

  return `import { z } from "zod";

const envSchema = z.object({
  ${fields.join("\n  ")}
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("[storm-stack] Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
`;
}

function renderDrizzleConfig(opts: ScaffoldOptions): string {
  return `import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "",
  },
} satisfies Config;
`;
}

function renderSchema(opts: ScaffoldOptions): string {
  const exports: string[] = [];
  if (hasAuth(opts.plugins)) {
    exports.push(`export { users, tenants, tenantMembers } from "@stormstack/auth";`);
  }
  if (exports.length === 0) {
    exports.push(`// Add your Drizzle tables here`);
  }
  return exports.join("\n") + "\n";
}

function renderReadme(opts: ScaffoldOptions): string {
  const pm = opts.packageManager;
  return `# ${opts.projectName}

Built with [Storm Stack](https://github.com/stormeoio/storm-stack).

## Getting started

\`\`\`bash
cp .env.example .env
# Edit .env with your database URL and secrets

${pm} install
${pm === "npm" ? "npm run" : pm} db:push
${pm === "npm" ? "npm run" : pm} dev
\`\`\`

## Plugins installed

${opts.plugins.map((p) => `- \`${p}\``).join("\n")}

## API routes

${hasAuth(opts.plugins) ? `- \`POST /api/auth/register\` — Create account\n- \`POST /api/auth/login\` — Login\n- \`POST /api/auth/logout\` — Logout\n- \`GET  /api/auth/me\` — Current user` : ""}
`;
}

export function scaffold(opts: ScaffoldOptions, targetDir: string): void {
  fs.mkdirSync(path.join(targetDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "drizzle"), { recursive: true });

  const write = (file: string, content: string) =>
    fs.writeFileSync(path.join(targetDir, file), content, "utf8");

  write("package.json", renderPackageJson(opts));
  write("tsconfig.json", renderTsConfig());
  write(".env.example", renderEnvExample(opts));
  write("drizzle.config.ts", renderDrizzleConfig(opts));
  write("README.md", renderReadme(opts));
  write("src/index.ts", renderServerIndex(opts));
  write("src/db.ts", renderDb());
  write("src/env.ts", renderEnv(opts));
  write("src/schema.ts", renderSchema(opts));

  // .gitignore
  write(
    ".gitignore",
    ["node_modules/", "dist/", ".env", "drizzle/meta/", "*.local"].join("\n") + "\n"
  );
}
