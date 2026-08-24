import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyPluginSource } from "../commands/add";
import { pluginSourceUrl, resolvePlugin, type PluginMeta } from "../registry";
import { VERSION } from "../version";

const temporaryDirectories: string[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const COPY_PLUGIN_NAMES = [
  "auth",
  "auth-social",
  "crm",
  "ticketing",
  "stripe",
  "consent",
] as const;
const TYPESCRIPT_PROGRAM_TEST_TIMEOUT = 30_000;

// Each case builds a real TypeScript program; parallel full-suite load can exceed Vitest's 5s default.
vi.setConfig({
  testTimeout: TYPESCRIPT_PROGRAM_TEST_TIMEOUT,
  hookTimeout: TYPESCRIPT_PROGRAM_TEST_TIMEOUT,
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("plugin copy mode", () => {
  it.each(COPY_PLUGIN_NAMES)("copies a complete, compilable %s source tree", async (name) => {
    const plugin = requiredPlugin(name);
    const projectRoot = fs.mkdtempSync(path.join(repositoryRoot, ".storm-copy-test-"));
    temporaryDirectories.push(projectRoot);

    for (const dependencyId of plugin.requires) {
      await copyPluginSource(projectRoot, "plugins", requiredPlugin(dependencyId), repositoryRoot);
    }
    await copyPluginSource(projectRoot, "plugins", plugin, repositoryRoot);

    const sourceRoot = path.join(repositoryRoot, "packages", `plugin-${plugin.shortName}`, "src");
    const copiedRoot = path.join(projectRoot, "plugins", plugin.shortName);
    const expectedFiles = runtimeSourceFiles(sourceRoot);
    const copiedFiles = runtimeSourceFiles(copiedRoot);

    expect(copiedFiles).toEqual(expectedFiles);
    expect(copiedFiles).toContain("version.ts");
    if ((plugin.clientComponents?.length ?? 0) > 0 || plugin.rootComponent) {
      expect(copiedFiles).toContain("client/index.ts");
    }

    const program = ts.createProgram(
      copiedFiles.map((file) => path.join(copiedRoot, ...file.split("/"))),
      {
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
      },
    );
    const errors = ts.getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    expect(errors).toEqual([]);
  });

  it("rewrites auth-social dynamic imports to the sibling auth copy", async () => {
    const plugin = requiredPlugin("auth-social");
    const projectRoot = fs.mkdtempSync(path.join(repositoryRoot, ".storm-copy-test-"));
    temporaryDirectories.push(projectRoot);

    await copyPluginSource(projectRoot, "plugins", plugin, repositoryRoot);

    const routes = fs.readFileSync(path.join(projectRoot, "plugins/auth-social/routes.ts"), "utf8");
    expect(routes).toContain('import("../auth")');
    expect(routes).not.toContain('import("@stormstack/auth")');
  });

  it("pins remote copy sources to the exact CLI release tag", () => {
    expect(pluginSourceUrl(requiredPlugin("auth"), "client/index.ts")).toBe(
      `https://raw.githubusercontent.com/stormeoio/storm-stack/v${VERSION}/packages/plugin-auth/src/client/index.ts`,
    );
  });
});

function requiredPlugin(nameOrId: string): PluginMeta {
  const plugin = resolvePlugin(nameOrId);
  if (!plugin) throw new Error(`Plugin metadata missing: ${nameOrId}`);
  return plugin;
}

function runtimeSourceFiles(root: string, directory = ""): string[] {
  const current = path.join(root, ...directory.split("/").filter(Boolean));
  const files: string[] = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...runtimeSourceFiles(root, relative));
    } else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(relative);
    }
  }
  return files.sort();
}
