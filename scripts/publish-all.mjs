#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { releasePackageDirs, readPackageJson, readRootPackageJson, rootDir } from "./release-packages.mjs";

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log("Usage: node scripts/publish-all.mjs [--dry-run|--live] [--provenance|--no-provenance]");
  process.exit(0);
}

if (args.has("--dry-run") && args.has("--live")) {
  console.error("Use either --dry-run or --live, not both.");
  process.exit(1);
}

const live = args.has("--live");
const dryRun = !live;
const provenance =
  !args.has("--no-provenance") && (args.has("--provenance") || process.env.GITHUB_ACTIONS === "true");

if (live && !process.env.NPM_TOKEN && !process.env.NODE_AUTH_TOKEN) {
  console.error("Live publish requires NPM_TOKEN or NODE_AUTH_TOKEN.");
  console.error("Set the npm automation token before running publish:all or the GitHub publish workflow.");
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? rootDir,
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
  });

  return result.status ?? 1;
}

function isAlreadyPublished(packageName, version) {
  return (
    run("npm", ["view", `${packageName}@${version}`, "version"], {
      stdio: "ignore",
    }) === 0
  );
}

const rootVersion = readRootPackageJson().version;
const packages = releasePackageDirs.map((packageDir) => {
  const manifest = readPackageJson(packageDir);
  if (manifest.version !== rootVersion) {
    throw new Error(`${packageDir} is v${manifest.version}, expected v${rootVersion}`);
  }
  return {
    dir: packageDir,
    name: manifest.name,
    version: manifest.version,
  };
});

let failed = 0;
let published = 0;
let skipped = 0;
let dryRunPublished = 0;

console.log(`Publishing v${rootVersion} (${dryRun ? "DRY RUN" : "LIVE"})`);
console.log("");

for (const packageInfo of packages) {
  console.log(`--- ${packageInfo.name} ---`);

  if (live && isAlreadyPublished(packageInfo.name, packageInfo.version)) {
    console.log(`${packageInfo.name}@${packageInfo.version} already exists on npm, skipping.`);
    skipped += 1;
    console.log("");
    continue;
  }

  const publishArgs = ["publish", "--access", "public"];
  if (dryRun) {
    publishArgs.push("--dry-run");
  }
  if (provenance) {
    publishArgs.push("--provenance");
  }

  const status = run("npm", publishArgs, {
    cwd: join(rootDir, packageInfo.dir),
  });

  if (status === 0) {
    if (dryRun) {
      dryRunPublished += 1;
    } else {
      published += 1;
    }
  } else {
    console.error(`::error::${packageInfo.name} publish failed`);
    failed += 1;
  }

  console.log("");
}

console.log(
  `Published ${published} packages, dry-ran ${dryRunPublished} packages, skipped ${skipped} already-published packages, failed ${failed} packages`,
);

if (failed > 0) {
  process.exit(1);
}
