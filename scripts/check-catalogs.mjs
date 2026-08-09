#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { readPackageJson, releasePackageDirs } from "./release-packages.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function readText(path) {
  return readFileSync(join(rootDir, path), "utf8");
}

function readRegistry() {
  const registry = JSON.parse(readText("registry.json"));
  if (!Array.isArray(registry.plugins)) {
    throw new Error("registry.json must contain a plugins array.");
  }
  return registry.plugins.map((plugin) => {
    if (typeof plugin?.id !== "string") {
      throw new Error("Every registry plugin must have a string id.");
    }
    if (plugin.status !== "available" && plugin.status !== "coming-soon") {
      throw new Error(`Plugin ${plugin.id} has an invalid status.`);
    }
    return { id: plugin.id, status: plugin.status };
  });
}

function extractArrayBlock(source, marker, path) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`${path}: marker not found: ${marker}`);
  }

  const start = source.indexOf("[", markerIndex);
  const end = source.indexOf("];", start);
  if (start === -1 || end === -1) {
    throw new Error(`${path}: unable to find array block after ${marker}`);
  }

  return source.slice(start, end);
}

function extractPluginIds(path, marker) {
  const source = readText(path);
  const block = extractArrayBlock(source, marker, path);
  return [...block.matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1]);
}

function extractStormPackageNames(path, marker) {
  const source = readText(path);
  const block = extractArrayBlock(source, marker, path);
  return [...block.matchAll(/"(@stormstack\/[^"]+)"/g)].map((match) => match[1]);
}

function compareIds(label, actual, expected) {
  const missing = expected.filter((id) => !actual.includes(id));
  const extra = actual.filter((id) => !expected.includes(id));
  const sameOrder = actual.length === expected.length && actual.every((id, index) => id === expected[index]);

  if (missing.length === 0 && extra.length === 0 && sameOrder) {
    return [];
  }

  const errors = [`${label} is out of sync with registry.json.`];
  if (missing.length > 0) {
    errors.push(`  Missing: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    errors.push(`  Extra: ${extra.join(", ")}`);
  }
  if (missing.length === 0 && extra.length === 0 && !sameOrder) {
    errors.push("  IDs match, but order differs.");
  }
  return errors;
}

const registry = readRegistry();
const expectedIds = registry.map(({ id }) => id);
const expectedAvailableIds = registry
  .filter(({ status }) => status === "available")
  .map(({ id }) => id);
const infrastructurePackages = new Set([
  "@stormstack/core",
  "@stormstack/react",
  "@stormstack/testing",
  "@stormstack/cli",
  "create-storm-app",
]);
const releasedPluginIds = releasePackageDirs
  .map((directory) => readPackageJson(directory).name)
  .filter((name) => name.startsWith("@stormstack/") && !infrastructurePackages.has(name));
const targets = [
  {
    label: relative(rootDir, join(rootDir, "packages/cli/src/registry.ts")),
    ids: extractPluginIds("packages/cli/src/registry.ts", "export const PLUGINS"),
    expected: expectedIds,
  },
  {
    label: relative(rootDir, join(rootDir, "packages/core/src/plugin/manifest-route.ts")),
    ids: extractPluginIds("packages/core/src/plugin/manifest-route.ts", "const CATALOG_REGISTRY"),
    expected: expectedIds,
  },
  {
    label: "packages/create-storm-app/src/cli-options.ts",
    ids: extractStormPackageNames("packages/create-storm-app/src/cli-options.ts", "export const PLUGIN_IDS"),
    expected: expectedAvailableIds,
  },
  {
    label: "packages/create-storm-app/src/generated-plugin-definitions.ts",
    ids: extractPluginIds("packages/create-storm-app/src/generated-plugin-definitions.ts", "export const generatedPluginDefinitions"),
    expected: expectedAvailableIds,
  },
  {
    label: "scripts/release-packages.mjs",
    ids: releasedPluginIds,
    expected: expectedAvailableIds,
  },
];

const errors = targets.flatMap((target) => compareIds(target.label, target.ids, target.expected));

if (errors.length > 0) {
  console.error("Catalog check failed:");
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log(`Catalogs are in sync (${expectedIds.length} plugins).`);
