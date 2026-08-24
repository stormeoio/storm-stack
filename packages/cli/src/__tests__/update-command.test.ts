import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as p from "@clack/prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateCommand } from "../commands/update";
import { resolvePlugin } from "../registry";
import { loadLocalPluginCopySources } from "../copy-source-files";
import * as utils from "../utils";

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof utils>();
  return {
    ...actual,
    fetchFile: vi.fn(),
    runInstall: vi.fn(),
  };
});

const originalCwd = process.cwd();
const temporaryDirectories: string[] = [];
const fetchFileMock = vi.mocked(utils.fetchFile);
const runInstallMock = vi.mocked(utils.runInstall);
const SLOW_IO_TEST_TIMEOUT = 15_000;

function write(root: string, file: string, content: string): void {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function createProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "storm-update-command-"));
  temporaryDirectories.push(root);
  write(root, "package.json", `${JSON.stringify({ name: "update-fixture", private: true })}\n`);
  write(root, "storm.json", `${JSON.stringify({
    version: 1,
    pluginsDir: "plugins",
    serverEntry: "server/index.ts",
    drizzleConfig: "drizzle.config.ts",
    registry: "",
    installed: ["@stormeoio/auth"],
  }, null, 2)}\n`);
  write(root, "server/index.ts", `import { registry, bootstrapPlugins } from "@stormeoio/core";
import { authPlugin } from "@stormeoio/auth";

registry.register(authPlugin);

async function main() {
  await bootstrapPlugins({ app, ctx });
}
`);
  process.chdir(root);
  return root;
}

async function authPluginFiles(root: string, version = "0.1.0"): Promise<Record<string, string>> {
  const plugin = resolvePlugin("auth");
  if (!plugin) throw new Error("Auth plugin metadata missing");
  const serverEntry = path.join(root, "server/index.ts");
  fs.writeFileSync(
    serverEntry,
    fs.readFileSync(serverEntry, "utf8").replace('from "@stormeoio/auth"', 'from "../plugins/auth"'),
    "utf8",
  );

  const files: Record<string, string> = {};
  for (const file of await authCopySourceFiles()) {
    const content = file === "index.ts"
      ? `export const authPlugin = { version: "${version}" };\n`
      : file === "version.ts"
        ? `export const PACKAGE_VERSION = "${version}";\n`
      : `export const old_${file.replace(/\W/g, "_")} = true;\n`;
    files[file] = content;
    write(root, path.join("plugins/auth", file), content);
  }
  return files;
}

async function authPluginFilesSnapshot(root: string): Promise<Record<string, string>> {
  return Object.fromEntries((await authCopySourceFiles()).map((file) => [
    file,
    fs.readFileSync(path.join(root, "plugins/auth", file), "utf8"),
  ]));
}

async function upstreamAuthFiles(): Promise<Record<string, string>> {
  const plugin = resolvePlugin("auth");
  if (!plugin) throw new Error("Auth plugin metadata missing");
  const sources = await loadLocalPluginCopySources(
    path.resolve(import.meta.dirname, "../../../.."),
    plugin,
  );
  return Object.fromEntries(sources.map(({ file, content }) => [file, content]));
}

async function authCopySourceFiles(): Promise<string[]> {
  return Object.keys(await upstreamAuthFiles());
}

function fileFromRawUrl(url: string): string {
  return new URL(url).pathname.split("/src/")[1]!;
}

function createNpmPackageFixture(root: string): string {
  const packageRoot = path.join(root, "npm-package");
  write(packageRoot, "package.json", `${JSON.stringify({
    name: "@stormeoio/auth",
    version: "0.1.1",
    main: "index.js",
  }, null, 2)}\n`);
  write(
    packageRoot,
    "index.js",
    "module.exports = { version: '0.1.1', createDatabaseRoleGuard: () => () => {} };\n",
  );
  return packageRoot;
}

function installOfflineNpmShim(root: string, packageFixture: string): string {
  const shimDir = path.join(root, "npm-shim");
  const shimPath = path.join(shimDir, "npm");
  const argumentsLog = path.join(root, "npm-arguments.json");
  const realNpm = execFileSync("sh", ["-c", "command -v npm"], { encoding: "utf8" }).trim();

  write(shimDir, "npm", `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.STORM_NPM_ARGUMENTS_LOG, JSON.stringify(args));
if (args.join(" ") !== "install @stormeoio/auth@^0.1.1") process.exit(64);
const result = spawnSync(
  process.env.STORM_REAL_NPM,
  ["install", process.env.STORM_NPM_PACKAGE, "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: process.cwd(), env: process.env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
`);
  fs.chmodSync(shimPath, 0o755);
  vi.stubEnv("STORM_REAL_NPM", realNpm);
  vi.stubEnv("STORM_NPM_PACKAGE", packageFixture);
  vi.stubEnv("STORM_NPM_ARGUMENTS_LOG", argumentsLog);
  vi.stubEnv("PATH", `${shimDir}${path.delimiter}${process.env.PATH ?? ""}`);

  return argumentsLog;
}

beforeEach(() => {
  fetchFileMock.mockReset();
  runInstallMock.mockReset();
  runInstallMock.mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("storm update command", () => {
  it("installe réellement le train npm 0.1.1 depuis un plugin 0.1.0", async () => {
    const root = createProject();
    write(root, "node_modules/@stormeoio/auth/package.json", `${JSON.stringify({
      name: "@stormeoio/auth",
      version: "0.1.0",
    })}\n`);

    const result = await updateCommand("auth", { yes: true });

    expect(result).toEqual({
      status: "success",
      updatedPluginIds: ["@stormeoio/auth"],
      failures: [],
    });
    expect(runInstallMock).toHaveBeenCalledOnce();
    expect(runInstallMock).toHaveBeenCalledWith(
      fs.realpathSync(root),
      "npm",
      ["@stormeoio/auth@^0.1.1"],
    );
    const server = fs.readFileSync(path.join(root, "server/index.ts"), "utf8");
    expect(server).toContain(
      `import { authPlugin, createDatabaseRoleGuard } from "@stormeoio/auth";`,
    );
    expect(server).toContain(`requireAdmin: createDatabaseRoleGuard(ctx.db, "admin")`);
  });

  it("exécute réellement npm hors ligne depuis un package local", async () => {
    const root = createProject();
    write(root, "node_modules/@stormeoio/auth/package.json", `${JSON.stringify({
      name: "@stormeoio/auth",
      version: "0.1.0",
    })}\n`);
    const packageFixture = createNpmPackageFixture(root);
    const argumentsLog = installOfflineNpmShim(root, packageFixture);
    const actualUtils = await vi.importActual<typeof utils>("../utils");
    runInstallMock.mockImplementation(actualUtils.runInstall);

    const result = await updateCommand("auth", { yes: true });

    const projectPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")) as {
      packages: Record<string, {
        dependencies?: Record<string, string>;
        version?: string;
      }>;
    };
    const installedPackage = JSON.parse(
      fs.readFileSync(path.join(root, "node_modules/@stormeoio/auth/package.json"), "utf8"),
    ) as { version: string };

    expect(result.status).toBe("success");
    expect(JSON.parse(fs.readFileSync(argumentsLog, "utf8"))).toEqual([
      "install",
      "@stormeoio/auth@^0.1.1",
    ]);
    expect(projectPackage.dependencies["@stormeoio/auth"]).toBe("file:npm-package");
    expect(packageLock.packages[""]?.dependencies?.["@stormeoio/auth"]).toBe("file:npm-package");
    expect(packageLock.packages["npm-package"]?.version).toBe("0.1.1");
    expect(installedPackage.version).toBe("0.1.1");
    expect(fs.readFileSync(path.join(root, "server/index.ts"), "utf8"))
      .toContain(`requireAdmin: createDatabaseRoleGuard(ctx.db, "admin")`);
  }, SLOW_IO_TEST_TIMEOUT);

  it("remplace tous les fichiers copy 0.1.0 par le train 0.1.1", async () => {
    const root = createProject();
    await authPluginFiles(root);
    const upstream = await upstreamAuthFiles();
    fetchFileMock.mockImplementation(async (url) => {
      const file = fileFromRawUrl(url);
      const content = upstream[file];
      if (content === undefined) throw new Error(`upstream file not found: ${file}`);
      return content;
    });

    const result = await updateCommand("auth", { yes: true });

    expect(result.status).toBe("success");
    for (const [file, content] of Object.entries(upstream)) {
      expect(fs.readFileSync(path.join(root, "plugins/auth", file), "utf8")).toBe(content);
    }
    expect(fs.existsSync(path.join(root, "plugins/.auth.backup"))).toBe(false);
    expect(runInstallMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(root, "server/index.ts"), "utf8"))
      .toContain(`requireAdmin: createDatabaseRoleGuard(ctx.db, "admin")`);

    const stableSnapshot = await authPluginFilesSnapshot(root);
    expect(await updateCommand("auth", { yes: true })).toEqual({
      status: "success",
      updatedPluginIds: [],
      failures: [],
    });
    expect(await authPluginFilesSnapshot(root)).toEqual(stableSnapshot);
  });

  it("refuse un backup de récupération existant sans toucher au projet ni au backup", async () => {
    const root = createProject();
    const pluginBefore = await authPluginFiles(root);
    const serverBefore = fs.readFileSync(path.join(root, "server/index.ts"), "utf8");
    const backupDir = path.join(root, "plugins/.auth.backup");
    const sentinel = Buffer.from([0x00, 0xff, 0x53, 0x54, 0x4f, 0x52, 0x4d, 0x0a]);
    fs.mkdirSync(path.join(backupDir, "recovery"), { recursive: true });
    fs.writeFileSync(path.join(backupDir, "recovery/sentinel.bin"), sentinel);
    const info = vi.spyOn(p.log, "info");

    const result = await updateCommand("auth", { yes: true });

    expect(result).toEqual({
      status: "failed",
      updatedPluginIds: [],
      failures: [{
        pluginId: "@stormeoio/auth",
        message: expect.stringContaining("Backup de récupération existant"),
      }],
    });
    for (const [file, content] of Object.entries(pluginBefore)) {
      expect(fs.readFileSync(path.join(root, "plugins/auth", file), "utf8")).toBe(content);
    }
    expect(fs.readFileSync(path.join(backupDir, "recovery/sentinel.bin"))).toEqual(sentinel);
    expect(fs.readdirSync(backupDir, { recursive: true }).sort()).toEqual([
      "recovery",
      "recovery/sentinel.bin",
    ]);
    expect(fs.readFileSync(path.join(root, "server/index.ts"), "utf8")).toBe(serverBefore);
    expect(fs.readFileSync(path.join(root, "server/index.ts"), "utf8"))
      .not.toContain("createDatabaseRoleGuard");
    expect(fetchFileMock).not.toHaveBeenCalled();
    expect(runInstallMock).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining("plugin(s) mis à jour"));
  });

  it("arrête tout avant mutation si la détection réseau échoue après des fetchs réussis", async () => {
    const root = createProject();
    const before = await authPluginFiles(root);
    const serverBefore = fs.readFileSync(path.join(root, "server/index.ts"), "utf8");
    const upstream = await upstreamAuthFiles();
    const info = vi.spyOn(p.log, "info");
    const warn = vi.spyOn(p.log, "warn");
    fetchFileMock.mockImplementation(async (url) => {
      const file = fileFromRawUrl(url);
      if (file === "schema.ts") {
        throw new Error("upstream unavailable during detection");
      }
      const content = upstream[file];
      if (content === undefined) throw new Error(`upstream file not found: ${file}`);
      return content;
    });

    const result = await updateCommand("auth", { yes: true });

    expect(result).toEqual({
      status: "failed",
      updatedPluginIds: [],
      failures: [{
        pluginId: "@stormeoio/auth",
        message: expect.stringContaining("schema"),
      }],
    });
    for (const [file, content] of Object.entries(before)) {
      expect(fs.readFileSync(path.join(root, "plugins/auth", file), "utf8")).toBe(content);
    }
    expect(fs.existsSync(path.join(root, "plugins/.auth.backup"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "server/index.ts"), "utf8")).toBe(serverBefore);
    expect(info).not.toHaveBeenCalledWith(
      expect.stringContaining("1 plugin(s) mis à jour"),
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Action requise"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("aucune mise à jour appliquée"),
    );
    expect(fetchFileMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("échoue fermé et restaure le vieux copy si le garde manque et l'amont est indisponible", async () => {
    const root = createProject();
    const before = await authPluginFiles(root);
    const serverBefore = fs.readFileSync(path.join(root, "server/index.ts"), "utf8");
    fetchFileMock.mockRejectedValue(new Error("auth copy upstream unavailable"));

    const result = await updateCommand("auth", { yes: true });

    expect(result).toEqual({
      status: "failed",
      updatedPluginIds: [],
      failures: [{
        pluginId: "@stormeoio/auth",
        message: expect.stringContaining("Source copy introuvable"),
      }],
    });
    for (const [file, content] of Object.entries(before)) {
      expect(fs.readFileSync(path.join(root, "plugins/auth", file), "utf8")).toBe(content);
    }
    expect(fs.existsSync(path.join(root, "plugins/.auth.backup"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "server/index.ts"), "utf8")).toBe(serverBefore);
    expect(fetchFileMock).toHaveBeenCalledWith(
      expect.stringContaining("/packages/plugin-auth/src/client/LoginPage.tsx"),
    );
  });

  it("ne migre pas le serveur d'un copy courant quand le préflight amont est indisponible", async () => {
    const root = createProject();
    await authPluginFiles(root, "0.1.1");
    write(
      root,
      "plugins/auth/index.ts",
      `export { createDatabaseRoleGuard } from "./middleware";\nexport const authPlugin = { version: "0.1.1" };\n`,
    );
    write(
      root,
      "plugins/auth/middleware.ts",
      `export function createDatabaseRoleGuard() { return () => true; }\n`,
    );
    const pluginBefore = await authPluginFilesSnapshot(root);
    const serverBefore = fs.readFileSync(path.join(root, "server/index.ts"), "utf8");
    fetchFileMock.mockRejectedValue(new Error("auth copy upstream unavailable"));

    const result = await updateCommand("auth", { yes: true });

    expect(result).toEqual({
      status: "failed",
      updatedPluginIds: [],
      failures: [{
        pluginId: "@stormeoio/auth",
        message: expect.stringContaining("Source copy introuvable"),
      }],
    });
    expect(await authPluginFilesSnapshot(root)).toEqual(pluginBefore);
    expect(fetchFileMock).toHaveBeenCalledOnce();
    expect(fs.readFileSync(path.join(root, "server/index.ts"), "utf8")).toBe(serverBefore);
    expect(fs.readFileSync(path.join(root, "server/index.ts"), "utf8"))
      .not.toContain("createDatabaseRoleGuard");
  });

  it("restaure le serveur si la mise à jour npm échoue après la migration du garde", async () => {
    const root = createProject();
    const serverBefore = fs.readFileSync(path.join(root, "server/index.ts"), "utf8");
    write(root, "node_modules/@stormeoio/auth/package.json", `${JSON.stringify({
      name: "@stormeoio/auth",
      version: "0.1.0",
    })}\n`);
    runInstallMock.mockImplementation(() => {
      throw new Error("npm update unavailable");
    });

    const result = await updateCommand("auth", { yes: true });

    expect(result).toEqual({
      status: "failed",
      updatedPluginIds: [],
      failures: [{
        pluginId: "@stormeoio/auth",
        message: "npm update unavailable",
      }],
    });
    expect(fs.readFileSync(path.join(root, "server/index.ts"), "utf8")).toBe(serverBefore);
  });
});
