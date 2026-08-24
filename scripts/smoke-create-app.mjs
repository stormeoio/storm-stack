#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { readPackageJson, readRootPackageJson, releasePackageDirs, rootDir } from "./release-packages.mjs";

const require = createRequire(import.meta.url);
const rootPackageVersion = readRootPackageJson().version;

const packageWorkspaces = releasePackageDirs.map((workspace) => [readPackageJson(workspace).name, workspace]);
const generatedStormDependencies = [
  "@stormeoio/core",
  "@stormeoio/react",
  "@stormeoio/auth",
  "@stormeoio/consent",
  "@stormeoio/crm",
  "@stormeoio/ticketing",
  "@stormeoio/stripe",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${output}`);
  }

  return result;
}

function packWorkspace(workspace, packDir) {
  const result = run("npm", ["pack", "--json", "--pack-destination", packDir, "--workspace", workspace]);
  const payload = JSON.parse(result.stdout);
  const packed = Array.isArray(payload) ? payload[0] : payload;
  if (!packed?.filename) {
    throw new Error(`npm pack did not return a filename for ${workspace}`);
  }
  return path.join(packDir, packed.filename);
}

function patchStormDependencies(appDir, tarballs) {
  const pkgPath = path.join(appDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

  for (const section of ["dependencies", "devDependencies"]) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const [name, tarball] of tarballs) {
      if (deps[name]) {
        deps[name] = `file:${tarball}`;
      }
    }
  }

  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function assertGeneratedApp(appDir) {
  const pkg = JSON.parse(readFileSync(path.join(appDir, "package.json"), "utf8"));
  const expectedStormRange = `^${rootPackageVersion}`;
  if (!pkg.devDependencies?.["@stormeoio/cli"]) {
    throw new Error("Generated app must include @stormeoio/cli because scripts call storm dev");
  }
  if (pkg.devDependencies["@stormeoio/cli"] !== expectedStormRange) {
    throw new Error(`Generated app must use ${expectedStormRange} for @stormeoio/cli`);
  }
  for (const name of generatedStormDependencies) {
    if (pkg.dependencies?.[name] !== expectedStormRange) {
      throw new Error(`Generated app must use ${expectedStormRange} for ${name}`);
    }
  }

  const serverEntry = readFileSync(path.join(appDir, "server/index.ts"), "utf8");
  if (!serverEntry.includes("eventBus")) {
    throw new Error("Generated server must pass eventBus into StormContext");
  }
  if (!serverEntry.includes("rawBody") || !serverEntry.includes("/api/stripe/webhook")) {
    throw new Error("Generated server must preserve raw Stripe webhook payloads");
  }

  const drizzleConfig = readFileSync(path.join(appDir, "drizzle.config.ts"), "utf8");
  if (drizzleConfig.includes("/dist/schema.js")) {
    throw new Error("Generated drizzle config must point to package entrypoints, not missing schema.js files");
  }

  const componentMap = readFileSync(path.join(appDir, "client/src/storm-components.ts"), "utf8");
  if (!componentMap.includes("ConsentBanner")) {
    throw new Error("Generated component map must include ConsentBanner");
  }
  const app = readFileSync(path.join(appDir, "client/src/App.tsx"), "utf8");
  if (!app.includes("return user ? <ConsentBanner /> : null") || !app.includes("<StormRootConsentBanner />")) {
    throw new Error("Generated app must only mount ConsentBanner for an authenticated user");
  }
  if (!componentMap.includes("ContactDetailPage") || !componentMap.includes("DealsPage")) {
    throw new Error("Generated CRM component map must include detail and deal pages");
  }
  if (componentMap.includes("TODO")) {
    throw new Error("Generated CRM component map must not contain placeholder TODO mappings");
  }

  for (const file of ["client/src/pages/ContactDetailPage.tsx", "client/src/pages/DealsPage.tsx"]) {
    if (!existsSync(path.join(appDir, file))) {
      throw new Error(`Generated app is missing ${file}`);
    }
  }
}

async function main() {
  const scaffoldPath = path.join(rootDir, "packages/create-storm-app/dist/scaffold.js");
  if (!existsSync(scaffoldPath)) {
    throw new Error("Missing packages/create-storm-app/dist/scaffold.js. Run npm run build first.");
  }

  const { scaffold } = require(scaffoldPath);
  if (typeof scaffold !== "function") {
    throw new Error("create-storm-app dist/scaffold.js does not export scaffold()");
  }

  const workDir = mkdtempSync(path.join(tmpdir(), "storm-stack-smoke-"));
  const packDir = path.join(workDir, "packs");
  const appDir = path.join(workDir, "generated-app");
  mkdirSync(packDir, { recursive: true });

  try {
    const tarballs = new Map(
      packageWorkspaces.map(([name, workspace]) => [name, packWorkspace(workspace, packDir)]),
    );

    scaffold(
      {
        projectName: "generated-app",
        plugins: ["@stormeoio/auth", "@stormeoio/consent", "@stormeoio/crm", "@stormeoio/ticketing", "@stormeoio/stripe"],
        packageManager: "npm",
        withClient: true,
      },
      appDir,
    );

    assertGeneratedApp(appDir);
    patchStormDependencies(appDir, tarballs);

    run("npm", ["install", "--no-audit", "--no-fund"], { cwd: appDir, stdio: "inherit" });
    run("npm", ["run", "typecheck"], { cwd: appDir, stdio: "inherit" });
    run("npm", ["run", "build"], { cwd: appDir, stdio: "inherit" });

    console.log("@stormeoio/create-storm-app smoke test passed");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
