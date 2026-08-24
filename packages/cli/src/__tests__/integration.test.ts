/**
 * Integration test — Full pipeline: init → add → remove → search → publish
 *
 * Exercises the CLI end-to-end against a real fixture project,
 * verifying server entry wiring, drizzle config, storm.json state,
 * client component mapping, and CLAUDE.md generation through a
 * realistic multi-plugin setup flow.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "node:os";
import path from "path";
import { execSync } from "child_process";

const CLI = path.resolve(__dirname, "../../dist/index.mjs");
const FIXTURES = path.join(os.tmpdir(), `storm-cli-integration-${process.pid}`);
const MONOREPO = path.resolve(__dirname, "../../../..");
const REAL_PROCESS_TEST_TIMEOUT = 30_000;

// This suite executes the built CLI repeatedly against a real fixture project.
vi.setConfig({ testTimeout: REAL_PROCESS_TEST_TIMEOUT, hookTimeout: REAL_PROCESS_TEST_TIMEOUT });

function run(cmd: string, cwd: string = FIXTURES): string {
  return execSync(`node ${CLI} ${cmd}`, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function runSafe(cmd: string, cwd: string = FIXTURES): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = run(cmd, cwd);
    return { stdout, stderr: "", code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.status ?? 1 };
  }
}

function read(file: string): string {
  return fs.readFileSync(path.join(FIXTURES, file), "utf8");
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(read(file));
}

function exists(file: string): boolean {
  return fs.existsSync(path.join(FIXTURES, file));
}

// ── Fixture setup ───────────────────────────────────────────────────────────

function setupCleanProject() {
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  fs.mkdirSync(path.join(FIXTURES, "server"), { recursive: true });

  fs.writeFileSync(
    path.join(FIXTURES, "package.json"),
    JSON.stringify({ name: "integration-test-app", version: "0.1.0" }),
  );

  fs.writeFileSync(
    path.join(FIXTURES, "server/index.ts"),
    `import "dotenv/config";
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
`,
  );

  fs.writeFileSync(
    path.join(FIXTURES, "drizzle.config.ts"),
    `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: [],
  out: "./drizzle",
  dbCredentials: { url: process.env["DATABASE_URL"]! },
});
`,
  );

  fs.writeFileSync(
    path.join(FIXTURES, "storm.json"),
    JSON.stringify({
      version: 1,
      pluginsDir: "plugins",
      serverEntry: "server/index.ts",
      drizzleConfig: "drizzle.config.ts",
      registry: "",
      installed: [],
    }),
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Full pipeline: init → add → verify → remove → verify", () => {
  beforeAll(setupCleanProject);
  afterAll(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  // ── Step 1: Add auth (no dependencies) ──────────────────────────────────

  it("step 1: adds auth plugin", () => {
    const output = run(`add auth --copy --local ${MONOREPO} --yes`);
    expect(output).toContain("auth");

    // Files exist
    expect(exists("plugins/auth/index.ts")).toBe(true);
    expect(exists("plugins/auth/schema.ts")).toBe(true);
    expect(exists("plugins/auth/routes.ts")).toBe(true);
    expect(exists("plugins/auth/middleware.ts")).toBe(true);
  });

  it("step 1: server entry wired for auth", () => {
    const server = read("server/index.ts");
    expect(server).toContain(
      'import { authPlugin, createDatabaseRoleGuard } from "../plugins/auth"',
    );
    expect(server).toContain("registry.register(authPlugin)");
    expect(server).toContain(
      'requireAdmin: createDatabaseRoleGuard({} as any, "admin")',
    );
  });

  it("step 1: drizzle config includes auth schema", () => {
    const drizzle = read("drizzle.config.ts");
    expect(drizzle).toContain("./plugins/auth/schema.ts");
  });

  it("step 1: storm.json tracks auth", () => {
    const config = readJson("storm.json") as { installed: string[] };
    expect(config.installed).toEqual(["@stormeoio/auth"]);
  });

  it("step 1: CLAUDE.md generated with auth info", () => {
    expect(exists("CLAUDE.md")).toBe(true);
    const claude = read("CLAUDE.md");
    expect(claude).toContain("@stormeoio/auth");
    expect(claude).toContain("SESSION_SECRET");
  });

  // ── Step 2: Add CRM (depends on auth) ──────────────────────────────────

  it("step 2: adds CRM plugin", () => {
    const output = run(`add crm --copy --local ${MONOREPO} --yes`);
    expect(output).toContain("crm");

    expect(exists("plugins/crm/index.ts")).toBe(true);
    expect(exists("plugins/crm/schema.ts")).toBe(true);
    expect(exists("plugins/crm/routes.ts")).toBe(true);
  });

  it("step 2: server entry has both plugins", () => {
    const server = read("server/index.ts");
    expect(server).toContain("authPlugin");
    expect(server).toContain("crmPlugin");

    // Auth must be registered before CRM (dependency order)
    const authIdx = server.indexOf("registry.register(authPlugin)");
    const crmIdx = server.indexOf("registry.register(crmPlugin)");
    expect(authIdx).toBeLessThan(crmIdx);
  });

  it("step 2: drizzle config has both schemas", () => {
    const drizzle = read("drizzle.config.ts");
    expect(drizzle).toContain("./plugins/auth/schema.ts");
    expect(drizzle).toContain("./plugins/crm/schema.ts");
  });

  it("step 2: storm.json tracks both plugins in order", () => {
    const config = readJson("storm.json") as { installed: string[] };
    expect(config.installed).toEqual(["@stormeoio/auth", "@stormeoio/crm"]);
  });

  // ── Step 3: Add ticketing (depends on auth) ────────────────────────────

  it("step 3: adds ticketing plugin", () => {
    run(`add ticketing --copy --local ${MONOREPO} --yes`);

    expect(exists("plugins/ticketing/index.ts")).toBe(true);
    expect(exists("plugins/ticketing/schema.ts")).toBe(true);
  });

  it("step 3: all three plugins wired correctly", () => {
    const server = read("server/index.ts");
    const imports = server.split("\n").filter((l) => l.startsWith("import"));
    const registers = server.split("\n").filter((l) => l.includes("registry.register"));

    // 4 original imports + 3 plugin imports
    expect(imports.length).toBeGreaterThanOrEqual(7);
    expect(registers.length).toBe(3);

    const config = readJson("storm.json") as { installed: string[] };
    expect(config.installed).toHaveLength(3);
    expect(config.installed).toContain("@stormeoio/auth");
    expect(config.installed).toContain("@stormeoio/crm");
    expect(config.installed).toContain("@stormeoio/ticketing");
  });

  it("step 3: drizzle config has all three schemas", () => {
    const drizzle = read("drizzle.config.ts");
    expect(drizzle).toContain("./plugins/auth/schema.ts");
    expect(drizzle).toContain("./plugins/crm/schema.ts");
    expect(drizzle).toContain("./plugins/ticketing/schema.ts");
  });

  // ── Step 4: Idempotency — re-adding shows already installed ────────────

  it("step 4: re-adding auth says already installed", () => {
    const output = run(`add auth --copy --local ${MONOREPO} --yes`);
    expect(output).toContain("déjà installé");

    // Still only 3 plugins
    const config = readJson("storm.json") as { installed: string[] };
    expect(config.installed).toHaveLength(3);
  });

  // ── Step 5: Search works in project context ────────────────────────────

  it("step 5: search finds auth by name", () => {
    const output = run("search auth");
    expect(output).toContain("auth");
    expect(output).toContain("résultat");
  });

  it("step 5: search finds plugins by tag/keyword", () => {
    const output = run("search stripe");
    expect(output).toContain("stripe");
    expect(output).toContain("résultat");
  });

  it("step 5: search shows no results for gibberish", () => {
    const output = run("search xyznonexistent999");
    expect(output).toContain("Aucun plugin");
  });

  // ── Step 6: Publish dry-run ────────────────────────────────────────────

  it("step 6: publish dry-run generates registry entry", () => {
    const output = run("publish auth --dry-run --yes");
    expect(output).toContain("@stormeoio/auth");
    expect(output).toContain("dry-run");
  });

  // ── Step 7: List shows install status ──────────────────────────────────

  it("step 7: list shows installed and available plugins", () => {
    const output = run("list");
    expect(output).toContain("auth");
    expect(output).toContain("crm");
    expect(output).toContain("ticketing");
    expect(output).toContain("stripe");
    expect(output).toContain("installé");
  });

  // ── Step 8: Remove CRM ────────────────────────────────────────────────

  it("step 8: removes CRM plugin", () => {
    execSync(`echo y | node ${CLI} remove crm`, {
      cwd: FIXTURES,
      encoding: "utf8",
    });

    // Plugin files removed
    expect(exists("plugins/crm")).toBe(false);

    // Server entry cleaned
    const server = read("server/index.ts");
    expect(server).not.toContain("crmPlugin");
    expect(server).toContain("authPlugin");
    expect(server).toContain("ticketingPlugin");

    // Drizzle cleaned
    const drizzle = read("drizzle.config.ts");
    expect(drizzle).not.toContain("crm");
    expect(drizzle).toContain("auth");
    expect(drizzle).toContain("ticketing");

    // Config updated
    const config = readJson("storm.json") as { installed: string[] };
    expect(config.installed).toEqual(["@stormeoio/auth", "@stormeoio/ticketing"]);
  });

  // ── Step 9: Can't remove auth (ticketing depends on it) ───────────────

  it("step 9: blocks auth removal when ticketing depends on it", () => {
    const result = runSafe("remove auth --yes");
    expect(result.code).not.toBe(0);
  });

  // ── Step 10: Remove ticketing, then auth ──────────────────────────────

  it("step 10: removes ticketing then auth cleanly", () => {
    execSync(`echo y | node ${CLI} remove ticketing`, {
      cwd: FIXTURES,
      encoding: "utf8",
    });

    let config = readJson("storm.json") as { installed: string[] };
    expect(config.installed).toEqual(["@stormeoio/auth"]);

    execSync(`echo y | node ${CLI} remove auth`, {
      cwd: FIXTURES,
      encoding: "utf8",
    });

    config = readJson("storm.json") as { installed: string[] };
    expect(config.installed).toEqual([]);

    // Plugin dirs removed
    expect(exists("plugins/auth")).toBe(false);
    expect(exists("plugins/ticketing")).toBe(false);

    // Server entry clean — no plugin imports
    const server = read("server/index.ts");
    expect(server).not.toContain("authPlugin");
    expect(server).not.toContain("ticketingPlugin");
    expect(server).not.toContain("crmPlugin");
  });

  // ── Step 11: Re-add from scratch after full cleanup ───────────────────

  it("step 11: re-adds auth from scratch after cleanup", () => {
    run(`add auth --copy --local ${MONOREPO} --yes`);

    expect(exists("plugins/auth/index.ts")).toBe(true);

    const server = read("server/index.ts");
    expect(server).toContain("authPlugin");

    const config = readJson("storm.json") as { installed: string[] };
    expect(config.installed).toEqual(["@stormeoio/auth"]);
  });
});

// ── Help & version sanity ───────────────────────────────────────────────────

describe("CLI help includes all commands", () => {
  beforeAll(setupCleanProject);
  afterAll(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("help lists all commands including search and publish", () => {
    const output = run("--help");
    const commands = ["dev", "add", "remove", "list", "search", "publish", "info", "init"];
    for (const cmd of commands) {
      expect(output).toContain(cmd);
    }
  });

  it("version returns semver string", () => {
    const output = run("--version").trim();
    expect(output).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ── Coming-soon and unknown plugin handling ─────────────────────────────────

describe("Edge cases", () => {
  beforeAll(setupCleanProject);
  afterAll(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("rejects coming-soon plugins", () => {
    const output = run(`add billing --copy --local ${MONOREPO} --yes`);
    expect(output).toContain("pas encore disponible");
  });

  it("rejects unknown plugins with non-zero exit", () => {
    const result = runSafe(`add nonexistent --copy --local ${MONOREPO} --yes`);
    expect(result.code).not.toBe(0);
  });

  it("CRM auto-resolves auth dependency", () => {
    // No auth installed yet — adding CRM should trigger auth first
    run(`add crm --copy --local ${MONOREPO} --yes`);

    const config = readJson("storm.json") as { installed: string[] };
    expect(config.installed).toContain("@stormeoio/auth");
    expect(config.installed).toContain("@stormeoio/crm");

    // Auth must come before CRM
    const authIdx = config.installed.indexOf("@stormeoio/auth");
    const crmIdx = config.installed.indexOf("@stormeoio/crm");
    expect(authIdx).toBeLessThan(crmIdx);
  });
});
