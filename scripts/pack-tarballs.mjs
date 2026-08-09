#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptRootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryDirectoryPrefix = "stormstack-pack-worktree-";
const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

export function parsePackArguments(argv) {
  const options = {
    destination: "",
    workspaces: [],
    ref: "HEAD",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "--destination") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--destination requires a directory path.");
      }
      options.destination = value;
      index += 1;
      continue;
    }
    if (argument === "--workspace") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--workspace requires a package name or workspace path.");
      }
      options.workspaces.push(value);
      index += 1;
      continue;
    }
    if (argument === "--ref") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--ref requires a Git ref.");
      }
      options.ref = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function isLocalDependencySpecifier(range) {
  const value = range.trim();
  const lowerValue = value.toLowerCase();
  if (
    lowerValue.startsWith("workspace:") ||
    lowerValue.startsWith("file:") ||
    lowerValue.startsWith("link:")
  ) {
    return true;
  }
  if (
    value === "." ||
    value === ".." ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\") ||
    value.startsWith("~/") ||
    value.startsWith("~\\")
  ) {
    return true;
  }
  return isAbsolute(value) || win32.isAbsolute(value);
}

export function findLocalDependencyReferences(manifest) {
  const references = [];
  for (const section of dependencySections) {
    const dependencies = manifest[section];
    if (!dependencies || typeof dependencies !== "object") {
      continue;
    }
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range === "string" && isLocalDependencySpecifier(range)) {
        references.push(`${section}.${name}=${range}`);
      }
    }
  }
  return references;
}

export function findWorkspaceReferences(manifest) {
  return findLocalDependencyReferences(manifest).filter((reference) =>
    reference.toLowerCase().includes("=workspace:"),
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? scriptRootDir,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${output}`);
  }
  return result.stdout;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readPackedManifest(tarballPath) {
  const output = run("tar", ["-xOf", tarballPath, "package/package.json"]);
  return JSON.parse(output);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function resolveGitProvenance(repositoryRoot, requestedRef = "HEAD") {
  const commit = run(
    "git",
    ["rev-parse", "--verify", "--end-of-options", `${requestedRef}^{commit}`],
    { cwd: repositoryRoot },
  ).trim();
  const tree = run(
    "git",
    ["rev-parse", "--verify", "--end-of-options", `${commit}^{tree}`],
    { cwd: repositoryRoot },
  ).trim();
  return { requestedRef, commit, tree };
}

export function assertRepositoryClean(repositoryRoot) {
  const dirtyEntries = run(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: repositoryRoot },
  ).trim();
  if (dirtyEntries.length > 0) {
    const preview = dirtyEntries.split("\n").slice(0, 10).join("\n");
    throw new Error(
      `Refusing to pack from a dirty repository. Commit or stash changes first:\n${preview}`,
    );
  }
}

export function assertDestinationOutsideWorktree(destination, worktreeDirectory) {
  const relativePath = relative(resolve(worktreeDirectory), resolve(destination));
  if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== "..")) {
    throw new Error("The pack destination must be outside the detached worktree.");
  }
}

function assertBoundedTemporaryDirectory(path) {
  const resolvedPath = resolve(path);
  if (
    dirname(resolvedPath) !== resolve(tmpdir()) ||
    !basename(resolvedPath).startsWith(temporaryDirectoryPrefix)
  ) {
    throw new Error(`Refusing to clean an unbounded temporary directory: ${resolvedPath}`);
  }
}

async function loadReleasePackageDirs(worktreeDirectory, commit) {
  const catalogPath = resolve(worktreeDirectory, "scripts/release-packages.mjs");
  if (!existsSync(catalogPath)) {
    throw new Error(`Release catalog does not exist at ${commit}: scripts/release-packages.mjs`);
  }
  const moduleUrl = `${pathToFileURL(catalogPath).href}?commit=${commit}`;
  const catalog = await import(moduleUrl);
  if (!Array.isArray(catalog.releasePackageDirs)) {
    throw new Error(`Invalid release catalog at ${commit}: releasePackageDirs is not an array.`);
  }
  return catalog.releasePackageDirs;
}

function resolvePackages(worktreeDirectory, releasePackageDirs, workspaceFilters) {
  const packages = releasePackageDirs.map((directory) => ({
    directory,
    manifest: readJson(resolve(worktreeDirectory, directory, "package.json")),
  }));
  if (workspaceFilters.length === 0) {
    return packages;
  }

  const selected = packages.filter(({ directory, manifest }) =>
    workspaceFilters.includes(directory) || workspaceFilters.includes(manifest.name),
  );
  const found = new Set(selected.flatMap(({ directory, manifest }) => [directory, manifest.name]));
  const missing = workspaceFilters.filter((filter) => !found.has(filter));
  if (missing.length > 0) {
    throw new Error(`Unknown release workspace(s): ${missing.join(", ")}`);
  }
  return selected;
}

function assertNoLocalDependencies(manifest, label) {
  const localReferences = findLocalDependencyReferences(manifest);
  if (localReferences.length > 0) {
    throw new Error(`${label} contains local dependency references: ${localReferences.join(", ")}`);
  }
}

function createTemporaryRoot() {
  const path = mkdtempSync(join(tmpdir(), temporaryDirectoryPrefix));
  assertBoundedTemporaryDirectory(path);
  return path;
}

function cleanTemporaryRoot(repositoryRoot, temporaryRoot, worktreeAdded) {
  assertBoundedTemporaryDirectory(temporaryRoot);
  let cleanupError;
  if (worktreeAdded) {
    try {
      run("git", ["worktree", "remove", "--force", join(temporaryRoot, "source")], {
        cwd: repositoryRoot,
      });
    } catch (error) {
      cleanupError = error;
    }
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
  if (cleanupError) {
    try {
      run("git", ["worktree", "prune"], { cwd: repositoryRoot });
    } catch {
      // The bounded temporary directory is gone; preserve the original cleanup failure.
    }
    throw cleanupError;
  }
}

export async function packTarballs(options) {
  if (!options.destination) {
    throw new Error("--destination is required.");
  }

  const repositoryRoot = resolve(options.repositoryRoot ?? scriptRootDir);
  const destination = resolve(options.destination);
  const requestedRef = options.ref || "HEAD";

  assertRepositoryClean(repositoryRoot);
  const provenance = resolveGitProvenance(repositoryRoot, requestedRef);
  const temporaryRoot = createTemporaryRoot();
  const worktreeDirectory = join(temporaryRoot, "source");
  const stagingDestination = join(temporaryRoot, "artifacts");
  let worktreeAdded = false;

  try {
    assertDestinationOutsideWorktree(destination, worktreeDirectory);
    run(
      "git",
      ["worktree", "add", "--detach", worktreeDirectory, provenance.commit],
      { cwd: repositoryRoot },
    );
    worktreeAdded = true;

    const checkedOutCommit = run("git", ["rev-parse", "HEAD"], {
      cwd: worktreeDirectory,
    }).trim();
    if (checkedOutCommit !== provenance.commit) {
      throw new Error(
        `Detached worktree resolved to ${checkedOutCommit}, expected ${provenance.commit}.`,
      );
    }
    assertRepositoryClean(worktreeDirectory);

    const releasePackageDirs = await loadReleasePackageDirs(
      worktreeDirectory,
      provenance.commit,
    );
    const packages = resolvePackages(
      worktreeDirectory,
      releasePackageDirs,
      options.workspaces ?? [],
    );
    const rootVersion = readJson(resolve(worktreeDirectory, "package.json")).version;

    for (const { manifest } of packages) {
      if (manifest.version !== rootVersion) {
        throw new Error(`${manifest.name}@${manifest.version} does not match root ${rootVersion}.`);
      }
      assertNoLocalDependencies(manifest, `${manifest.name} source manifest`);
    }

    run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: worktreeDirectory,
    });
    run("npm", ["run", "build"], {
      cwd: worktreeDirectory,
      env: { ...process.env, CI: "1" },
    });

    mkdirSync(stagingDestination, { recursive: true });
    const artifacts = [];
    for (const { directory, manifest } of packages) {
      const stdout = run(
        "npm",
        [
          "pack",
          "--json",
          "--pack-destination",
          stagingDestination,
          "--workspace",
          directory,
        ],
        { cwd: worktreeDirectory },
      );
      const payload = JSON.parse(stdout);
      const packed = Array.isArray(payload) ? payload[0] : payload;
      if (!packed?.filename) {
        throw new Error(`npm pack returned no filename for ${manifest.name}.`);
      }

      const tarballPath = resolve(stagingDestination, packed.filename);
      if (!existsSync(tarballPath)) {
        throw new Error(`Missing tarball after npm pack: ${tarballPath}`);
      }
      if (manifest.files?.includes("dist")) {
        const containsDist = packed.files?.some((file) => file.path?.startsWith("dist/"));
        if (!containsDist) {
          throw new Error(`${manifest.name} tarball contains no freshly built dist/ artifact.`);
        }
      }

      const packedManifest = readPackedManifest(tarballPath);
      assertNoLocalDependencies(packedManifest, `${manifest.name} packed manifest`);
      if (packedManifest.version !== rootVersion) {
        throw new Error(
          `${packedManifest.name}@${packedManifest.version} does not match root ${rootVersion}.`,
        );
      }

      artifacts.push({
        name: packedManifest.name,
        version: packedManifest.version,
        workspace: directory,
        filename: basename(tarballPath),
        sha256: sha256(tarballPath),
        size: packed.size,
        integrity: packed.integrity,
      });
    }

    const proofManifest = {
      schemaVersion: 2,
      createdAt: new Date().toISOString(),
      requestedRef: provenance.requestedRef,
      commit: provenance.commit,
      tree: provenance.tree,
      dirty: false,
      rootVersion,
      artifacts,
    };

    mkdirSync(destination, { recursive: true });
    for (const artifact of artifacts) {
      copyFileSync(
        resolve(stagingDestination, artifact.filename),
        resolve(destination, artifact.filename),
      );
    }
    const manifestPath = resolve(destination, "tarballs-manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(proofManifest, null, 2)}\n`, "utf8");
    return { manifestPath, manifest: proofManifest };
  } finally {
    cleanTemporaryRoot(repositoryRoot, temporaryRoot, worktreeAdded);
  }
}

async function main() {
  const options = parsePackArguments(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: npm run pack:tarballs -- --destination <dir> [--ref <git-ref>] " +
        "[--workspace <name-or-path>]",
    );
    return;
  }
  const result = await packTarballs(options);
  console.log(`Packed ${result.manifest.artifacts.length} package(s).`);
  console.log(result.manifestPath);
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
