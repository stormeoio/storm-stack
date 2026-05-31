#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { releasePackageDirs } from "./release-packages.mjs";

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
  const label = `${relative(rootDir, path)} (${manifest.name ?? "unnamed package"})`;
  const errors = [];

  if (manifest.private === true) {
    errors.push(`${label}: release packages must not be private.`);
    return errors;
  }

  if (manifest.publishConfig?.access !== "public") {
    errors.push(`${label}: publishConfig.access must be "public".`);
  }

  if (manifest.publishConfig?.registry !== npmRegistry) {
    errors.push(`${label}: publishConfig.registry must be "${npmRegistry}".`);
  }

  return errors;
}

const packageJsonPaths = listPackageJsonPaths();
const releasePackageJsonPaths = releasePackageDirs.map((dir) => join(rootDir, dir, "package.json"));
const releasePackageJsonPathSet = new Set(releasePackageJsonPaths);
const publicPackageJsonPaths = packageJsonPaths.filter((path) => readPackageJson(path).private !== true);
const unlistedPublicPackages = publicPackageJsonPaths.filter((path) => !releasePackageJsonPathSet.has(path));
const missingReleasePackages = releasePackageJsonPaths.filter((path) => !existsSync(path));
const errors = releasePackageJsonPaths.flatMap((path) => (existsSync(path) ? validatePackageMetadata(path) : []));

for (const path of unlistedPublicPackages) {
  errors.push(`${relative(rootDir, path)}: public package is missing from releasePackageDirs.`);
}

for (const path of missingReleasePackages) {
  errors.push(`${relative(rootDir, path)}: release package manifest does not exist.`);
}

if (errors.length > 0) {
  console.error("Package metadata check failed:");
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log(`Package metadata is publish-ready (${releasePackageJsonPaths.length} release packages).`);
