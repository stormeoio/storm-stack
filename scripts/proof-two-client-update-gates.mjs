import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  ProofBlockedError,
  assertArtifactHashes,
  assertPathWithin,
  exitCode,
  fileManifest,
  nowIso,
  sha256Buffer,
} from "./proof-two-client-update-helpers.mjs";

const CONSENT_PACKAGE = "@stormeoio/consent";
const CLIENT_DECLARATION_ENTRY = "package/dist/client/index.d.ts";
const PACKAGE_MANIFEST_ENTRY = "package/package.json";

function artifactFor(artifacts, packageName, label) {
  const matches = artifacts.filter(({ name }) => name === packageName);
  if (matches.length !== 1) {
    throw new ProofBlockedError(
      `${label} release train must contain exactly one ${packageName} tarball`,
      "consent-api-stability",
    );
  }
  return matches[0];
}

function readTarEntry(tarballPath, entryName) {
  const result = spawnSync("tar", ["-xOf", tarballPath, entryName], {
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (exitCode(result) !== 0) {
    const stderr = (result.stderr ?? Buffer.alloc(0)).toString("utf8").trim();
    throw new ProofBlockedError(
      `Cannot extract ${entryName} from ${tarballPath}: ${stderr}`,
      "consent-api-stability",
    );
  }
  return result.stdout ?? Buffer.alloc(0);
}

function packedClientExport(tarballPath) {
  const manifestBytes = readTarEntry(tarballPath, PACKAGE_MANIFEST_ENTRY);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    throw new ProofBlockedError(
      `Invalid packed package.json in ${tarballPath}: ${error instanceof Error ? error.message : String(error)}`,
      "consent-api-stability",
    );
  }
  const clientExport = manifest.exports?.["./client"];
  if (!clientExport || typeof clientExport !== "object" || Array.isArray(clientExport)) {
    throw new ProofBlockedError(
      `Packed ${CONSENT_PACKAGE} has no object exports[\"./client\"]`,
      "consent-api-stability",
    );
  }
  return clientExport;
}

export function inspectConsentClientApiStability(sourceArtifacts, targetArtifacts) {
  assertArtifactHashes(sourceArtifacts);
  assertArtifactHashes(targetArtifacts);
  const baseline = artifactFor(sourceArtifacts, CONSENT_PACKAGE, "baseline");
  const target = artifactFor(targetArtifacts, CONSENT_PACKAGE, "target");
  const baselineDeclaration = readTarEntry(baseline.tarballPath, CLIENT_DECLARATION_ENTRY);
  const targetDeclaration = readTarEntry(target.tarballPath, CLIENT_DECLARATION_ENTRY);
  const baselineExport = packedClientExport(baseline.tarballPath);
  const targetExport = packedClientExport(target.tarballPath);
  const declarationBytesEqual = baselineDeclaration.equals(targetDeclaration);
  const baselineDeclarationSha256 = sha256Buffer(baselineDeclaration);
  const targetDeclarationSha256 = sha256Buffer(targetDeclaration);
  const declarationHashesEqual = baselineDeclarationSha256 === targetDeclarationSha256;
  const clientExportsEqual = isDeepStrictEqual(baselineExport, targetExport);
  return {
    package: CONSENT_PACKAGE,
    declarationEntry: CLIENT_DECLARATION_ENTRY,
    baseline: {
      version: baseline.version,
      tarball: baseline.tarballPath,
      declarationBytes: baselineDeclaration.length,
      declarationSha256: baselineDeclarationSha256,
      clientExport: baselineExport,
    },
    target: {
      version: target.version,
      tarball: target.tarballPath,
      declarationBytes: targetDeclaration.length,
      declarationSha256: targetDeclarationSha256,
      clientExport: targetExport,
    },
    declarationBytesEqual,
    declarationHashesEqual,
    clientExportsEqual,
    pass: declarationBytesEqual && declarationHashesEqual && clientExportsEqual,
  };
}

export function journalConsentClientApiStability(harness) {
  const startedAt = nowIso();
  const startedMs = Date.now();
  let evidence;
  let failure;
  try {
    evidence = inspectConsentClientApiStability(
      harness.runtime.sourceArtifacts,
      harness.runtime.targetArtifacts,
    );
    if (!evidence.pass) {
      failure = new ProofBlockedError(
        "Packed Consent React client API changed between 0.1.0 and 0.1.1",
        "consent-api-stability",
      );
    }
  } catch (error) {
    failure = error;
  }
  harness.recordSyntheticCommand({
    id: "verify-consent-client-api-stability",
    command: "extract and byte-compare packed Consent client declarations and ./client exports",
    startedAt,
    startedMs,
    exitCode: failure ? 1 : 0,
    required: true,
    detail: failure
      ? `${JSON.stringify({ evidence: evidence ?? null, error: failure instanceof Error ? failure.message : String(failure) }, null, 2)}\n`
      : `${JSON.stringify(evidence, null, 2)}\n`,
  });
  if (failure) throw failure;
  return evidence;
}

export function migrationSqlSnapshot(appDir) {
  const drizzleRoot = assertPathWithin(appDir, path.join(appDir, "drizzle"));
  if (!existsSync(drizzleRoot)) {
    throw new ProofBlockedError(`Missing Drizzle directory in ${appDir}`, "consent-additive-migration");
  }
  return Object.fromEntries(
    Object.entries(fileManifest(drizzleRoot, { ignores: [] }))
      .filter(([relative]) => relative.endsWith(".sql"))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function canonicalMigrationSql(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inspectConsentAdditiveMigration(appDir, beforeSqlSnapshot) {
  const drizzleRoot = assertPathWithin(appDir, path.join(appDir, "drizzle"));
  const afterSqlSnapshot = migrationSqlSnapshot(appDir);
  const historicalDeleted = Object.keys(beforeSqlSnapshot)
    .filter((relative) => afterSqlSnapshot[relative] === undefined);
  const historicalModified = Object.entries(beforeSqlSnapshot)
    .filter(([relative, sha256]) => (
      afterSqlSnapshot[relative] !== undefined && afterSqlSnapshot[relative] !== sha256
    ))
    .map(([relative]) => relative);
  const newSqlFiles = Object.keys(afterSqlSnapshot)
    .filter((relative) => beforeSqlSnapshot[relative] === undefined);
  const inspected = newSqlFiles.map((relative) => {
    const sqlPath = assertPathWithin(drizzleRoot, path.join(drizzleRoot, relative));
    const bytes = readFileSync(sqlPath);
    const canonicalSql = canonicalMigrationSql(bytes.toString("utf8"));
    const destructivePatterns = [
      ["DROP", /\bDROP\b/i],
      ["RENAME", /\bRENAME\b/i],
      ["DEFAULT", /\bDEFAULT\b/i],
      ["NOT NULL", /\bNOT\s+NULL\b/i],
    ].filter(([, pattern]) => pattern.test(canonicalSql)).map(([label]) => label);
    const exactAddColumn = /^ALTER\s+TABLE\s+(?:"?public"?\.)?"?storm_consent_preferences"?\s+ADD\s+COLUMN\s+"?withdrawn_at"?\s+timestamp\s+with\s+time\s+zone\s*;?$/i.test(canonicalSql);
    return {
      relative,
      sha256: sha256Buffer(bytes),
      canonicalSql,
      destructivePatterns,
      exactAddColumn,
    };
  });
  return {
    beforeSqlSnapshot,
    afterSqlSnapshot,
    historicalDeleted,
    historicalModified,
    newSqlFiles,
    inspected,
    pass: historicalDeleted.length === 0
      && historicalModified.length === 0
      && inspected.length === 1
      && inspected[0].destructivePatterns.length === 0
      && inspected[0].exactAddColumn,
  };
}

export function journalConsentAdditiveMigration(
  harness,
  definition,
  appDir,
  beforeSqlSnapshot,
  commandId,
  required = true,
) {
  const startedAt = nowIso();
  const startedMs = Date.now();
  let evidence;
  let failure;
  try {
    evidence = inspectConsentAdditiveMigration(appDir, beforeSqlSnapshot);
    if (!evidence.pass) {
      failure = new ProofBlockedError(
        `Consent migration for ${definition.name} is not the single additive withdrawn_at column`,
        "consent-additive-migration",
      );
    }
  } catch (error) {
    failure = error;
  }
  harness.recordSyntheticCommand({
    id: commandId,
    fixture: definition.name,
    command: "verify Consent SQL is only ADD COLUMN withdrawn_at timestamp with time zone",
    startedAt,
    startedMs,
    exitCode: failure ? 1 : 0,
    required,
    detail: failure
      ? `${JSON.stringify({ evidence: evidence ?? null, error: failure instanceof Error ? failure.message : String(failure) }, null, 2)}\n`
      : `${JSON.stringify(evidence, null, 2)}\n`,
  });
  if (failure) throw failure;
  return evidence;
}
