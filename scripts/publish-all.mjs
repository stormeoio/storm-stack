#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  npmRegistry,
  verifyPublishedPackageProvenance,
} from "./npm-provenance.mjs";
import { releasePackageDirs, readPackageJson, readRootPackageJson, rootDir } from "./release-packages.mjs";
import { assertStableReleaseVersion } from "./release-version.mjs";

export { npmRegistry };
const trustedGitHubRepository = "stormeoio/storm-stack";
const trustedPublishWorkflow = `${trustedGitHubRepository}/.github/workflows/publish.yml@`;
const setupNodeAuthPlaceholder = "XXXXX-XXXXX-XXXXX-XXXXX";

const allowedArguments = new Set([
  "--dry-run",
  "--help",
  "--live",
  "--no-provenance",
  "--provenance",
]);

export function parsePublishArguments(argv, env = process.env) {
  const unknownArguments = argv.filter((argument) => !allowedArguments.has(argument));
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown publish argument(s): ${unknownArguments.join(", ")}`);
  }

  const args = new Set(argv);
  if (args.has("--dry-run") && args.has("--live")) {
    throw new Error("Use either --dry-run or --live, not both.");
  }
  if (args.has("--provenance") && args.has("--no-provenance")) {
    throw new Error("Use either --provenance or --no-provenance, not both.");
  }

  const live = args.has("--live");
  if (live && !args.has("--provenance")) {
    throw new Error("Live publication requires the explicit --provenance flag.");
  }
  if (live && args.has("--no-provenance")) {
    throw new Error("Live publication cannot disable npm provenance.");
  }

  return {
    dryRun: !live,
    help: args.has("--help"),
    live,
    provenance:
      !args.has("--no-provenance")
      && (args.has("--provenance") || env.GITHUB_ACTIONS === "true"),
  };
}

export function runCommand(command, commandArgs, options = {}) {
  const capture = options.capture === true;
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? rootDir,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function commandOutput(result) {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function requireSuccessfulCommand(result, message) {
  if (result.status === 0) return;
  const output = commandOutput(result);
  throw new Error(output ? `${message}\n${output}` : message);
}

function readCommandOutput(command, commandArgs, options = {}) {
  const result = (options.run ?? runCommand)(command, commandArgs, {
    cwd: options.cwd,
    capture: true,
    env: options.env,
  });
  requireSuccessfulCommand(result, options.errorMessage ?? `${command} ${commandArgs.join(" ")} failed.`);
  return result.stdout.trim();
}

export function normalizeRepositoryUrl(repository) {
  const rawUrl = typeof repository === "string" ? repository : repository?.url;
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) return "";

  return rawUrl
    .trim()
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
}

function normalizeRepositoryDirectory(directory) {
  if (typeof directory !== "string") return "";
  return directory.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

export function assertPublishedPackageMatches(packageInfo, metadata, headCommit) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`${packageInfo.name}@${packageInfo.version} returned invalid npm metadata.`);
  }
  if (metadata.name !== packageInfo.name || metadata.version !== packageInfo.version) {
    throw new Error(
      `${packageInfo.name}@${packageInfo.version} npm identity does not match the requested package.`,
    );
  }
  if (metadata.gitHead !== headCommit) {
    throw new Error(
      `${packageInfo.name}@${packageInfo.version} already exists with gitHead ${metadata.gitHead ?? "missing"}; expected ${headCommit}.`,
    );
  }

  const expectedRepositoryUrl = normalizeRepositoryUrl(packageInfo.repository);
  const actualRepositoryUrl = normalizeRepositoryUrl(metadata.repository);
  if (!expectedRepositoryUrl || actualRepositoryUrl !== expectedRepositoryUrl) {
    throw new Error(
      `${packageInfo.name}@${packageInfo.version} repository URL ${actualRepositoryUrl || "missing"} does not match ${expectedRepositoryUrl || "the manifest"}.`,
    );
  }

  const expectedDirectory = normalizeRepositoryDirectory(packageInfo.repository?.directory);
  const actualDirectory = normalizeRepositoryDirectory(metadata.repository?.directory);
  if (actualDirectory !== expectedDirectory) {
    throw new Error(
      `${packageInfo.name}@${packageInfo.version} repository directory ${actualDirectory || "missing"} does not match ${expectedDirectory || "the manifest"}.`,
    );
  }
}

export function isNpmNotFound(result) {
  return /(?:^|\s)E404(?:\s|$)/m.test(commandOutput(result));
}

export async function lookupPublishedPackage(packageInfo, context, options = {}) {
  const run = options.run ?? runCommand;
  const packageSpec = `${packageInfo.name}@${packageInfo.version}`;
  const result = run(
    "npm",
    [
      "view",
      packageSpec,
      "name",
      "version",
      "gitHead",
      "repository",
      "dist.attestations",
      "dist.integrity",
      "--json",
      `--registry=${npmRegistry}`,
    ],
    { capture: true },
  );

  if (result.status !== 0) {
    if (isNpmNotFound(result)) return { exists: false };
    requireSuccessfulCommand(
      result,
      `npm registry lookup failed for ${packageSpec}; refusing to publish a partial release train.`,
    );
  }

  let metadata;
  try {
    metadata = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${packageSpec} returned malformed JSON from npm; refusing to publish.`);
  }

  assertPublishedPackageMatches(packageInfo, metadata, context.headCommit);
  await verifyPublishedPackageProvenance(packageInfo, metadata, context, {
    fetchImpl: options.fetchImpl,
    verifyBundle: options.verifyBundle,
  });
  return { exists: true, metadata };
}

export async function preflightPublishedPackages(packages, context, options = {}) {
  const states = new Map();
  for (const packageInfo of packages) {
    states.set(
      packageInfo.name,
      await lookupPublishedPackage(packageInfo, context, options),
    );
  }
  return states;
}

export function assertLiveReleaseContext(rootVersion, options = {}) {
  const env = options.env ?? process.env;
  const run = options.run ?? runCommand;

  if (env.GITHUB_ACTIONS !== "true") {
    throw new Error("Live publication is restricted to the GitHub Actions publish workflow.");
  }
  const expectedTagRef = `refs/tags/v${rootVersion}`;
  if (env.GITHUB_REF !== expectedTagRef) {
    throw new Error("Live publication requires the exact release tag Git ref.");
  }
  if (
    env.GITHUB_REPOSITORY !== trustedGitHubRepository
    || env.GITHUB_WORKFLOW_REF !== `${trustedPublishWorkflow}${expectedTagRef}`
  ) {
    throw new Error("Live publication is restricted to the trusted stormeoio/storm-stack publish workflow.");
  }
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error("Live publication requires GitHub OIDC credentials for npm trusted publishing.");
  }
  if (
    env.NPM_TOKEN
    || (env.NODE_AUTH_TOKEN && env.NODE_AUTH_TOKEN !== setupNodeAuthPlaceholder)
  ) {
    throw new Error("Live publication must use npm trusted publishing without an exposed npm token.");
  }

  const status = run("git", ["status", "--porcelain", "--untracked-files=all"], {
    capture: true,
  });
  requireSuccessfulCommand(status, "Unable to inspect the Git working tree before publication.");
  if (status.stdout.trim().length > 0) {
    throw new Error("Refusing live publication from a dirty Git working tree.");
  }

  const headCommit = readCommandOutput("git", ["rev-parse", "--verify", "HEAD"], {
    run,
    errorMessage: "Unable to resolve the release HEAD commit.",
  });
  const tagCommit = readCommandOutput(
    "git",
    ["rev-parse", "--verify", "--end-of-options", `${expectedTagRef}^{commit}`],
    {
      run,
      errorMessage: `The exact release tag v${rootVersion} does not exist.`,
    },
  );
  if (tagCommit !== headCommit) {
    throw new Error(`The exact release tag v${rootVersion} does not point to HEAD ${headCommit}.`);
  }

  const fetchResult = run(
    "git",
    [
      "fetch",
      "--no-tags",
      "--force",
      "origin",
      "refs/heads/main:refs/remotes/origin/main",
    ],
    { capture: true },
  );
  requireSuccessfulCommand(fetchResult, "Unable to refresh origin/main before publication.");

  const ancestry = run(
    "git",
    ["merge-base", "--is-ancestor", headCommit, "refs/remotes/origin/main"],
    { capture: true },
  );
  if (ancestry.status !== 0) {
    throw new Error(`Release HEAD ${headCommit} is not contained in origin/main.`);
  }

  return {
    headCommit,
    workflowRef: env.GITHUB_WORKFLOW_REF,
  };
}

function resolveReleasePackages(rootVersion) {
  return releasePackageDirs.map((packageDir) => {
    const manifest = readPackageJson(packageDir);
    if (manifest.version !== rootVersion) {
      throw new Error(`${packageDir} is v${manifest.version}, expected v${rootVersion}`);
    }
    return {
      dir: packageDir,
      name: manifest.name,
      repository: manifest.repository,
      version: manifest.version,
    };
  });
}

export async function publishAll(argv = process.argv.slice(2), options = {}) {
  const env = options.env ?? process.env;
  const run = options.run ?? runCommand;
  const parsed = parsePublishArguments(argv, env);

  if (parsed.help) {
    console.log("Usage: node scripts/publish-all.mjs [--dry-run|--live] [--provenance|--no-provenance]");
    return;
  }

  const rootVersion = assertStableReleaseVersion(readRootPackageJson().version);
  const packages = resolveReleasePackages(rootVersion);
  const liveContext = parsed.live
    ? assertLiveReleaseContext(rootVersion, { env, run })
    : undefined;
  const publishedPackageStates = parsed.live
    ? await preflightPublishedPackages(packages, liveContext, {
      fetchImpl: options.fetchImpl,
      run,
      verifyBundle: options.verifyBundle,
    })
    : new Map();

  let failed = 0;
  let published = 0;
  let skipped = 0;
  let dryRunPublished = 0;

  console.log(`Publishing v${rootVersion} (${parsed.dryRun ? "DRY RUN" : "LIVE"})`);
  console.log("");

  for (const packageInfo of packages) {
    console.log(`--- ${packageInfo.name} ---`);

    if (publishedPackageStates.get(packageInfo.name)?.exists) {
      console.log(`${packageInfo.name}@${packageInfo.version} already exists with matching release provenance, skipping.`);
      skipped += 1;
      console.log("");
      continue;
    }

    const publishArgs = ["publish", "--access", "public"];
    if (parsed.dryRun) publishArgs.push("--dry-run");
    if (parsed.provenance) publishArgs.push("--provenance");

    const result = run("npm", publishArgs, {
      cwd: join(rootDir, packageInfo.dir),
      capture: false,
    });

    if (result.status === 0) {
      if (parsed.dryRun) dryRunPublished += 1;
      else published += 1;
    } else {
      console.error(`::error::${packageInfo.name} publish failed`);
      failed += 1;
    }

    console.log("");
  }

  console.log(
    `Published ${published} packages, dry-ran ${dryRunPublished} packages, skipped ${skipped} verified packages, failed ${failed} packages`,
  );

  if (failed > 0) {
    throw new Error(`npm publication failed for ${failed} package${failed === 1 ? "" : "s"}.`);
  }
}

async function main() {
  try {
    await publishAll();
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  main();
}
