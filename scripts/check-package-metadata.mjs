#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { releasePackageDirs } from "./release-packages.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesDir = join(rootDir, "packages");
const npmRegistry = "https://registry.npmjs.org/";
const sourceExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const nodeBuiltins = new Set(builtinModules.map((specifier) => specifier.replace(/^node:/, "")));
const expectedBins = new Map([
  ["@stormeoio/cli", { storm: "dist/index.mjs" }],
  ["@stormeoio/create-storm-app", { "create-storm-app": "dist/index.js" }],
]);

function readPackageJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listPackageJsonPaths() {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name, "package.json"))
    .filter((path) => existsSync(path));
}

function listRuntimeSourceFiles(directory) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : listRuntimeSourceFiles(path);
    }

    if (!entry.isFile() || !sourceExtensions.has(extname(entry.name))) return [];
    if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return [path];
  });
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }

  return specifier.split("/")[0];
}

function isNodeBuiltin(specifier) {
  const normalized = specifier.replace(/^node:/, "");
  return nodeBuiltins.has(normalized) || nodeBuiltins.has(normalized.split("/")[0]);
}

function isRuntimeImportDeclaration(node) {
  const importClause = node.importClause;

  if (!importClause) return true;
  if (importClause.isTypeOnly) return false;
  if (importClause.name) return true;
  if (ts.isNamespaceImport(importClause.namedBindings)) return true;

  return importClause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function isRuntimeExportDeclaration(node) {
  if (node.isTypeOnly) return false;
  if (!node.exportClause) return true;
  if (ts.isNamespaceExport(node.exportClause)) return true;

  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function collectRuntimeImports(packageDir) {
  const imports = new Map();

  function addImport(specifier, sourcePath, sourceFile, position) {
    if (
      specifier.startsWith(".") ||
      specifier.startsWith("/") ||
      specifier.startsWith("#") ||
      isNodeBuiltin(specifier)
    ) {
      return;
    }

    const packageName = packageNameFromSpecifier(specifier);
    const line = sourceFile.getLineAndCharacterOfPosition(position).line + 1;
    const locations = imports.get(packageName) ?? [];
    locations.push(`${relative(rootDir, sourcePath)}:${line} (${specifier})`);
    imports.set(packageName, locations);
  }

  for (const sourcePath of listRuntimeSourceFiles(join(packageDir, "src"))) {
    const sourceText = readFileSync(sourcePath, "utf8");
    const scriptKind = sourceExtensions.has(extname(sourcePath)) && /x$/.test(extname(sourcePath))
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);

    function visit(node) {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        isRuntimeImportDeclaration(node)
      ) {
        addImport(node.moduleSpecifier.text, sourcePath, sourceFile, node.moduleSpecifier.getStart(sourceFile));
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        isRuntimeExportDeclaration(node)
      ) {
        addImport(node.moduleSpecifier.text, sourcePath, sourceFile, node.moduleSpecifier.getStart(sourceFile));
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        !node.isTypeOnly &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteral(node.moduleReference.expression)
      ) {
        addImport(
          node.moduleReference.expression.text,
          sourcePath,
          sourceFile,
          node.moduleReference.expression.getStart(sourceFile),
        );
      } else if (ts.isCallExpression(node)) {
        const [argument] = node.arguments;
        const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";

        if ((isDynamicImport || isRequire) && argument && ts.isStringLiteral(argument)) {
          addImport(argument.text, sourcePath, sourceFile, argument.getStart(sourceFile));
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return imports;
}

function validatePackageMetadata(path) {
  const manifest = readPackageJson(path);
  const label = `${relative(rootDir, path)} (${manifest.name ?? "unnamed package"})`;
  const packageDir = dirname(path);
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

  const expectedBin = expectedBins.get(manifest.name);
  if (expectedBin) {
    const actualEntries = Object.entries(manifest.bin ?? {}).sort(([left], [right]) => left.localeCompare(right));
    const expectedEntries = Object.entries(expectedBin).sort(([left], [right]) => left.localeCompare(right));
    if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
      errors.push(`${label}: bin must be ${JSON.stringify(expectedBin)}.`);
    }
  }

  const runtimeDependencyNames = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);

  for (const [dependency, locations] of collectRuntimeImports(packageDir)) {
    if (runtimeDependencyNames.has(dependency)) continue;

    errors.push(
      `${label}: runtime dependency "${dependency}" is not declared in dependencies, optionalDependencies, or peerDependencies ` +
      `(imported by ${locations.join(", ")}).`,
    );
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
