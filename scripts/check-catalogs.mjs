#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function readText(path) {
  return readFileSync(join(rootDir, path), "utf8");
}

function readRegistryIds() {
  const registry = JSON.parse(readText("registry.json"));
  if (!Array.isArray(registry.plugins)) {
    throw new Error("registry.json must contain a plugins array.");
  }
  return registry.plugins.map((plugin) => {
    if (typeof plugin?.id !== "string") {
      throw new Error("Every registry plugin must have a string id.");
    }
    return plugin.id;
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

const expectedIds = readRegistryIds();
const targets = [
  {
    label: relative(rootDir, join(rootDir, "packages/cli/src/registry.ts")),
    ids: extractPluginIds("packages/cli/src/registry.ts", "export const PLUGINS"),
  },
  {
    label: relative(rootDir, join(rootDir, "packages/core/src/plugin/manifest-route.ts")),
    ids: extractPluginIds("packages/core/src/plugin/manifest-route.ts", "const CATALOG_REGISTRY"),
  },
];

const errors = targets.flatMap((target) => compareIds(target.label, target.ids, expectedIds));

if (errors.length > 0) {
  console.error("Catalog check failed:");
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log(`Catalogs are in sync (${expectedIds.length} plugins).`);
