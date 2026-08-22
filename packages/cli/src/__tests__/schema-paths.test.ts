import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { injectDrizzleSchema } from "../injector";
import { drizzleSchemaReference, pluginSchemaCandidates, resolvePluginSchemaFile } from "../schema-paths";
import { PLUGINS, type PluginMeta } from "../registry";

const authPlugin = PLUGINS.find((plugin) => plugin.id === "@stormstack/auth") as PluginMeta;

let root: string;

function writeFile(file: string, content: string): void {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function readFile(file: string): string {
  return fs.readFileSync(path.join(root, file), "utf8");
}

describe("schema path helpers", () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "storm-cli-schema-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("uses package entrypoints for npm drizzle schema references", () => {
    writeFile("drizzle.config.ts", `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: [],
  out: "./drizzle",
});
`);

    const result = injectDrizzleSchema(path.join(root, "drizzle.config.ts"), authPlugin, "npm", "plugins");

    expect(result).toMatchObject({ modified: true, configured: true });
    expect(injectDrizzleSchema(
      path.join(root, "drizzle.config.ts"),
      authPlugin,
      "npm",
      "plugins",
    )).toMatchObject({ modified: false, configured: true });
    const drizzle = readFile("drizzle.config.ts");
    expect(drizzle).toContain('"node_modules/@stormstack/auth/dist/index.js"');
    expect(drizzle).not.toContain("/dist/schema.js");
  });

  it("keeps copied plugins pointed at their local schema source", () => {
    expect(drizzleSchemaReference(authPlugin, "copy", "vendor/plugins")).toBe(
      '"./vendor/plugins/auth/schema.ts"',
    );
  });

  it("resolves local source schemas before packaged entrypoints", () => {
    writeFile("vendor/plugins/auth/schema.ts", "export const localSchema = true;");
    writeFile("node_modules/@stormstack/auth/dist/index.js", "export const packageSchema = true;");

    expect(resolvePluginSchemaFile(root, authPlugin, "vendor/plugins")).toBe(
      path.join(root, "vendor/plugins/auth/schema.ts"),
    );
  });

  it("falls back to legacy dist/schema.js for older packages", () => {
    writeFile("node_modules/@stormstack/auth/dist/schema.js", "export const legacySchema = true;");

    expect(pluginSchemaCandidates(root, authPlugin, "plugins")).toEqual([
      path.join(root, "plugins/auth/schema.ts"),
      path.join(root, "node_modules/@stormstack/auth/dist/index.js"),
      path.join(root, "node_modules/@stormstack/auth/dist/schema.js"),
    ]);
    expect(resolvePluginSchemaFile(root, authPlugin, "plugins")).toBe(
      path.join(root, "node_modules/@stormstack/auth/dist/schema.js"),
    );
  });
});
