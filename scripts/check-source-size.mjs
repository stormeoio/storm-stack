#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const maxLines = 1000;
const sourceRoots = ["apps", "packages", "tooling"];
const ignoredDirectories = new Set(["node_modules", "dist", "coverage", ".turbo"]);
const checkedExtensions = new Set([".ts", ".tsx"]);

function listSourceFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...listSourceFiles(join(directory, entry.name)));
      }
      continue;
    }

    if (entry.isFile() && checkedExtensions.has(extname(entry.name))) {
      files.push(join(directory, entry.name));
    }
  }

  return files;
}

function countLines(path) {
  const source = readFileSync(path, "utf8");
  return source.split("\n").length;
}

const files = sourceRoots.flatMap((root) => listSourceFiles(join(rootDir, root)));
const oversized = files
  .map((path) => ({ path, lines: countLines(path) }))
  .filter(({ lines }) => lines > maxLines)
  .sort((a, b) => b.lines - a.lines);

if (oversized.length > 0) {
  console.error(`Source size check failed: .ts/.tsx files must stay under ${maxLines} lines.`);
  for (const file of oversized) {
    console.error(`${relative(rootDir, file.path)}: ${file.lines} lines`);
  }
  process.exit(1);
}

console.log(`Source size check passed (${files.length} files, max ${maxLines} lines).`);
