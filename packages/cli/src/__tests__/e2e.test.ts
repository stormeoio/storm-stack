import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const CLI = path.resolve(__dirname, "../../dist/index.mjs");
const FIXTURES = path.resolve(__dirname, "../../.test-fixtures");
const MONOREPO = path.resolve(__dirname, "../../../..");

function run(cmd: string, cwd: string = FIXTURES): string {
  return execSync(`node ${CLI} ${cmd}`, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } });
}

function runSafe(cmd: string, cwd: string = FIXTURES): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`node ${CLI} ${cmd}`, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } });
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
import { registry, bootstrapPlugins } from "@stormstack/core";
import type { StormContext, StormEnv } from "@stormstack/core";

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
    expect(server).toContain('import { authPlugin } from "../plugins/auth"');
    expect(server).toContain("registry.register(authPlugin)");

    // Drizzle config updated
    const drizzle = readFixture("drizzle.config.ts");
    expect(drizzle).toContain("./plugins/auth/schema.ts");

    // storm.json updated
    const config = readConfig();
    expect(config.installed).toContain("@stormstack/auth");
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
    expect(config.installed).toEqual(["@stormstack/auth", "@stormstack/crm"]);
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
    expect(config.installed).toEqual(["@stormstack/auth"]);
  });

  it("blocks removal of auth when crm depends on it", () => {
    const result = runSafe("remove auth --yes");
    // Should fail because CRM depends on auth
    expect(result.code).not.toBe(0);
  });
});

describe("storm --help", () => {
  beforeEach(setupProject);
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("prints usage", () => {
    const output = run("--help");
    expect(output).toContain("storm");
    expect(output).toContain("add");
    expect(output).toContain("remove");
    expect(output).toContain("list");
    expect(output).toContain("init");
  });
});

describe("storm --version", () => {
  beforeEach(setupProject);
  afterEach(() => fs.rmSync(FIXTURES, { recursive: true, force: true }));

  it("prints version", () => {
    const output = run("--version");
    expect(output.trim()).toBe("0.1.0");
  });
});
