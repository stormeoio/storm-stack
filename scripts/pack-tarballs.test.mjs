// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertDestinationOutsideWorktree,
  assertRepositoryClean,
  findLocalDependencyReferences,
  packTarballs,
  parsePackArguments,
  resolveGitProvenance,
} from "./pack-tarballs.mjs";

const temporaryDirectories = [];

function createTemporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
}

function write(path, content) {
  writeFileSync(path, content, "utf8");
}

function createCommittedRepository() {
  const repository = createTemporaryDirectory("stormstack-pack-test-repo-");
  run("git", ["init", "--quiet"], repository);
  run("git", ["config", "user.email", "pack-tests@stormstack.local"], repository);
  run("git", ["config", "user.name", "Storm Stack tests"], repository);
  write(join(repository, "tracked.txt"), "tracked\n");
  run("git", ["add", "tracked.txt"], repository);
  run("git", ["commit", "--quiet", "-m", "test: initial"], repository);
  return repository;
}

function createPackableRepository() {
  const repository = createTemporaryDirectory("stormstack-pack-integration-repo-");
  mkdirSync(join(repository, "packages", "demo"), { recursive: true });
  mkdirSync(join(repository, "scripts"), { recursive: true });
  run("git", ["init", "--quiet"], repository);
  run("git", ["config", "user.email", "pack-tests@stormstack.local"], repository);
  run("git", ["config", "user.name", "Storm Stack tests"], repository);

  write(
    join(repository, "package.json"),
    `${JSON.stringify(
      {
        name: "pack-integration-fixture",
        version: "1.2.3",
        private: true,
        workspaces: ["packages/*"],
        scripts: { build: "npm run build --workspaces --if-present" },
      },
      null,
      2,
    )}\n`,
  );
  write(join(repository, ".gitignore"), "node_modules/\ndist/\n*.tgz\n");
  write(
    join(repository, "scripts", "release-packages.mjs"),
    'export const releasePackageDirs = ["packages/demo"];\n',
  );
  write(
    join(repository, "packages", "demo", "package.json"),
    `${JSON.stringify(
      {
        name: "@stormstack/demo",
        version: "1.2.3",
        type: "module",
        files: ["dist"],
        main: "./dist/index.js",
        scripts: { build: "node build.mjs" },
      },
      null,
      2,
    )}\n`,
  );
  write(
    join(repository, "packages", "demo", "build.mjs"),
    'import { mkdirSync, writeFileSync } from "node:fs";\n' +
      'mkdirSync(new URL("./dist", import.meta.url), { recursive: true });\n' +
      'writeFileSync(new URL("./dist/index.js", import.meta.url), "fresh build\\n");\n',
  );
  run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], repository);
  run("git", ["add", "."], repository);
  run("git", ["commit", "--quiet", "-m", "test: pack fixture"], repository);

  const ignoredDist = join(repository, "packages", "demo", "dist");
  mkdirSync(ignoredDist, { recursive: true });
  write(join(ignoredDist, "index.js"), "stale ignored build\n");
  return repository;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("parsePackArguments", () => {
  it("parses a ref and keeps repeated workspaces", () => {
    expect(
      parsePackArguments([
        "--destination",
        "/tmp/packs",
        "--ref",
        "proof/consent-v0.1.0",
        "--workspace",
        "@stormstack/core",
        "--workspace",
        "packages/plugin-auth",
      ]),
    ).toEqual({
      destination: "/tmp/packs",
      workspaces: ["@stormstack/core", "packages/plugin-auth"],
      ref: "proof/consent-v0.1.0",
      help: false,
    });
  });

  it("defaults the immutable source to HEAD", () => {
    expect(parsePackArguments(["--destination", "/tmp/packs"]).ref).toBe("HEAD");
  });

  it("rejects unknown arguments and missing values", () => {
    expect(() => parsePackArguments(["--unknown"])).toThrow("Unknown argument");
    expect(() => parsePackArguments(["--destination"])).toThrow("requires a directory");
    expect(() => parsePackArguments(["--workspace", "--help"])).toThrow("requires a package");
    expect(() => parsePackArguments(["--ref"])).toThrow("requires a Git ref");
  });
});

describe("findLocalDependencyReferences", () => {
  it("reports every local protocol and filesystem path", () => {
    expect(
      findLocalDependencyReferences({
        dependencies: {
          workspace: "workspace:*",
          file: "file:../file-package",
          link: "link:../linked-package",
          relative: "../relative-package",
        },
        devDependencies: { dotRelative: "./tooling/package" },
        peerDependencies: { unixAbsolute: "/opt/private/package" },
        optionalDependencies: { windowsAbsolute: "C:\\private\\package" },
      }),
    ).toEqual([
      "dependencies.workspace=workspace:*",
      "dependencies.file=file:../file-package",
      "dependencies.link=link:../linked-package",
      "dependencies.relative=../relative-package",
      "devDependencies.dotRelative=./tooling/package",
      "peerDependencies.unixAbsolute=/opt/private/package",
      "optionalDependencies.windowsAbsolute=C:\\private\\package",
    ]);
  });

  it("accepts registry, npm alias, URL and Git dependency ranges", () => {
    expect(
      findLocalDependencyReferences({
        dependencies: {
          zod: "^3.22.0",
          alias: "npm:zod@^3.22.0",
          archive: "https://registry.example.test/package.tgz",
          git: "git+https://example.test/package.git#v1.0.0",
        },
      }),
    ).toEqual([]);
  });
});

describe("Git provenance and isolation", () => {
  it("resolves the requested ref to immutable commit and tree hashes", () => {
    const repository = createCommittedRepository();
    run("git", ["tag", "proof-baseline"], repository);
    const expectedCommit = run("git", ["rev-parse", "HEAD"], repository);
    const expectedTree = run("git", ["rev-parse", "HEAD^{tree}"], repository);

    expect(resolveGitProvenance(repository, "proof-baseline")).toEqual({
      requestedRef: "proof-baseline",
      commit: expectedCommit,
      tree: expectedTree,
    });
  });

  it("rejects tracked and untracked dirty files", () => {
    const repository = createCommittedRepository();
    write(join(repository, "tracked.txt"), "modified\n");
    write(join(repository, "untracked.txt"), "untracked\n");
    expect(() => assertRepositoryClean(repository)).toThrow("dirty repository");
  });

  it("requires the output destination to be outside the detached worktree", () => {
    expect(() =>
      assertDestinationOutsideWorktree("/tmp/proof/source/output", "/tmp/proof/source"),
    ).toThrow("outside the detached worktree");
    expect(() =>
      assertDestinationOutsideWorktree("/tmp/proof/artifacts", "/tmp/proof/source"),
    ).not.toThrow();
  });
});

describe("packTarballs integration", () => {
  it("packs a fresh build from a detached ref and records provenance", async () => {
    const repository = createPackableRepository();
    const destination = createTemporaryDirectory("stormstack-pack-integration-output-");
    const expectedCommit = run("git", ["rev-parse", "HEAD"], repository);
    const expectedTree = run("git", ["rev-parse", "HEAD^{tree}"], repository);

    const result = await packTarballs({
      destination,
      ref: "HEAD",
      workspaces: ["@stormstack/demo"],
      repositoryRoot: repository,
    });

    expect(result.manifest).toMatchObject({
      schemaVersion: 2,
      requestedRef: "HEAD",
      commit: expectedCommit,
      tree: expectedTree,
      dirty: false,
      rootVersion: "1.2.3",
      artifacts: [
        {
          name: "@stormstack/demo",
          version: "1.2.3",
          workspace: "packages/demo",
        },
      ],
    });
    expect(result.manifest.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);

    const tarballPath = join(destination, result.manifest.artifacts[0].filename);
    expect(run("tar", ["-xOf", tarballPath, "package/dist/index.js"], repository)).toBe(
      "fresh build",
    );
    expect(readFileSync(result.manifestPath, "utf8")).toContain(expectedTree);
    expect(run("git", ["worktree", "list", "--porcelain"], repository)).not.toContain(
      "stormstack-pack-worktree-",
    );
  }, 30_000);
});
