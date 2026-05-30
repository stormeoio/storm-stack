#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import { releasePackageDirs, rootDir } from "./release-packages.mjs";

let failed = 0;

for (const packageDir of releasePackageDirs) {
  const status =
    spawnSync("npm", ["pack", "--dry-run", "--workspace", packageDir], {
      cwd: rootDir,
      stdio: "inherit",
    }).status ?? 1;

  if (status !== 0) {
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`Pack check failed for ${failed} package(s).`);
  process.exit(1);
}
