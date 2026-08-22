#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { readPackageJson, readRootPackageJson, releasePackageDirs, rootDir } from "./release-packages.mjs";

const checks = [];
const warnings = [];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    ok: result.status === 0,
    output: (result.stdout || result.stderr).trim(),
  };
}

function addCheck(name, ok, detail, fix) {
  checks.push({ name, ok, detail, fix });
}

function addWarning(name, detail, fix) {
  warnings.push({ name, detail, fix });
}

function parseVersion(version) {
  return version.split(".").map((part) => Number.parseInt(part, 10));
}

function isAtLeast(version, minimum) {
  const currentParts = parseVersion(version);
  const minimumParts = parseVersion(minimum);

  for (let index = 0; index < minimumParts.length; index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (currentPart > minimumPart) {
      return true;
    }
    if (currentPart < minimumPart) {
      return false;
    }
  }

  return true;
}

const nodeVersion = process.versions.node;
addCheck("Node.js runtime", isAtLeast(nodeVersion, "20.19.0"), `Detected ${nodeVersion}; expected >=20.19.0.`, "Run nvm use.");

const npmVersion = run("npm", ["--version"]);
addCheck("npm runtime", npmVersion.ok && isAtLeast(npmVersion.output, "10.0.0"), `Detected ${npmVersion.output || "none"}; expected >=10.0.0.`, "Install npm 10+.");

const status = run("git", ["status", "--porcelain"]);
addCheck("Git working tree", status.ok && status.output.length === 0, status.output || "Working tree is clean.", "Commit or stash local changes before tagging.");

const remote = run("git", ["remote", "get-url", "origin"]);
addCheck("GitHub origin remote", remote.ok && remote.output.length > 0, remote.output || "No origin remote configured.", "Add the stormeoio/storm-stack GitHub remote.");

const branch = run("git", ["branch", "--show-current"]);
if (branch.ok && branch.output !== "main") {
  addWarning("Current branch", `Current branch is ${branch.output}.`, "Release tags should be created from main.");
}

const npmTokenPresent = Boolean(process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN);
const npmIdentity = run("npm", ["whoami", "--registry=https://registry.npmjs.org/"]);
const npmAuthenticationOk = npmIdentity.ok && npmIdentity.output.length > 0;
let npmAuthenticationDetail;
if (npmAuthenticationOk) {
  npmAuthenticationDetail = `Authenticated to npm as ${npmIdentity.output}.`;
} else if (npmTokenPresent) {
  npmAuthenticationDetail = "npm whoami rejected the configured credential.";
} else {
  npmAuthenticationDetail = "npm whoami could not authenticate this shell.";
}
addCheck(
  "npm authentication",
  npmAuthenticationOk,
  npmAuthenticationDetail,
  "Authenticate with npm login or configure a valid npm automation token, then verify it with npm whoami.",
);

const rootVersion = readRootPackageJson().version;
const versionMismatches = releasePackageDirs.flatMap((packageDir) => {
  const manifest = readPackageJson(packageDir);
  return manifest.version === rootVersion ? [] : [`${manifest.name}@${manifest.version}`];
});
addCheck("Release package versions", versionMismatches.length === 0, versionMismatches.length === 0 ? `All release packages are aligned at ${rootVersion}.` : `Mismatches: ${versionMismatches.join(", ")}.`, "Run npm run version:sync.");

const missingWorkflows = [".github/workflows/release.yml", ".github/workflows/publish.yml"].filter(
  (workflowPath) => !existsSync(join(rootDir, workflowPath)),
);
addCheck("Release workflows", missingWorkflows.length === 0, missingWorkflows.length === 0 ? "Release and publish workflows are present." : `Missing: ${missingWorkflows.join(", ")}.`, "Restore the GitHub release workflows.");

console.log("Storm Stack release doctor");
console.log("");

for (const check of checks) {
  console.log(`${check.ok ? "[ok]" : "[fail]"} ${check.name}`);
  console.log(`  ${check.detail}`);
  if (!check.ok) {
    console.log(`  Fix: ${check.fix}`);
  }
}

for (const warning of warnings) {
  console.log(`[warn] ${warning.name}`);
  console.log(`  ${warning.detail}`);
  console.log(`  Note: ${warning.fix}`);
}

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  console.error("");
  console.error(`Release doctor failed (${failed.length} issue${failed.length === 1 ? "" : "s"}).`);
  process.exit(1);
}

console.log("");
console.log("Release doctor passed.");
