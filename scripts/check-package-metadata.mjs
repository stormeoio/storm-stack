#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesDir = join(rootDir, "packages");
const npmRegistry = "https://registry.npmjs.org/";

function readPackageJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listPackageJsonPaths() {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name, "package.json"))
    .filter((path) => existsSync(path));
}

function validatePackageMetadata(path) {
  const manifest = readPackageJson(path);
  if (manifest.private === true) {
    return [];
  }

  const label = `${relative(rootDir, path)} (${manifest.name ?? "unnamed package"})`;
  const errors = [];

  if (manifest.publishConfig?.access !== "public") {
    errors.push(`${label}: publishConfig.access must be "public".`);
  }

  if (manifest.publishConfig?.registry !== npmRegistry) {
    errors.push(`${label}: publishConfig.registry must be "${npmRegistry}".`);
  }

  return errors;
}

const packageJsonPaths = listPackageJsonPaths();
const errors = packageJsonPaths.flatMap((path) => validatePackageMetadata(path));

if (errors.length > 0) {
  console.error("Package metadata check failed:");
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log(`Package metadata is publish-ready (${packageJsonPaths.length} packages).`);
