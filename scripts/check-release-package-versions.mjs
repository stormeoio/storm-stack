#!/usr/bin/env node

import { releasePackageDirs, readPackageJson, readRootPackageJson } from "./release-packages.mjs";
import { assertStableReleaseVersion } from "./release-version.mjs";

const expectedVersion = process.argv[2] ?? readRootPackageJson().version;
const mismatches = [];

try {
  assertStableReleaseVersion(expectedVersion);
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const rootVersion = readRootPackageJson().version;
if (rootVersion !== expectedVersion) {
  mismatches.push(`package.json is v${rootVersion}, expected v${expectedVersion}`);
}

for (const packageDir of releasePackageDirs) {
  const manifest = readPackageJson(packageDir);
  if (manifest.version !== expectedVersion) {
    mismatches.push(`${packageDir} is v${manifest.version}, expected v${expectedVersion}`);
  }
}

if (mismatches.length > 0) {
  for (const mismatch of mismatches) {
    console.error(`::error::${mismatch}`);
  }
  process.exit(1);
}

console.log(`Release package versions are aligned at ${expectedVersion}.`);
