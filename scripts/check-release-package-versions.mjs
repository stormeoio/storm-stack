#!/usr/bin/env node

import { releasePackageDirs, readPackageJson, readRootPackageJson } from "./release-packages.mjs";

const expectedVersion = process.argv[2] ?? readRootPackageJson().version;
const mismatches = [];

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
