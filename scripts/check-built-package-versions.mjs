#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { readPackageJson, rootDir } from "./release-packages.mjs";

const require = createRequire(import.meta.url);

const targets = [
  {
    packageDir: "packages/core",
    readVersions: (module) => [module.PACKAGE_VERSION],
  },
  {
    packageDir: "packages/plugin-auth",
    readVersions: (module) => [module.authPlugin.version],
  },
  {
    packageDir: "packages/plugin-auth-social",
    readVersions: (module) => [module.createSocialAuthPlugin({}).version],
  },
  {
    packageDir: "packages/plugin-consent",
    readVersions: (module) => [module.consentPlugin.version],
  },
  {
    packageDir: "packages/plugin-crm",
    readVersions: (module) => [module.crmPlugin.version],
  },
  {
    packageDir: "packages/plugin-ticketing",
    readVersions: (module) => [module.ticketingPlugin.version],
  },
  {
    packageDir: "packages/plugin-stripe",
    readVersions: (module) => [module.stripePlugin.version],
  },
];

for (const target of targets) {
  const manifest = readPackageJson(target.packageDir);
  const rootExport = manifest.exports?.["."];

  assert.equal(typeof rootExport?.require, "string", `${manifest.name} must expose a CommonJS entry`);
  assert.equal(typeof rootExport?.import, "string", `${manifest.name} must expose an ESM entry`);

  const packageRoot = join(rootDir, target.packageDir);
  const commonJsModule = require(join(packageRoot, rootExport.require));
  const esModule = await import(pathToFileURL(join(packageRoot, rootExport.import)).href);

  for (const [format, module] of [["require", commonJsModule], ["import", esModule]]) {
    const versions = target.readVersions(module);
    assert.ok(versions.length > 0, `${manifest.name} ${format} export must expose at least one version`);

    for (const actualVersion of versions) {
      assert.equal(
        actualVersion,
        manifest.version,
        `${manifest.name} ${format} export reports v${actualVersion}, expected v${manifest.version}`,
      );
    }
  }
}

console.log(`Built CJS and ESM exports match package manifests for ${targets.length} packages.`);
