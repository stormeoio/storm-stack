import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export const releasePackageDirs = [
  "packages/core",
  "packages/react",
  "packages/testing",
  "packages/plugin-auth",
  "packages/plugin-auth-social",
  "packages/plugin-crm",
  "packages/plugin-ticketing",
  "packages/plugin-stripe",
  "packages/cli",
  "packages/create-storm-app",
];

export function readPackageJson(packageDir) {
  return JSON.parse(readFileSync(join(rootDir, packageDir, "package.json"), "utf8"));
}

export function readRootPackageJson() {
  return JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
}
