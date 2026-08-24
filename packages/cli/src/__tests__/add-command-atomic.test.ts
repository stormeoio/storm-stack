import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as utils from "../utils";
import { addCommand } from "../commands/add";

const promptMocks = vi.hoisted(() => ({
  error: vi.fn(),
  spinnerMessage: vi.fn(),
  spinnerStart: vi.fn(),
  spinnerStop: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  log: {
    error: promptMocks.error,
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
  select: vi.fn(),
  spinner: () => ({
    message: promptMocks.spinnerMessage,
    start: promptMocks.spinnerStart,
    stop: promptMocks.spinnerStop,
  }),
}));

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof utils>();
  return {
    ...actual,
    detectPackageManager: vi.fn(() => "npm"),
    runInstall: vi.fn(),
  };
});

const temporaryDirectories: string[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");

const MUTATED_PROJECT_FILES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "server/index.ts",
  "drizzle.config.ts",
  "client/src/storm-components.ts",
  "client/src/App.tsx",
  "storm.json",
  "CLAUDE.md",
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.mocked(utils.runInstall).mockReset();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("storm add atomic server wiring", () => {
  it("does not copy files, update storm.json, or announce success when server injection fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "storm-add-atomic-"));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, "server"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "0.1.0" }));
    fs.writeFileSync(
      path.join(root, "storm.json"),
      JSON.stringify({
        version: 1,
        pluginsDir: "plugins",
        serverEntry: "server/index.ts",
        drizzleConfig: "drizzle.config.ts",
        registry: "",
        installed: [],
      }),
    );
    fs.writeFileSync(
      path.join(root, "server/index.ts"),
      `import { registry, bootstrapPlugins } from "@stormstack/core";\nasync function main() {\n  await bootstrapPlugins({ app, ctx: createContext(db) });\n}\n`,
    );

    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });

    let failure: unknown;
    try {
      await addCommand("auth", { copy: true, local: path.resolve(import.meta.dirname, "../../../.."), yes: true });
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(new Error("process.exit:1"));
    expect(JSON.parse(fs.readFileSync(path.join(root, "storm.json"), "utf8"))).toMatchObject({ installed: [] });
    expect(fs.existsSync(path.join(root, "plugins", "auth"))).toBe(false);
    expect(utils.runInstall).not.toHaveBeenCalled();
    expect(promptMocks.spinnerStop).not.toHaveBeenCalledWith(expect.stringContaining("installé"));
    expect(promptMocks.error).toHaveBeenCalledWith(expect.stringContaining("Impossible de trouver la base de données"));
  });

  it("restores every project file when the second plugin install fails late", async () => {
    const root = createCompleteProject();
    const before = snapshotProjectFiles(root);
    let installCount = 0;
    vi.mocked(utils.runInstall).mockImplementation((installRoot) => {
      installCount += 1;
      fs.writeFileSync(
        path.join(installRoot, "package.json"),
        JSON.stringify({ name: "mutated", installCount }),
      );
      for (const lockfile of [
        "package-lock.json",
        "npm-shrinkwrap.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "bun.lock",
        "bun.lockb",
      ]) {
        fs.writeFileSync(path.join(installRoot, lockfile), `mutated-${installCount}`);
      }
      if (installCount === 3) throw new Error("stripe dependency install failed");
    });
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });

    let failure: unknown;
    try {
      await addCommand("stripe", { copy: true, local: repositoryRoot, yes: true });
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(new Error("process.exit:1"));
    expect(installCount).toBe(3);
    expect(snapshotProjectFiles(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, "plugins/auth"))).toBe(false);
    expect(fs.existsSync(path.join(root, "plugins/stripe"))).toBe(false);
    expect(promptMocks.error).toHaveBeenCalledWith("stripe dependency install failed");
  });

  it("restores App root wiring when CLAUDE generation fails after consent injection", async () => {
    const root = createCompleteProject();
    write(root, "storm.json", JSON.stringify({
      version: 1,
      pluginsDir: "plugins",
      serverEntry: "server/index.ts",
      drizzleConfig: "drizzle.config.ts",
      registry: "",
      installed: ["@stormstack/auth"],
    }, null, 2));
    write(
      root,
      "server/index.ts",
      fs.readFileSync(path.join(root, "server/index.ts"), "utf8")
        .replace(
          'import { registry, bootstrapPlugins } from "@stormstack/core";',
          'import { registry, bootstrapPlugins } from "@stormstack/core";\nimport { authPlugin, createDatabaseRoleGuard } from "@stormstack/auth";',
        )
        .replace("async function main() {", "registry.register(authPlugin);\n\nasync function main() {")
        .replace(
          "await bootstrapPlugins({ app, ctx: { db: {} as any, env, logger: console } });",
          'await bootstrapPlugins({ app, ctx: { db: {} as any, env, logger: console }, requireAdmin: createDatabaseRoleGuard({} as any, "admin") });',
        ),
    );
    fs.rmSync(path.join(root, "CLAUDE.md"));
    write(root, "CLAUDE.md/sentinel.txt", "claude-directory-before\n");
    const textFiles = MUTATED_PROJECT_FILES.filter((file) => file !== "CLAUDE.md");
    const before = snapshotProjectFiles(root, textFiles);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });

    let failure: unknown;
    try {
      await addCommand("consent", { copy: true, local: repositoryRoot, yes: true });
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(new Error("process.exit:1"));
    expect(snapshotProjectFiles(root, textFiles)).toEqual(before);
    expect(fs.existsSync(path.join(root, "plugins/consent"))).toBe(false);
    expect(fs.statSync(path.join(root, "CLAUDE.md")).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(root, "CLAUDE.md/sentinel.txt"), "utf8"))
      .toBe("claude-directory-before\n");
  });

  it("rolls back Stripe when the raw webhook body cannot be configured", async () => {
    const root = createCompleteProject();
    configureAuthAsInstalled(root);
    write(
      root,
      "server/index.ts",
      fs.readFileSync(path.join(root, "server/index.ts"), "utf8")
        .replace("  app.use(express.json());\n", "  app.use(express.urlencoded({ extended: true }));\n"),
    );
    const before = snapshotProjectFiles(root);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });

    let failure: unknown;
    try {
      await addCommand("stripe", { copy: true, local: repositoryRoot, yes: true });
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(new Error("process.exit:1"));
    expect(snapshotProjectFiles(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, "plugins/stripe"))).toBe(false);
    expect(promptMocks.spinnerStop).not.toHaveBeenCalledWith(expect.stringContaining("installé"));
    expect(promptMocks.error).toHaveBeenCalledWith(expect.stringContaining("express.json"));
  });

  it("injects active Stripe raw-body wiring when matching snippets exist only in comments", async () => {
    const root = createCompleteProject();
    configureAuthAsInstalled(root);
    write(
      root,
      "server/index.ts",
      fs.readFileSync(path.join(root, "server/index.ts"), "utf8").replace(
        "  app.use(express.json());\n",
        `  /* Documentation only:
  request.originalUrl?.startsWith("/api/stripe/webhook");
  request.rawBody = Buffer.from(buf);
  */
  app.use(express.json());
`,
      ),
    );
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });

    await addCommand("stripe", { copy: true, local: repositoryRoot, yes: true });

    expect(exitSpy).not.toHaveBeenCalled();
    const server = fs.readFileSync(path.join(root, "server/index.ts"), "utf8");
    expect(server).toContain("app.use(express.json({");
    expect(server.match(/request\.rawBody\s*=\s*Buffer\.from\(buf\)/g)).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(path.join(root, "storm.json"), "utf8"))).toMatchObject({
      installed: ["@stormstack/auth", "@stormstack/stripe"],
    });
  });

  it("rolls back auth when its Drizzle schema cannot be configured", async () => {
    const root = createCompleteProject();
    write(root, "drizzle.config.ts", `export default { dialect: "postgresql" };\n`);
    const before = snapshotProjectFiles(root);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });

    let failure: unknown;
    try {
      await addCommand("auth", { copy: true, local: repositoryRoot, yes: true });
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(new Error("process.exit:1"));
    expect(snapshotProjectFiles(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, "plugins/auth"))).toBe(false);
    expect(promptMocks.spinnerStop).not.toHaveBeenCalledWith(expect.stringContaining("installé"));
    expect(promptMocks.error).toHaveBeenCalledWith(expect.stringContaining("Array schema"));
  });

  it("injects an active Drizzle schema reference when the same path exists only in comments", async () => {
    const root = createCompleteProject();
    write(root, "drizzle.config.ts", `export default {
  schema: [
    // "./plugins/auth/schema.ts",
    /* "./plugins/auth/schema.ts" */
  ],
};
`);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });

    await addCommand("auth", { copy: true, local: repositoryRoot, yes: true });

    expect(exitSpy).not.toHaveBeenCalled();
    const drizzle = fs.readFileSync(path.join(root, "drizzle.config.ts"), "utf8");
    const activeDrizzle = drizzle
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(activeDrizzle).toContain('"./plugins/auth/schema.ts"');
    expect(drizzle.match(/"\.\/plugins\/auth\/schema\.ts"/g)).toHaveLength(3);
  });

  it("rolls back auth when its only Drizzle schema property is commented out", async () => {
    const root = createCompleteProject();
    write(root, "drizzle.config.ts", `export default {
  // schema: ["./plugins/auth/schema.ts"],
  dialect: "postgresql",
};
`);
    const before = snapshotProjectFiles(root);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });

    let failure: unknown;
    try {
      await addCommand("auth", { copy: true, local: repositoryRoot, yes: true });
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(new Error("process.exit:1"));
    expect(snapshotProjectFiles(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, "plugins/auth"))).toBe(false);
    expect(promptMocks.spinnerStop).not.toHaveBeenCalledWith(expect.stringContaining("installé"));
    expect(promptMocks.error).toHaveBeenCalledWith(expect.stringContaining("Array schema"));
  });

  it("rolls back auth when the required client component map is missing", async () => {
    const root = createCompleteProject();
    fs.rmSync(path.join(root, "client/src/storm-components.ts"));
    const trackedFiles = MUTATED_PROJECT_FILES.filter(
      (file) => file !== "client/src/storm-components.ts",
    );
    const before = snapshotProjectFiles(root, trackedFiles);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });

    let failure: unknown;
    try {
      await addCommand("auth", { copy: true, local: repositoryRoot, yes: true });
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(new Error("process.exit:1"));
    expect(snapshotProjectFiles(root, trackedFiles)).toEqual(before);
    expect(fs.existsSync(path.join(root, "client/src/storm-components.ts"))).toBe(false);
    expect(fs.existsSync(path.join(root, "plugins/auth"))).toBe(false);
    expect(promptMocks.spinnerStop).not.toHaveBeenCalledWith(expect.stringContaining("installé"));
    expect(promptMocks.error).toHaveBeenCalledWith(expect.stringContaining("storm-components.ts introuvable"));
  });

  it("rolls back consent when the required App root marker is absent", async () => {
    const root = createCompleteProject();
    configureAuthAsInstalled(root);
    write(root, "client/src/App.tsx", `export default function App() { return <main />; }\n`);
    const before = snapshotProjectFiles(root);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });

    let failure: unknown;
    try {
      await addCommand("consent", { copy: true, local: repositoryRoot, yes: true });
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(new Error("process.exit:1"));
    expect(snapshotProjectFiles(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, "plugins/consent"))).toBe(false);
    expect(promptMocks.spinnerStop).not.toHaveBeenCalledWith(expect.stringContaining("installé"));
    expect(promptMocks.error).toHaveBeenCalledWith(expect.stringContaining("root-components absent"));
  });

  it("adds consent successfully when the client map and multiline App imports are valid", async () => {
    const root = createCompleteProject();
    configureAuthAsInstalled(root);
    write(root, "client/src/App.tsx", `import {
  StormLayout,
  StormRouter,
} from "@stormstack/react";

export default function App() {
  return <StormLayout appName="Test">
      <StormRouter />
      {/* storm:root-components */}
  </StormLayout>;
}
`);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });

    await addCommand("consent", { copy: true, local: repositoryRoot, yes: true });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(path.join(root, "storm.json"), "utf8"))).toMatchObject({
      installed: ["@stormstack/auth", "@stormstack/consent"],
    });
    expect(fs.existsSync(path.join(root, "plugins/consent/client/ConsentBanner.tsx"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8"))
      .toContain("storm:root-component @stormstack/consent:start");
    const spinnerStopMessage = promptMocks.spinnerStop.mock.calls.at(-1)?.[0];
    expect(String(spinnerStopMessage)).toContain("consent installé");
  });
});

function createCompleteProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "storm-add-atomic-"));
  temporaryDirectories.push(root);
  write(root, "package.json", JSON.stringify({ name: "fixture", version: "0.1.0" }));
  write(root, "package-lock.json", "package-lock-before");
  write(root, "npm-shrinkwrap.json", "shrinkwrap-before");
  write(root, "pnpm-lock.yaml", "pnpm-before");
  write(root, "yarn.lock", "yarn-before");
  write(root, "bun.lock", "bun-before");
  write(root, "bun.lockb", "bunb-before");
  write(root, "server/index.ts", `import "dotenv/config";
import express from "express";
import { registry, bootstrapPlugins } from "@stormstack/core";

async function main() {
  const app = express();
  app.use(express.json());
  await bootstrapPlugins({ app, ctx: { db: {} as any, env, logger: console } });
}
`);
  write(root, "drizzle.config.ts", `export default { schema: [] };\n`);
  write(root, "client/src/storm-components.ts", `export const STORM_COMPONENTS = {
};
`);
  write(root, "client/src/App.tsx", `export default function App() {
  return <main>
      {/* storm:root-components */}
  </main>;
}
`);
  write(root, "storm.json", JSON.stringify({
    version: 1,
    pluginsDir: "plugins",
    serverEntry: "server/index.ts",
    drizzleConfig: "drizzle.config.ts",
    registry: "",
    installed: [],
  }, null, 2));
  write(root, "CLAUDE.md", "claude-before\n");
  return root;
}

function configureAuthAsInstalled(root: string): void {
  write(root, "storm.json", JSON.stringify({
    version: 1,
    pluginsDir: "plugins",
    serverEntry: "server/index.ts",
    drizzleConfig: "drizzle.config.ts",
    registry: "",
    installed: ["@stormstack/auth"],
  }, null, 2));
  write(
    root,
    "server/index.ts",
    fs.readFileSync(path.join(root, "server/index.ts"), "utf8")
      .replace(
        'import { registry, bootstrapPlugins } from "@stormstack/core";',
        'import { registry, bootstrapPlugins } from "@stormstack/core";\nimport { authPlugin, createDatabaseRoleGuard } from "@stormstack/auth";',
      )
      .replace("async function main() {", "registry.register(authPlugin);\n\nasync function main() {")
      .replace(
        "await bootstrapPlugins({ app, ctx: { db: {} as any, env, logger: console } });",
        'await bootstrapPlugins({ app, ctx: { db: {} as any, env, logger: console }, requireAdmin: createDatabaseRoleGuard({} as any, "admin") });',
      ),
  );
}

function snapshotProjectFiles(
  root: string,
  files: readonly string[] = MUTATED_PROJECT_FILES,
): Record<string, string> {
  return Object.fromEntries(files.map((file) => [
    file,
    fs.readFileSync(path.join(root, file), "utf8"),
  ]));
}

function write(root: string, file: string, content: string): void {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}
