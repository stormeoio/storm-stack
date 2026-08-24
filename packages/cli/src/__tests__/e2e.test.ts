import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "node:os";
import path from "path";
import { execSync } from "child_process";

const CLI = path.resolve(__dirname, "../../dist/index.mjs");
const FIXTURES = path.join(os.tmpdir(), `storm-cli-e2e-${process.pid}`);
const MONOREPO = path.resolve(__dirname, "../../../..");
const CLI_PACKAGE = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")) as { version: string };
const REAL_PROCESS_TEST_TIMEOUT = 30_000;

// These E2E cases spawn the built CLI and perform real filesystem/package-manager I/O.
vi.setConfig({ testTimeout: REAL_PROCESS_TEST_TIMEOUT, hookTimeout: REAL_PROCESS_TEST_TIMEOUT });

function run(cmd: string, cwd: string = FIXTURES): string {
  return execSync(`node ${CLI} ${cmd}`, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } });
}

function runSafe(
  cmd: string,
  cwd: string = FIXTURES,
  env: NodeJS.ProcessEnv = {},
): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`node ${CLI} ${cmd}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env, NO_COLOR: "1" },
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.status ?? 1 };
  }
}

function setupProject() {
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  fs.mkdirSync(path.join(FIXTURES, "server"), { recursive: true });

  fs.writeFileSync(path.join(FIXTURES, "package.json"), JSON.stringify({ name: "test-app", version: "0.1.0" }));

  fs.writeFileSync(path.join(FIXTURES, "server/index.ts"), `import "dotenv/config";
import express from "express";
import { registry, bootstrapPlugins } from "@stormeoio/core";
import type { StormContext, StormEnv } from "@stormeoio/core";

const env: StormEnv = {
  DATABASE_URL: process.env["DATABASE_URL"] ?? "",
  SESSION_SECRET: process.env["SESSION_SECRET"] ?? "",
  NODE_ENV: "development",
};

async function main() {
  const app = express();
  app.use(express.json());
  await bootstrapPlugins({ app, ctx: { db: {} as any, env, logger: console } });
  app.listen(3000);
}

main();
`);

  fs.writeFileSync(path.join(FIXTURES, "drizzle.config.ts"), `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: [],
  out: "./drizzle",
  dbCredentials: { url: process.env["DATABASE_URL"]! },
});
`);

  fs.writeFileSync(path.join(FIXTURES, "storm.json"), JSON.stringify({
    version: 1,
    pluginsDir: "plugins",
    serverEntry: "server/index.ts",
    drizzleConfig: "drizzle.config.ts",
    registry: "",
    installed: [],
  }));
}

function readFixture(file: string): string {
  return fs.readFileSync(path.join(FIXTURES, file), "utf8");
}

function readConfig(): { installed: string[] } {
  return JSON.parse(readFixture("storm.json"));
}

function writeFixture(file: string, content: string): void {
  const target = path.join(FIXTURES, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function wireLegacyAuthServer(): string {
  const legacy = readFixture("server/index.ts")
    .replace(
      'import { registry, bootstrapPlugins } from "@stormeoio/core";',
      'import { registry, bootstrapPlugins } from "@stormeoio/core";\nimport { authPlugin } from "@stormeoio/auth";',
    )
    .replace("async function main() {", "registry.register(authPlugin);\n\nasync function main() {");
  writeFixture("server/index.ts", legacy);
  return legacy;
}

function wireCurrentAuthServer(): string {
  const current = readFixture("server/index.ts")
    .replace(
      'import { registry, bootstrapPlugins } from "@stormeoio/core";',
      'import { registry, bootstrapPlugins } from "@stormeoio/core";\nimport { authPlugin, createDatabaseRoleGuard } from "@stormeoio/auth";',
    )
    .replace("async function main() {", "registry.register(authPlugin);\n\nasync function main() {")
    .replace(
      "await bootstrapPlugins({ app, ctx: { db: {} as any, env, logger: console } });",
      'await bootstrapPlugins({ app, ctx: { db: {} as any, env, logger: console }, requireAdmin: createDatabaseRoleGuard({} as any, "admin") });',
    );
  writeFixture("server/index.ts", current);
  return current;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("storm list", () => {
  beforeEach(setupProject);
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("lists available plugins", () => {
    const output = run("list");
    expect(output).toContain("auth");
    expect(output).toContain("crm");
    expect(output).toContain("ticketing");
    expect(output).toContain("stripe");
    expect(output).toContain("billing");
  });
});

describe("storm add --copy --local", () => {
  beforeEach(setupProject);
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("adds auth plugin and wires server entry", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);

    // Plugin files copied
    expect(fs.existsSync(path.join(FIXTURES, "plugins/auth/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURES, "plugins/auth/schema.ts"))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURES, "plugins/auth/routes.ts"))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURES, "plugins/auth/middleware.ts"))).toBe(true);

    // Server entry wired
    const server = readFixture("server/index.ts");
    expect(server).toContain(
      'import { authPlugin, createDatabaseRoleGuard } from "../plugins/auth"',
    );
    expect(server).toContain("registry.register(authPlugin)");
    expect(server).toContain(
      'requireAdmin: createDatabaseRoleGuard({} as any, "admin")',
    );

    // Drizzle config updated
    const drizzle = readFixture("drizzle.config.ts");
    expect(drizzle).toContain("./plugins/auth/schema.ts");

    // storm.json updated
    const config = readConfig();
    expect(config.installed).toContain("@stormeoio/auth");

    // CLAUDE.md generated
    expect(fs.existsSync(path.join(FIXTURES, "CLAUDE.md"))).toBe(true);
    const claude = readFixture("CLAUDE.md");
    expect(claude).toContain("@stormeoio/auth");
    expect(claude).toContain("SESSION_SECRET");
  });

  it("adds crm plugin after auth", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);
    run(`add crm --copy --local ${MONOREPO} --yes`);

    const server = readFixture("server/index.ts");
    expect(server).toContain("authPlugin");
    expect(server).toContain("crmPlugin");

    const drizzle = readFixture("drizzle.config.ts");
    expect(drizzle).toContain("./plugins/auth/schema.ts");
    expect(drizzle).toContain("./plugins/crm/schema.ts");

    const config = readConfig();
    expect(config.installed).toEqual(["@stormeoio/auth", "@stormeoio/crm"]);
  });

  it("adds 3 plugins and imports stack correctly", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);
    run(`add crm --copy --local ${MONOREPO} --yes`);
    run(`add ticketing --copy --local ${MONOREPO} --yes`);

    const server = readFixture("server/index.ts");
    const imports = server.split("\n").filter((l) => l.startsWith("import"));
    const registers = server.split("\n").filter((l) => l.includes("registry.register"));

    expect(imports.length).toBeGreaterThanOrEqual(6); // 4 original + 2 added (auth, crm, ticketing)
    expect(registers.length).toBe(3);

    const config = readConfig();
    expect(config.installed).toHaveLength(3);
  });

  it("skips already-installed plugin", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);
    const output = run(`add auth --copy --local ${MONOREPO} --yes`);
    expect(output).toContain("déjà installé");
  });

  it("rejects coming-soon plugins", () => {
    const output = run(`add billing --copy --local ${MONOREPO} --yes`);
    expect(output).toContain("pas encore disponible");
  });

  it("rejects unknown plugins", () => {
    const result = runSafe(`add foobar --copy --local ${MONOREPO} --yes`);
    expect(result.code).not.toBe(0);
  });
});

describe("storm remove", () => {
  beforeEach(() => {
    setupProject();
    run(`add auth --copy --local ${MONOREPO} --yes`);
    run(`add crm --copy --local ${MONOREPO} --yes`);
  });
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("removes crm and cleans up", () => {
    // Pipe "y" to confirm removal
    execSync(`echo y | node ${CLI} remove crm`, { cwd: FIXTURES, encoding: "utf8" });

    // Plugin files removed
    expect(fs.existsSync(path.join(FIXTURES, "plugins/crm"))).toBe(false);

    // Server entry cleaned
    const server = readFixture("server/index.ts");
    expect(server).not.toContain("crmPlugin");
    expect(server).toContain("authPlugin"); // auth remains

    // Drizzle config cleaned
    const drizzle = readFixture("drizzle.config.ts");
    expect(drizzle).not.toContain("crm");
    expect(drizzle).toContain("auth");

    // Config updated
    const config = readConfig();
    expect(config.installed).toEqual(["@stormeoio/auth"]);
  });

  it("removes stripe and restores the default JSON parser", () => {
    run(`add stripe --copy --local ${MONOREPO} --yes`);

    let server = readFixture("server/index.ts");
    expect(server).toContain("rawBody");
    expect(server).toContain("/api/stripe/webhook");

    execSync(`echo y | node ${CLI} remove stripe`, { cwd: FIXTURES, encoding: "utf8" });

    server = readFixture("server/index.ts");
    expect(server).not.toContain("stripePlugin");
    expect(server).not.toContain("rawBody");
    expect(server).not.toContain("/api/stripe/webhook");
    expect(server).toContain("app.use(express.json());");
    expect(server).toContain("authPlugin");
    expect(server).toContain("crmPlugin");

    const config = readConfig();
    expect(config.installed).toEqual(["@stormeoio/auth", "@stormeoio/crm"]);
  }, REAL_PROCESS_TEST_TIMEOUT);

  it("blocks removal of auth when crm depends on it", () => {
    const result = runSafe("remove auth --yes");
    // Should fail because CRM depends on auth
    expect(result.code).not.toBe(0);
  });
});

describe("storm search", () => {
  beforeEach(setupProject);
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("finds plugins by name", () => {
    const output = run("search auth");
    expect(output).toContain("auth");
    expect(output).toContain("résultat");
  });

  it("finds plugins by keyword", () => {
    const output = run("search crm");
    expect(output).toContain("crm");
  });

  it("shows no results for unknown query", () => {
    const output = run("search zzzznotexist");
    expect(output).toContain("Aucun plugin");
  });
});

describe("storm publish", () => {
  beforeEach(setupProject);
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("generates registry entry in dry-run mode", () => {
    const output = run("publish auth --dry-run --yes");
    expect(output).toContain("@stormeoio/auth");
    expect(output).toContain("dry-run");
  });
});

describe("storm create-plugin", () => {
  beforeEach(setupProject);
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("scaffolds a plugin with correct structure", () => {
    const output = run("create-plugin test-widget --yes");

    expect(output).toContain("@stormeoio/test-widget");

    const pluginDir = path.join(FIXTURES, "plugin-test-widget");
    expect(fs.existsSync(path.join(pluginDir, "src/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, "src/schema.ts"))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, "src/routes.ts"))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, "tsup.config.ts"))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, "tsconfig.json"))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, "README.md"))).toBe(true);
  });

  it("generates valid StormPlugin definition", () => {
    run("create-plugin my-analytics --yes");

    const pluginDir = path.join(FIXTURES, "plugin-my-analytics");
    const index = fs.readFileSync(path.join(pluginDir, "src/index.ts"), "utf8");

    expect(index).toContain('id: "@stormeoio/my-analytics"');
    expect(index).toContain('name: "MyAnalytics"');
    expect(index).toContain("myAnalyticsPlugin");
    expect(index).toContain("StormPlugin");
    expect(index).toContain("configSchema");
    expect(index).toContain("my-analytics.created");
  });

  it("generates tenant-scoped routes with Zod validation", () => {
    run("create-plugin my-analytics --yes");

    const pluginDir = path.join(FIXTURES, "plugin-my-analytics");
    const routes = fs.readFileSync(path.join(pluginDir, "src/routes.ts"), "utf8");

    expect(routes).toContain("z.object");
    expect(routes).toContain("safeParse");
    expect(routes).toContain("tenantId");
    expect(routes).toContain("isAuthenticated");
  });

  it("generates valid package.json with correct name", () => {
    run("create-plugin cool-feature --yes");

    const pluginDir = path.join(FIXTURES, "plugin-cool-feature");
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8"));

    expect(pkg.name).toBe("@stormeoio/cool-feature");
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.exports["."]).toBeDefined();
    expect(pkg.peerDependencies["@stormeoio/core"]).toBe(`^${CLI_PACKAGE.version}`);
    expect(pkg.peerDependencies["@stormeoio/auth"]).toBe(`^${CLI_PACKAGE.version}`);
  });

  it("refuses to overwrite existing directory", () => {
    run("create-plugin dupe-test --yes");
    const output = run("create-plugin dupe-test --yes");
    expect(output).toContain("existe déjà");
  });
});

describe("storm deps", () => {
  beforeEach(setupProject);
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("shows installed plugins tree", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);
    run(`add crm --copy --local ${MONOREPO} --yes`);
    const output = run("deps");
    expect(output).toContain("auth");
    expect(output).toContain("crm");
    expect(output).toContain("bootstrap");
  });

  it("shows all plugins with --all", () => {
    const output = run("deps --all");
    expect(output).toContain("auth");
    expect(output).toContain("stripe");
    expect(output).toContain("billing");
    expect(output).toContain("bootstrap");
  });

  it("shows single plugin detail", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);
    const output = run("deps auth");
    expect(output).toContain("Auth");
    expect(output).toContain("@stormeoio/auth");
  });

  it("shows dependents for auth", () => {
    const output = run("deps auth --all");
    expect(output).toContain("crm");
    expect(output).toContain("ticketing");
  });

  it("outputs valid JSON with --json", () => {
    const output = run("deps --all --json");
    const parsed = JSON.parse(output);
    expect(parsed.graph).toBeDefined();
    expect(parsed.order).toBeDefined();
    expect(parsed.cycles).toBeDefined();
    expect(Array.isArray(parsed.order)).toBe(true);
    expect(parsed.order.length).toBeGreaterThan(0);
    expect(parsed.order[0]).toBe("@stormeoio/auth");
  });

  it("shows no plugins message when empty", () => {
    const output = run("deps");
    expect(output).toContain("Aucun plugin");
  });
});

describe("storm migrate", () => {
  beforeEach(setupProject);
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("shows empty status when no migrations exist", () => {
    const output = run("migrate status");
    expect(output).toContain("Aucune migration");
  });

  it("generates migrations for installed plugins with schema", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);
    const output = run("migrate generate --yes");
    expect(output).toContain("auth");

    // Journal file created
    const journalPath = path.join(FIXTURES, "drizzle", "storm-migrations.json");
    expect(fs.existsSync(journalPath)).toBe(true);
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    expect(journal.entries.length).toBeGreaterThan(0);
    expect(journal.entries[0].plugin).toBe("@stormeoio/auth");
    expect(journal.entries[0].applied).toBe(false);
  });

  it("generates SQL files with CREATE TABLE", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);
    run("migrate generate --yes");

    const drizzleDir = path.join(FIXTURES, "drizzle");
    const sqlFiles = fs.readdirSync(drizzleDir).filter((f) => f.endsWith(".sql") && !f.includes("rollback"));
    expect(sqlFiles.length).toBeGreaterThan(0);

    const sql = fs.readFileSync(path.join(drizzleDir, sqlFiles[0]!), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("generates migrations from npm package entrypoint schemas", () => {
    writeFixture("node_modules/@stormeoio/auth/dist/index.js", `
const { pgTable, text, timestamp } = require("drizzle-orm/pg-core");
exports.users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
`);
    const config = JSON.parse(readFixture("storm.json")) as { installed: string[] };
    config.installed = ["@stormeoio/auth"];
    writeFixture("storm.json", `${JSON.stringify(config, null, 2)}\n`);

    const output = run("migrate generate --yes");

    expect(output).toContain("auth");
    const drizzleDir = path.join(FIXTURES, "drizzle");
    const sqlFiles = fs.readdirSync(drizzleDir).filter((f) => f.endsWith(".sql") && !f.includes("rollback"));
    expect(sqlFiles.length).toBeGreaterThan(0);
    const sql = fs.readFileSync(path.join(drizzleDir, sqlFiles[0]!), "utf8");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "users"');
  });

  it("generates rollback files alongside migrations", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);
    run("migrate generate --yes");

    const drizzleDir = path.join(FIXTURES, "drizzle");
    const rollbackFiles = fs.readdirSync(drizzleDir).filter((f) => f.includes("rollback"));
    expect(rollbackFiles.length).toBeGreaterThan(0);

    const rollback = fs.readFileSync(path.join(drizzleDir, rollbackFiles[0]!), "utf8");
    expect(rollback).toContain("DROP TABLE IF EXISTS");
  });

  it("shows pending migrations in status", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);
    run("migrate generate --yes");
    const output = run("migrate status");
    expect(output).toContain("attente");
    expect(output).toContain("auth");
  });

  it("skips generation when schema unchanged", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);
    run("migrate generate --yes");

    // Second generate should not create new files
    const journalBefore = JSON.parse(fs.readFileSync(path.join(FIXTURES, "drizzle", "storm-migrations.json"), "utf8"));
    const countBefore = journalBefore.entries.length;

    run("migrate generate --yes");

    const journalAfter = JSON.parse(fs.readFileSync(path.join(FIXTURES, "drizzle", "storm-migrations.json"), "utf8"));
    expect(journalAfter.entries.length).toBe(countBefore);
  });
});

describe("storm docker", () => {
  beforeEach(setupProject);
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("generates all Docker files", () => {
    run("docker --yes");

    expect(fs.existsSync(path.join(FIXTURES, "Dockerfile"))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURES, "docker-compose.yml"))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURES, ".dockerignore"))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURES, ".env.example"))).toBe(true);
  });

  it("generates valid Dockerfile with multi-stage build", () => {
    run("docker --yes");

    const dockerfile = fs.readFileSync(path.join(FIXTURES, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("FROM node:20-alpine AS builder");
    expect(dockerfile).toContain("FROM node:20-alpine AS runner");
    expect(dockerfile).toContain("npm run build");
    expect(dockerfile).toContain("npm prune --omit=dev");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("NODE_ENV=production");
    expect(dockerfile).toContain("EXPOSE 3000");
  });

  it("generates docker-compose with postgres and app services", () => {
    run("docker --yes");

    const compose = fs.readFileSync(path.join(FIXTURES, "docker-compose.yml"), "utf8");
    expect(compose).toContain("postgres:");
    expect(compose).toContain("app:");
    expect(compose).toContain("postgres:16-alpine");
    expect(compose).toContain("DATABASE_URL");
    expect(compose).toContain("service_healthy");
    expect(compose).toContain("pgdata:");
  });

  it("respects custom port", () => {
    run("docker --yes --port 4000");

    const dockerfile = fs.readFileSync(path.join(FIXTURES, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("EXPOSE 4000");

    const compose = fs.readFileSync(path.join(FIXTURES, "docker-compose.yml"), "utf8");
    expect(compose).toContain("4000");
  });

  it("respects custom postgres version", () => {
    run("docker --yes --pg 15");

    const compose = fs.readFileSync(path.join(FIXTURES, "docker-compose.yml"), "utf8");
    expect(compose).toContain("postgres:15-alpine");
  });

  it("includes plugin env vars in .env.example", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);
    run("docker --yes");

    const envExample = fs.readFileSync(path.join(FIXTURES, ".env.example"), "utf8");
    expect(envExample).toContain("SESSION_SECRET");
    expect(envExample).toContain("DATABASE_URL");
    expect(envExample).toContain("POSTGRES_PASSWORD");
  });

  it("includes stripe env vars when stripe is installed", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);
    run(`add stripe --copy --local ${MONOREPO} --yes`);
    run("docker --yes");

    const server = readFixture("server/index.ts");
    expect(server).toContain("rawBody");
    expect(server).toContain("/api/stripe/webhook");

    const envExample = fs.readFileSync(path.join(FIXTURES, ".env.example"), "utf8");
    expect(envExample).toContain("STRIPE_SECRET_KEY");
    expect(envExample).toContain("STRIPE_WEBHOOK_SECRET");
  });

  it("generates proper .dockerignore", () => {
    run("docker --yes");

    const ignore = fs.readFileSync(path.join(FIXTURES, ".dockerignore"), "utf8");
    expect(ignore).toContain("node_modules");
    expect(ignore).toContain(".env");
    expect(ignore).toContain(".git");
    expect(ignore).toContain("dist");
  });
});

describe("storm update", () => {
  beforeEach(setupProject);
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("reports no updates when nothing installed", () => {
    const output = run("update --yes");
    expect(output).toContain("Aucun plugin");
  });

  it("reports all up to date for freshly installed plugins", () => {
    writeFixture("storm.json", JSON.stringify({
      version: 1,
      pluginsDir: "plugins",
      serverEntry: "server/index.ts",
      drizzleConfig: "drizzle.config.ts",
      registry: "",
      installed: ["@stormeoio/auth"],
    }));
    writeFixture("node_modules/@stormeoio/auth/package.json", JSON.stringify({
      name: "@stormeoio/auth",
      version: CLI_PACKAGE.version,
    }));
    wireCurrentAuthServer();

    const output = run("update --yes");
    expect(output).toContain("à jour");
  });

  it("dry-run does not modify files", () => {
    writeFixture("storm.json", JSON.stringify({
      version: 1,
      pluginsDir: "plugins",
      serverEntry: "server/index.ts",
      drizzleConfig: "drizzle.config.ts",
      registry: "",
      installed: ["@stormeoio/auth"],
    }));
    writeFixture("node_modules/@stormeoio/auth/package.json", JSON.stringify({
      name: "@stormeoio/auth",
      version: CLI_PACKAGE.version,
    }));
    const serverBefore = wireLegacyAuthServer();

    const output = run("update auth --dry-run --yes");

    expect(output).toContain("dry-run");
    expect(output).toContain("migration requireAdmin");
    expect(readFixture("server/index.ts")).toBe(serverBefore);
  });

  it("handles update of specific plugin without crash", () => {
    writeFixture("storm.json", JSON.stringify({
      version: 1,
      pluginsDir: "plugins",
      serverEntry: "server/index.ts",
      drizzleConfig: "drizzle.config.ts",
      registry: "",
      installed: ["@stormeoio/auth", "@stormeoio/crm"],
    }));
    for (const id of ["auth", "crm"]) {
      writeFixture(`node_modules/@stormeoio/${id}/package.json`, JSON.stringify({
        name: `@stormeoio/${id}`,
        version: CLI_PACKAGE.version,
      }));
    }
    const serverBefore = wireLegacyAuthServer()
      .replace(
        'import { authPlugin } from "@stormeoio/auth";',
        'import { authPlugin } from "@stormeoio/auth";\nimport { crmPlugin } from "@stormeoio/crm";',
      )
      .replace("registry.register(authPlugin);", "registry.register(authPlugin);\nregistry.register(crmPlugin);");
    writeFixture("server/index.ts", serverBefore);

    const output = run("update crm --yes");

    expect(output).toContain("à jour");
    expect(readFixture("server/index.ts")).toBe(serverBefore);
    expect(readFixture("server/index.ts")).not.toContain("createDatabaseRoleGuard");
  });

  it("ignores non-installed plugin argument", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);
    const output = run("update billing --yes");
    // billing is coming-soon, not installed — should report nothing to update
    expect(output).toContain("jour");
  });

  it("migrates requireAdmin even when the auth package is already current", () => {
    writeFixture("storm.json", JSON.stringify({
      version: 1,
      pluginsDir: "plugins",
      serverEntry: "server/index.ts",
      drizzleConfig: "drizzle.config.ts",
      registry: "",
      installed: ["@stormeoio/auth"],
    }));
    writeFixture("node_modules/@stormeoio/auth/package.json", JSON.stringify({
      name: "@stormeoio/auth",
      version: CLI_PACKAGE.version,
    }));
    wireLegacyAuthServer();

    const output = run("update auth --yes");
    const server = readFixture("server/index.ts");

    expect(output).toContain("migration requireAdmin");
    expect(output).toContain("1 plugin(s) mis à jour");
    expect(server).toContain(
      'import { authPlugin, createDatabaseRoleGuard } from "@stormeoio/auth";',
    );
    expect(server).toContain(
      'requireAdmin: createDatabaseRoleGuard({} as any, "admin")',
    );
  });

  it("returns a non-zero exit code without touching a stale copy recovery backup", () => {
    writeFixture("storm.json", JSON.stringify({
      version: 1,
      pluginsDir: "plugins",
      serverEntry: "server/index.ts",
      drizzleConfig: "drizzle.config.ts",
      registry: "",
      installed: ["@stormeoio/auth"],
    }));
    writeFixture("plugins/auth/version.ts", 'export const PACKAGE_VERSION = "0.1.0";\n');
    const pluginBefore = readFixture("plugins/auth/version.ts");
    const serverBefore = wireLegacyAuthServer();
    const backupDir = path.join(FIXTURES, "plugins/.auth.backup");
    const sentinel = Buffer.from([0x00, 0xff, 0x53, 0x54, 0x4f, 0x52, 0x4d, 0x0a]);
    fs.mkdirSync(path.join(backupDir, "recovery"), { recursive: true });
    fs.writeFileSync(path.join(backupDir, "recovery/sentinel.bin"), sentinel);

    const result = runSafe("update auth --yes");
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.code).not.toBe(0);
    expect(output).toContain("Backup de récupération existant");
    expect(output).toContain("aucune mise à jour appliquée");
    expect(output).not.toContain("1 plugin(s) mis à jour");
    expect(output).not.toContain("Action requise");
    expect(readFixture("plugins/auth/version.ts")).toBe(pluginBefore);
    expect(readFixture("server/index.ts")).toBe(serverBefore);
    expect(readFixture("server/index.ts")).not.toContain("createDatabaseRoleGuard");
    expect(fs.readFileSync(path.join(backupDir, "recovery/sentinel.bin"))).toEqual(sentinel);
    expect(fs.readdirSync(backupDir, { recursive: true }).sort()).toEqual([
      "recovery",
      "recovery/sentinel.bin",
    ]);
  });

  it("returns a non-zero exit code when an npm update fails", () => {
    writeFixture("storm.json", JSON.stringify({
      version: 1,
      pluginsDir: "plugins",
      serverEntry: "server/index.ts",
      drizzleConfig: "drizzle.config.ts",
      registry: "",
      installed: ["@stormeoio/auth"],
    }));
    writeFixture("node_modules/@stormeoio/auth/package.json", JSON.stringify({
      name: "@stormeoio/auth",
      version: "0.1.0",
    }));
    const serverBefore = wireLegacyAuthServer();

    const result = runSafe("update auth --yes", FIXTURES, {
      npm_config_audit: "false",
      npm_config_cache: path.join(FIXTURES, ".empty-npm-cache"),
      npm_config_fetch_retries: "0",
      npm_config_offline: "true",
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.code).not.toBe(0);
    expect(output).toContain("1 plugin(s) non mis à jour");
    expect(output).not.toContain("1 plugin(s) mis à jour");
    expect(output).not.toContain("Action requise");
    expect(JSON.parse(readFixture("node_modules/@stormeoio/auth/package.json"))).toMatchObject({
      version: "0.1.0",
    });
    expect(readFixture("server/index.ts")).toBe(serverBefore);
    expect(readFixture("server/index.ts")).not.toContain("createDatabaseRoleGuard");
  }, REAL_PROCESS_TEST_TIMEOUT);
});

describe("storm --help", () => {
  beforeEach(setupProject);
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("prints usage", () => {
    const output = run("--help");
    expect(output).toContain("storm");
    expect(output).toContain("dev");
    expect(output).toContain("add");
    expect(output).toContain("remove");
    expect(output).toContain("list");
    expect(output).toContain("search");
    expect(output).toContain("publish");
    expect(output).toContain("migrate");
    expect(output).toContain("docker");
    expect(output).toContain("deps");
    expect(output).toContain("update");
    expect(output).toContain("create-plugin");
    expect(output).toContain("info");
    expect(output).toContain("init");
  });
});

describe("storm --version", () => {
  beforeEach(setupProject);
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("prints version", () => {
    const output = run("--version");
    expect(output.trim()).toBe(CLI_PACKAGE.version);
  });
});
