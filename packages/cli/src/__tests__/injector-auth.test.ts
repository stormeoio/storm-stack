import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureDatabaseAdminGuardWiring,
  hasBootstrapAdminGuard,
  injectPluginRegistration,
  removePluginRegistration,
} from "../injector";
import { resolvePlugin } from "../registry";

const temporaryDirectories: string[] = [];

function createServer(source: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "storm-auth-injector-"));
  temporaryDirectories.push(root);
  const serverEntry = path.join(root, "server", "index.ts");
  fs.mkdirSync(path.dirname(serverEntry), { recursive: true });
  fs.writeFileSync(serverEntry, source, "utf8");
  return serverEntry;
}

function authPlugin() {
  const plugin = resolvePlugin("auth");
  if (!plugin) throw new Error("Auth plugin metadata missing");
  return plugin;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("auth plugin server injection", () => {
  it("adds and removes the guard in compact bootstrap syntax without deleting bootstrap options", () => {
    const serverEntry = createServer(`import { registry, bootstrapPlugins } from "@stormeoio/core";\n\nasync function main() {\n  await bootstrapPlugins({ app, ctx: { db: ctx.db, env, logger } });\n}\n`);

    expect(injectPluginRegistration(serverEntry, authPlugin(), "npm", "plugins")).toEqual({ modified: true });

    const injected = fs.readFileSync(serverEntry, "utf8");
    expect(injected).toContain(`await bootstrapPlugins({\n    requireAdmin: createDatabaseRoleGuard(ctx.db, "admin"),\n    app, ctx: { db: ctx.db, env, logger } });`);
    expect(
      (ts.transpileModule(injected, { reportDiagnostics: true }).diagnostics ?? [])
        .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error),
    ).toEqual([]);

    expect(removePluginRegistration(serverEntry, authPlugin())).toEqual({ modified: true });

    const removed = fs.readFileSync(serverEntry, "utf8");
    expect(removed).toContain("await bootstrapPlugins({\n    app, ctx: { db: ctx.db, env, logger } });");
    expect(removed).toContain("app, ctx: { db: ctx.db, env, logger }");
    expect(removed).not.toContain("requireAdmin");
  });

  it("uses ctx.db when ctx is the last shorthand bootstrap option", () => {
    const serverEntry = createServer(`import { registry, bootstrapPlugins } from "@stormeoio/core";\nconst ctx = { db };\nasync function main() {\n  await bootstrapPlugins({ app, ctx });\n}\n`);

    expect(injectPluginRegistration(serverEntry, authPlugin(), "npm", "plugins")).toEqual({ modified: true });
    expect(fs.readFileSync(serverEntry, "utf8")).toContain(
      `requireAdmin: createDatabaseRoleGuard(ctx.db, "admin")`,
    );
  });

  it("finds a safe inline db member even when db is not the first context property", () => {
    const serverEntry = createServer(`import { registry, bootstrapPlugins } from "@stormeoio/core";\nasync function main() {\n  await bootstrapPlugins({\n    app,\n    ctx: { env, db: services.database, logger },\n  });\n}\n`);

    expect(injectPluginRegistration(serverEntry, authPlugin(), "npm", "plugins")).toEqual({ modified: true });
    expect(fs.readFileSync(serverEntry, "utf8")).toContain(
      `requireAdmin: createDatabaseRoleGuard(services.database, "admin")`,
    );
  });

  it("ignores requireAdmin occurrences outside the exact bootstrap options object", () => {
    const serverEntry = createServer(`import { registry, bootstrapPlugins } from "@stormeoio/core";\nconst routeMetadata = { requireAdmin: false };\nasync function main() {\n  await bootstrapPlugins({ app, ctx });\n}\n`);

    expect(injectPluginRegistration(serverEntry, authPlugin(), "npm", "plugins")).toEqual({ modified: true });
    const injected = fs.readFileSync(serverEntry, "utf8");
    expect(injected).toContain(`const routeMetadata = { requireAdmin: false }`);
    expect(injected).toContain(`requireAdmin: createDatabaseRoleGuard(ctx.db, "admin")`);
    expect(hasBootstrapAdminGuard(serverEntry)).toBe(true);
  });

  it("injects and verifies the guard when whitespace separates bootstrapPlugins and its call", () => {
    const serverEntry = createServer(`import { registry, bootstrapPlugins } from "@stormeoio/core";\nasync function main() {\n  await bootstrapPlugins ({ app, ctx });\n}\n`);

    expect(injectPluginRegistration(serverEntry, authPlugin(), "npm", "plugins")).toEqual({ modified: true });
    const injected = fs.readFileSync(serverEntry, "utf8");
    expect(injected).toContain(`await bootstrapPlugins ({\n    requireAdmin: createDatabaseRoleGuard(ctx.db, "admin"),`);
    expect(hasBootstrapAdminGuard(serverEntry)).toBe(true);
  });

  it("inserts auth after multiline runtime/type imports without corrupting comments or syntax", () => {
    const serverEntry = createServer(`import {
  // Runtime bootstrap exports stay grouped.
  registry,
  bootstrapPlugins,
} from "@stormeoio/core";
import type {
  StormContext,
  StormEnv,
} from "@stormeoio/core"; // type-only import

/*
import { fakePlugin } from "comment-only";
*/
const ctx = {} as StormContext;
const env = {} as StormEnv;
async function main() {
  await bootstrapPlugins({ app, ctx });
}
`);

    expect(injectPluginRegistration(serverEntry, authPlugin(), "npm", "plugins")).toEqual({ modified: true });

    const injected = fs.readFileSync(serverEntry, "utf8");
    const typeImport = `} from "@stormeoio/core"; // type-only import`;
    const authImport = `import { authPlugin, createDatabaseRoleGuard } from "@stormeoio/auth";`;
    expect(injected.indexOf(authImport)).toBeGreaterThan(injected.indexOf(typeImport));
    expect(injected.indexOf(authImport)).toBeLessThan(injected.indexOf("/*\nimport { fakePlugin }"));
    expect(injected).toContain("// Runtime bootstrap exports stay grouped.");
    expect(injected).toContain(`requireAdmin: createDatabaseRoleGuard(ctx.db, "admin")`);
    expect(
      (ts.transpileModule(injected, { reportDiagnostics: true }).diagnostics ?? [])
        .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error),
    ).toEqual([]);
  });

  it("migrates an existing auth registration without duplicating it", () => {
    const serverEntry = createServer(`import { registry, bootstrapPlugins } from "@stormeoio/core";\nimport { authPlugin } from "@stormeoio/auth";\nconst routeMetadata = { requireAdmin: false };\nregistry.register(authPlugin);\nasync function main() {\n  await bootstrapPlugins ({ app, ctx });\n}\n`);

    expect(ensureDatabaseAdminGuardWiring(serverEntry)).toEqual({
      modified: true,
      configured: true,
    });
    const migrated = fs.readFileSync(serverEntry, "utf8");
    expect(migrated).toContain(
      `import { authPlugin, createDatabaseRoleGuard } from "@stormeoio/auth";`,
    );
    expect(migrated.match(/registry\.register\(authPlugin\)/g)).toHaveLength(1);
    expect(migrated).toContain(`requireAdmin: createDatabaseRoleGuard(ctx.db, "admin")`);
    expect(hasBootstrapAdminGuard(serverEntry)).toBe(true);
  });

  it("fails closed without touching an ambiguous server containing two bootstrap calls", () => {
    const original = `import { registry, bootstrapPlugins } from "@stormeoio/core";\nimport { authPlugin } from "@stormeoio/auth";\nregistry.register(authPlugin);\nasync function first() { await bootstrapPlugins({ app, ctx }); }\nasync function second() { await bootstrapPlugins({ app, ctx }); }\n`;
    const serverEntry = createServer(original);

    expect(ensureDatabaseAdminGuardWiring(serverEntry)).toMatchObject({
      modified: false,
      configured: false,
      reason: expect.stringContaining("unique"),
    });
    expect(fs.readFileSync(serverEntry, "utf8")).toBe(original);
  });

  it.each([
    "createContext(db)",
    "{ env, db: createDatabase(), logger }",
  ])("refuses the ambiguous context expression %s without modifying the file", (contextExpression) => {
    const original = `import { registry, bootstrapPlugins } from "@stormeoio/core";\nasync function main() {\n  await bootstrapPlugins({ app, ctx: ${contextExpression} });\n}\n`;
    const serverEntry = createServer(original);

    expect(injectPluginRegistration(serverEntry, authPlugin(), "npm", "plugins")).toMatchObject({
      modified: false,
      reason: expect.stringContaining("Impossible de trouver la base de données"),
    });
    expect(fs.readFileSync(serverEntry, "utf8")).toBe(original);
  });
});
