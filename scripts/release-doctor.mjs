#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

const publishWorkflowPath = join(rootDir, ".github/workflows/publish.yml");
const publishWorkflow = existsSync(publishWorkflowPath)
  ? readFileSync(publishWorkflowPath, "utf8")
  : "";
const trustedPublishingConfigured =
  publishWorkflow.includes("id-token: write")
  && publishWorkflow.includes('node-version: "22.14.0"')
  && publishWorkflow.includes("npm install --global npm@11.5.1")
  && !publishWorkflow.includes("NODE_AUTH_TOKEN")
  && !publishWorkflow.includes("NPM_TOKEN");
addCheck(
  "npm trusted publishing",
  trustedPublishingConfigured,
  trustedPublishingConfigured
    ? "GitHub OIDC publishing uses Node.js 22.14.0 and npm 11.5.1 without a long-lived npm token."
    : "The publish workflow is missing the required tokenless npm trusted-publishing configuration.",
  "Configure id-token: write, Node.js 22.14.0, npm 11.5.1, and remove npm token environment variables from the live job.",
);

if (process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN) {
  addWarning(
    "Legacy npm credential",
    "NPM_TOKEN or NODE_AUTH_TOKEN is set locally but is not used by the trusted publish workflow.",
    "Remove the legacy credential after the OIDC release path has been verified.",
  );
}

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
