import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import {
  CliUsageError,
  normalizePluginIds,
  parseCliOptions,
} from "../cli-options";
import { runCreateStormApp } from "../index";
import {
  scaffold,
  SESSION_SECRET_PLACEHOLDER,
  SESSION_SECRET_SETUP_COMMAND,
  SESSION_SECRET_SETUP_SCRIPT,
} from "../scaffold";
import type { ScaffoldOptions } from "../prompts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "create-storm-app-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function read(directory: string, file: string): string {
  return fs.readFileSync(path.join(directory, file), "utf8");
}

function snapshotFiles(directory: string, relative = ""): Record<string, string> {
  const result: Record<string, string> = {};
  const current = path.join(directory, relative);
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const entryRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      Object.assign(result, snapshotFiles(directory, entryRelative));
    } else {
      result[entryRelative] = fs.readFileSync(path.join(directory, entryRelative), "utf8");
    }
  }
  return result;
}

async function loadGeneratedAppOriginNormalizer(
  directory: string,
): Promise<(value: string | undefined) => string> {
  const source = read(directory, "server/app-origin.ts");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  const generatedModule = await import(/* @vite-ignore */ moduleUrl) as {
    normalizeAppOrigin: (value: string | undefined) => string;
  };
  return generatedModule.normalizeAppOrigin;
}

const proofOptions: ScaffoldOptions = {
  projectName: "alpha",
  plugins: ["@stormeoio/auth", "@stormeoio/consent"],
  packageManager: "npm",
  withClient: true,
};

describe("non-interactive CLI options", () => {
  it("parses the documented deterministic command", () => {
    const result = parseCliOptions([
      "alpha",
      "--yes",
      "--plugins",
      "auth,consent",
      "--with-client",
      "--package-manager",
      "npm",
    ]);

    expect(result).toEqual({
      force: false,
      help: false,
      nameArg: "alpha",
      scaffoldOptions: proofOptions,
    });
  });

  it("accepts full IDs, removes duplicates and uses canonical plugin order", () => {
    expect(normalizePluginIds("@stormeoio/consent,auth,@stormeoio/auth")).toEqual([
      "@stormeoio/auth",
      "@stormeoio/consent",
    ]);
  });

  it("adds required plugins in canonical order", () => {
    expect(normalizePluginIds("consent")).toEqual([
      "@stormeoio/auth",
      "@stormeoio/consent",
    ]);
  });

  it("keeps the interactive path when --yes is absent", () => {
    expect(parseCliOptions(["alpha"])).toEqual({
      force: false,
      help: false,
      nameArg: "alpha",
    });
  });

  it.each([
    [["Alpha", "--yes"], "nom du projet"],
    [["alpha", "--yes", "--plugins", "unknown"], "Plugin(s) inconnu(s)"],
    [["alpha", "--yes", "--package-manager", "bun"], "Gestionnaire de paquets invalide"],
    [["alpha", "beta", "--yes"], "Un seul nom"],
    [["alpha", "--plugins", "auth"], "nécessitent --yes"],
  ])("rejects invalid deterministic input: %j", (args, message) => {
    expect(() => parseCliOptions(args)).toThrowError(message);
  });

  it("requires --force before replacing an existing directory", async () => {
    const root = makeTemporaryDirectory();
    const target = path.join(root, "alpha");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "sentinel.txt"), "preserve");
    const args = ["alpha", "--yes", "--plugins", "auth,consent", "--with-client"];

    await expect(runCreateStormApp(args, root)).rejects.toBeInstanceOf(CliUsageError);
    expect(read(target, "sentinel.txt")).toBe("preserve");

    await runCreateStormApp([...args, "--force"], root);
    expect(fs.existsSync(path.join(target, "sentinel.txt"))).toBe(false);
    expect(JSON.parse(read(target, "package.json"))).toMatchObject({ name: "alpha" });
  });
});

describe("scaffold output", () => {
  it("produces byte-identical files for identical options", () => {
    const root = makeTemporaryDirectory();
    const first = path.join(root, "first");
    const second = path.join(root, "second");

    scaffold(proofOptions, first);
    scaffold(proofOptions, second);

    expect(snapshotFiles(first)).toEqual(snapshotFiles(second));
  });

  it("wires consent, migrations, APP_ORIGIN and CSRF", () => {
    const target = path.join(makeTemporaryDirectory(), "alpha");
    scaffold(proofOptions, target);

    const packageJson = JSON.parse(read(target, "package.json")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(packageJson.scripts["db:generate"]).toBe("drizzle-kit generate");
    expect(packageJson.scripts["db:migrate"]).toBe("drizzle-kit migrate");
    expect(packageJson.dependencies).toHaveProperty("@stormeoio/consent");

    expect(read(target, "drizzle.config.ts")).toContain(
      "node_modules/@stormeoio/consent/dist/index.js",
    );
    expect(read(target, ".gitignore")).not.toContain("drizzle/meta/");

    const server = read(target, "server/index.ts");
    expect(server).toContain(
      'import { authPlugin, createDatabaseRoleGuard } from "@stormeoio/auth"',
    );
    expect(server).toContain('requireAdmin: createDatabaseRoleGuard(db, "admin")');
    expect(server).toContain('import { consentPlugin } from "@stormeoio/consent"');
    expect(server).toContain("registry.register(consentPlugin)");
    expect(server).toContain('import { createCsrfProtection } from "@stormeoio/core/csrf"');
    expect(server).toContain('import { normalizeAppOrigin } from "./app-origin.js"');
    expect(server).toContain('const APP_ORIGIN = normalizeAppOrigin(process.env["APP_ORIGIN"])');
    expect(server).toContain("env.SESSION_SECRET === SESSION_SECRET_PLACEHOLDER");
    expect(server).toContain("cors({ origin: APP_ORIGIN, credentials: true })");
    expect(server).toContain("allowedOrigins: [APP_ORIGIN]");
    expect(server).toContain('app.get("/api/storm/csrf", csrf.issueToken)');
    expect(server.indexOf("csrf.protect")).toBeLessThan(server.indexOf("await bootstrapPlugins"));

    const api = read(target, "client/src/lib/api.ts");
    expect(api).toContain('import { csrfFetch } from "@stormeoio/core/csrf-client"');
    expect(api).toContain("MUTATION_METHODS.has(method) ? csrfFetch : fetch");
    expect(api).toContain('method: "PUT"');

    const components = read(target, "client/src/storm-components.ts");
    expect(components).toContain('ConsentBanner } from "@stormeoio/consent/client"');
    expect(components).toContain("ConsentBanner,");
    const app = read(target, "client/src/App.tsx");
    expect(app).toContain("return user ? <ConsentBanner /> : null");
    expect(app).toContain("<StormRootConsentBanner />");
    expect(app).toContain("storm:root-component @stormeoio/consent");
    expect(app).toContain("const { user } = useStorm()");
    expect(app.match(/import \{ useQueryClient \}/g)).toHaveLength(1);

    expect(read(target, "README.md")).toContain("db:generate");
    expect(read(target, "README.md")).toContain("db:migrate");
    expect(read(target, "CLAUDE.md")).toContain("db:generate");
    expect(read(target, "CLAUDE.md")).toContain("db:migrate");
  });

  it("documents a portable command that replaces the rejected session-secret placeholder", () => {
    const target = path.join(makeTemporaryDirectory(), "alpha");
    scaffold(proofOptions, target);

    const generatedReadme = read(target, "README.md");
    expect(generatedReadme).toContain(`cp .env.example .env\n${SESSION_SECRET_SETUP_COMMAND}`);
    expect(SESSION_SECRET_SETUP_COMMAND).toContain("crypto.randomBytes(32).toString('hex')");

    fs.copyFileSync(path.join(target, ".env.example"), path.join(target, ".env"));
    execFileSync(process.execPath, ["-e", SESSION_SECRET_SETUP_SCRIPT], { cwd: target });

    const generatedEnv = read(target, ".env");
    expect(generatedEnv).not.toContain(`SESSION_SECRET=${SESSION_SECRET_PLACEHOLDER}`);
    expect(generatedEnv).toMatch(/^SESSION_SECRET=[0-9a-f]{64}$/m);
  });

  it("normalizes an APP_ORIGIN with a trailing slash", async () => {
    const target = path.join(makeTemporaryDirectory(), "alpha");
    scaffold(proofOptions, target);
    const normalizeAppOrigin = await loadGeneratedAppOriginNormalizer(target);

    expect(normalizeAppOrigin("https://app.example.test/")).toBe("https://app.example.test");
  });

  it.each([
    "not a URL",
    "ftp://app.example.test",
    "https://user:secret@app.example.test",
    "https://app.example.test/dashboard",
    "https://app.example.test?preview=1",
    "https://app.example.test#preview",
    " https://app.example.test",
  ])("rejects an unsafe APP_ORIGIN: %s", async (value) => {
    const target = path.join(makeTemporaryDirectory(), "alpha");
    scaffold(proofOptions, target);
    const normalizeAppOrigin = await loadGeneratedAppOriginNormalizer(target);

    expect(normalizeAppOrigin(value)).toBe("");
  });

  it("resolves dependencies for direct scaffold callers", () => {
    const target = path.join(makeTemporaryDirectory(), "consent-only");
    scaffold({ ...proofOptions, plugins: ["@stormeoio/consent"] }, target);

    const packageJson = JSON.parse(read(target, "package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies).toHaveProperty("@stormeoio/auth");
    expect(packageJson.dependencies).toHaveProperty("@stormeoio/consent");
    const server = read(target, "server/index.ts");
    expect(server).toContain("registry.register(authPlugin)");
    expect(server).toContain("registry.register(consentPlugin)");
    expect(server).toContain('requireAdmin: createDatabaseRoleGuard(db, "admin")');
  });

  it("keeps the generated server independent from auth when no auth plugin is selected", () => {
    const target = path.join(makeTemporaryDirectory(), "core-only");
    scaffold({ ...proofOptions, plugins: [] }, target);

    const server = read(target, "server/index.ts");
    expect(server).not.toContain("createDatabaseRoleGuard");
    expect(server).not.toContain("requireAdmin:");
  });

  it("makes Docker, server and Vite ports independently configurable", () => {
    const target = path.join(makeTemporaryDirectory(), "alpha");
    scaffold({ ...proofOptions, plugins: [...proofOptions.plugins, "@stormeoio/stripe"] }, target);

    const env = read(target, ".env.example");
    expect(env).toContain("COMPOSE_PROJECT_NAME=alpha");
    expect(env).toContain("POSTGRES_PORT=5432");
    expect(env).toContain("APP_ORIGIN=http://localhost:5173");
    expect(env).toContain("CLIENT_PORT=5173");

    const compose = read(target, "docker-compose.yml");
    expect(compose).toContain("name: ${COMPOSE_PROJECT_NAME:-alpha}");
    expect(compose).toContain("${POSTGRES_DB:-stormapp}");
    expect(compose).toContain("${POSTGRES_PORT:-5432}:5432");

    const vite = read(target, "vite.config.ts");
    expect(vite).toContain('env["CLIENT_PORT"]');
    expect(vite).toContain('env["PORT"]');
    expect(vite).toContain("strictPort: true");

    const server = read(target, "server/index.ts");
    expect(server).toContain('req.method === "POST" && req.path === "/api/stripe/webhook"');
    expect(server).toContain("return csrf.protect(req, res, next)");
  });
});
