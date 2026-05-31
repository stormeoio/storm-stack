import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { readPackageJson, readRootPackageJson, releasePackageDirs, rootDir } from "./release-packages.mjs";

const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const check = args.has("--check") || !write;

if (args.has("--help")) {
  console.log("Usage: node scripts/sync-internal-versions.mjs [--check|--write]");
  process.exit(0);
}

function sortObjectByKey(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function findWorkspacePackageJsons(workspaces) {
  const packageJsons = [];

  for (const pattern of workspaces) {
    if (!pattern.endsWith("/*")) {
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    }

    const workspaceRoot = join(rootDir, pattern.slice(0, -2));
    const entries = await readdir(workspaceRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageJsonPath = join(workspaceRoot, entry.name, "package.json");
      try {
        await access(packageJsonPath);
        packageJsons.push(packageJsonPath);
      } catch {
        // Some workspace globs also contain fixtures/templates without manifests.
      }
    }
  }

  return packageJsons.sort();
}

const rootPackage = readRootPackageJson();
const targetVersion = rootPackage.version;
const expectedRange = `^${targetVersion}`;
const workspacePackagePaths = await findWorkspacePackageJsons(rootPackage.workspaces ?? []);
const workspacePackages = [];

for (const packagePath of workspacePackagePaths) {
  const manifest = await readJson(packagePath);
  workspacePackages.push({ manifest, packagePath });
}

const releasePackageNames = new Set(releasePackageDirs.map((packageDir) => readPackageJson(packageDir).name).filter(Boolean));

const changes = [];

for (const workspacePackage of workspacePackages) {
  const { manifest, packagePath } = workspacePackage;
  let changed = false;
  const displayPath = relative(rootDir, packagePath);

  if (manifest.private !== true && manifest.version !== targetVersion) {
    changes.push(`${displayPath}: version ${manifest.version} -> ${targetVersion}`);
    if (write) {
      manifest.version = targetVersion;
      changed = true;
    }
  }

  for (const section of dependencySections) {
    const dependencies = manifest[section];
    if (!dependencies) {
      continue;
    }

    for (const dependencyName of Object.keys(dependencies)) {
      if (!releasePackageNames.has(dependencyName)) {
        continue;
      }

      const currentRange = dependencies[dependencyName];
      if (currentRange === expectedRange) {
        continue;
      }

      changes.push(`${displayPath}: ${section}.${dependencyName} ${currentRange} -> ${expectedRange}`);
      if (write) {
        dependencies[dependencyName] = expectedRange;
        manifest[section] = sortObjectByKey(dependencies);
        changed = true;
      }
    }
  }

  if (write && changed) {
    await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

if (changes.length === 0) {
  console.log(`Internal package versions are in sync at ${targetVersion}.`);
  process.exit(0);
}

if (check) {
  console.error("Internal package versions are out of sync:");
  for (const change of changes) {
    console.error(`- ${change}`);
  }
  console.error("Run npm run version:sync to update package manifests.");
  process.exit(1);
}

console.log("Updated internal package versions:");
for (const change of changes) {
  console.log(`- ${change}`);
}
