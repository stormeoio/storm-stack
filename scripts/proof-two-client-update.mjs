#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROOF_BASE_VERSION,
  PROOF_TARGET_VERSION,
} from "./proof-model.mjs";
import {
  InjectedInterruption,
  ProofBlockedError,
  REPOSITORY_ROOT,
  assertArtifactHashes,
  assertInstalledTrain,
  assertPathWithin,
  atomicWriteJson,
  classifyUpdateChanges,
  convertPackManifest,
  diffFileManifests,
  exitCode,
  fileManifest,
  nowIso,
  parseBuildMarker,
  parseInterruptionMarker,
  parseProofArguments,
  readJson,
  sha256File,
  usage,
} from "./proof-two-client-update-helpers.mjs";
import { ProofHarness } from "./proof-two-client-update-harness.mjs";
import { revalidateCheckpointArtifacts } from "./proof-two-client-update-artifacts.mjs";
import {
  journalConsentAdditiveMigration,
  journalConsentClientApiStability,
  migrationSqlSnapshot,
} from "./proof-two-client-update-gates.mjs";
import {
  backupClientFiles,
  backupFixture,
  backupPath,
  customizeFixture,
  databaseFingerprints,
  fixtureAppDir,
  fixtureEnv,
  journalVerification,
  patchPackageFile,
  recoverySnapshot,
  rollbackFixture,
  startFixtureProcesses,
  startPostgres,
  stopFixtureIfRunning,
  stopFixtureProcesses,
  verifyConcurrentFixtures,
  writeFixtureEnv,
} from "./proof-two-client-update-fixtures.mjs";
import { stopPersistedFixtureProcesses } from "./proof-two-client-update-processes.mjs";
import {
  buildEmergencyReport,
  buildStoppedReport,
  buildTerminalReport,
  cleanupAbandonedProof,
  cleanupHarness,
  writeProofReport,
} from "./proof-two-client-update-report.mjs";
import {
  beginMutationEpoch,
  completeMutationEpoch,
  journalColdCacheAfter,
  journalColdCacheBefore,
  journalWarmCacheAfter,
  journalWarmCacheBefore,
  needsRecovery,
  nextRecoveryAttempt,
  recordRecoveryEpoch,
  setCurrentTrain,
} from "./proof-two-client-update-runtime.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export { ProofHarness };

function rawGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd ?? REPOSITORY_ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });
  if (exitCode(result) !== 0) {
    throw new ProofBlockedError(`git ${args.join(" ")} failed: ${result.stderr}`, options.step ?? "git");
  }
  return result.stdout.trim();
}

function verifyImmutableRefs(harness) {
  if (harness.runtime.baseCommit && harness.runtime.targetCommit) {
    const baseCommit = rawGit(["rev-parse", `${harness.options.baselineRef}^{commit}`], { step: "resolve-baseline" });
    const targetCommit = rawGit(["rev-parse", `${harness.options.targetRef}^{commit}`], { step: "resolve-target" });
    if (baseCommit !== harness.runtime.baseCommit || targetCommit !== harness.runtime.targetCommit) {
      throw new ProofBlockedError("A proof ref moved since the checkpoint", "resume");
    }
    return;
  }

  const baselineType = rawGit(["cat-file", "-t", harness.options.baselineRef], { step: "resolve-baseline" });
  if (baselineType !== "tag") {
    throw new ProofBlockedError("The baseline ref must be an annotated tag", "resolve-baseline");
  }
  const baseline = harness.runCommand({
    id: "resolve-baseline",
    command: "git",
    args: ["rev-parse", `${harness.options.baselineRef}^{commit}`],
  });
  const target = harness.runCommand({
    id: "resolve-target",
    command: "git",
    args: ["rev-parse", `${harness.options.targetRef}^{commit}`],
  });
  harness.runtime.baseCommit = String(baseline.stdout).trim();
  harness.runtime.targetCommit = String(target.stdout).trim();
  if (!/^[a-f0-9]{40}$/.test(harness.runtime.baseCommit) || !/^[a-f0-9]{40}$/.test(harness.runtime.targetCommit)) {
    throw new ProofBlockedError("Proof refs did not resolve to full Git commits", "resolve-refs");
  }
  if (harness.runtime.baseCommit === harness.runtime.targetCommit) {
    throw new ProofBlockedError("Baseline and target resolve to the same commit", "resolve-refs");
  }
  harness.persist();
}

function ensureSourceWorktree(harness, label, commit) {
  const worktree = assertPathWithin(
    harness.options.workDir,
    path.join(harness.paths.worktrees, label),
  );
  if (existsSync(worktree)) {
    const actual = rawGit(["rev-parse", "HEAD"], { cwd: worktree, step: `worktree-${label}` });
    if (actual !== commit) throw new ProofBlockedError(`${label} worktree commit drifted`, `worktree-${label}`);
    return worktree;
  }
  mkdirSync(path.dirname(worktree), { recursive: true });
  harness.runCommand({
    id: `worktree-${label}`,
    command: "git",
    args: ["worktree", "add", "--detach", worktree, commit],
    required: false,
  });
  return worktree;
}

function packSourceState(harness, label, commit, version, requiredId) {
  const existing = label === "baseline" ? harness.runtime.sourceArtifacts : harness.runtime.targetArtifacts;
  if (existing.length > 0) {
    const checkpointWorktree = assertPathWithin(
      harness.options.workDir,
      path.join(harness.paths.worktrees, label),
    );
    revalidateCheckpointArtifacts(harness, {
      label,
      worktree: checkpointWorktree,
      commit,
      version,
      existing,
      requiredCommandIds: label === "target"
        ? [requiredId, "release-acceptance-target"]
        : [requiredId],
    });
    return existing;
  }
  const worktree = ensureSourceWorktree(harness, label, commit);
  harness.runCommand({
    id: `${label}:npm-ci`,
    command: "npm",
    args: ["ci", "--no-audit", "--no-fund"],
    cwd: worktree,
    required: false,
  });
  harness.runCommand({
    id: `${label}:build`,
    command: "npm",
    args: ["run", "build"],
    cwd: worktree,
    required: false,
  });
  if (label === "target") {
    harness.runCommand({
      id: "release-acceptance-target",
      command: "npm",
      args: ["run", "release:check"],
      cwd: worktree,
      required: true,
    });
  }
  const destination = assertPathWithin(
    harness.options.workDir,
    path.join(harness.paths.artifacts, label),
  );
  mkdirSync(destination, { recursive: true });
  harness.runCommand({
    id: requiredId,
    command: process.execPath,
    args: [path.join(worktree, "scripts/pack-tarballs.mjs"), "--destination", destination],
    cwd: worktree,
  });
  const status = rawGit(["status", "--porcelain", "--untracked-files=all"], { cwd: worktree, step: `pack-${label}` });
  if (status) throw new ProofBlockedError(`${label} worktree became dirty:\n${status}`, `pack-${label}`);
  const artifacts = convertPackManifest(
    readJson(path.join(destination, "tarballs-manifest.json")),
    destination,
    commit,
    version,
  );
  if (label === "baseline") harness.runtime.sourceArtifacts = artifacts;
  else harness.runtime.targetArtifacts = artifacts;
  harness.persist();
  return artifacts;
}

function ensureArtifacts(harness) {
  verifyImmutableRefs(harness);
  packSourceState(
    harness,
    "baseline",
    harness.runtime.baseCommit,
    PROOF_BASE_VERSION,
    "pack-baseline",
  );
  packSourceState(
    harness,
    "target",
    harness.runtime.targetCommit,
    PROOF_TARGET_VERSION,
    "pack-target",
  );
  if (!harness.runtime.commands.some(({ id }) => id === "verify-consent-client-api-stability")) {
    journalConsentClientApiStability(harness);
  }
}

function generateFixture(harness, definition) {
  const appDir = fixtureAppDir(harness, definition);
  if (existsSync(appDir)) throw new ProofBlockedError(`Fixture directory already exists: ${appDir}`, "generate");
  mkdirSync(path.dirname(appDir), { recursive: true });
  const baselineTree = assertPathWithin(
    harness.options.workDir,
    path.join(harness.paths.worktrees, "baseline"),
  );
  const started = Date.now();
  harness.runtime.fixtures[definition.name].generationStartedAtMs = started;
  harness.runCommand({
    id: `${definition.name}:generate`,
    fixture: definition.name,
    command: process.execPath,
    args: [
      path.join(baselineTree, "packages/create-storm-app/dist/index.js"),
      definition.projectName,
      "--yes",
      "--plugins",
      definition.plugins,
      "--with-client",
      "--package-manager",
      "npm",
    ],
    cwd: assertPathWithin(harness.options.workDir, harness.paths.fixtures),
  });
  writeFixtureEnv(appDir, definition);
  harness.completeStep(definition.name, "generated", appDir);
}

function installTrain(harness, definition, artifacts, id, options = {}) {
  const appDir = fixtureAppDir(harness, definition);
  patchPackageFile(appDir, artifacts);
  const args = ["install", "--no-audit", "--no-fund"];
  if (options.cacheDir) args.push("--cache", options.cacheDir);
  const result = harness.runCommand({
    id,
    fixture: definition.name,
    command: "npm",
    args,
    cwd: appDir,
    env: fixtureEnv(definition),
    required: options.required ?? true,
  });
  assertInstalledTrain(appDir, artifacts, options.version);
  return result.result.durationMs;
}

function generateMigration(harness, definition, id, migrationName, options = {}) {
  const appDir = fixtureAppDir(harness, definition);
  const beforeSqlSnapshot = options.additiveGateId ? migrationSqlSnapshot(appDir) : null;
  const args = ["run", "db:generate", "--"];
  if (options.config) args.push("--config", options.config);
  args.push("--name", migrationName);
  const duration = harness.runCommand({
    id,
    fixture: definition.name,
    command: "npm",
    args,
    cwd: appDir,
    env: fixtureEnv(definition),
    required: options.required ?? true,
  }).result.durationMs;
  if (options.additiveGateId) {
    journalConsentAdditiveMigration(
      harness,
      definition,
      appDir,
      beforeSqlSnapshot,
      options.additiveGateId,
      options.required ?? true,
    );
  }
  return duration;
}

function migrate(harness, definition, id, options = {}) {
  return harness.runCommand({
    id,
    fixture: definition.name,
    command: "npm",
    args: ["run", "db:migrate"],
    cwd: fixtureAppDir(harness, definition),
    env: { ...fixtureEnv(definition), ...(options.env ?? {}) },
    required: options.required ?? true,
    allowFailure: options.allowFailure ?? false,
  });
}

function buildFixture(harness, definition, id, required = true) {
  return harness.runCommand({
    id,
    fixture: definition.name,
    command: "npm",
    args: ["run", "build"],
    cwd: fixtureAppDir(harness, definition),
    env: fixtureEnv(definition),
    required,
  }).result.durationMs;
}

function exercisePreMigrationFaults(harness, definition) {
  if (harness.runtime.faultMatrix.some(({ id }) => id === "database-url-missing")) return;
  const missingDatabase = migrate(harness, definition, `${definition.name}:fault-database-url-missing`, {
    env: { DATABASE_URL: "" },
    required: false,
    allowFailure: true,
  });
  harness.recordFault(
    "database-url-missing",
    missingDatabase.result.exitCode !== 0,
    missingDatabase.result.exitCode !== 0
      ? "Migration refused an empty DATABASE_URL before application start."
      : "Migration unexpectedly accepted an empty DATABASE_URL.",
    definition.name,
  );

  let staleDetected = false;
  const appDir = fixtureAppDir(harness, definition);
  const packagePath = path.join(appDir, "package.json");
  const baselinePackage = readFileSync(packagePath);
  try {
    patchPackageFile(appDir, harness.runtime.targetArtifacts);
    assertInstalledTrain(
      appDir,
      harness.runtime.targetArtifacts,
      PROOF_TARGET_VERSION,
    );
  } catch {
    staleDetected = true;
  } finally {
    writeFileSync(packagePath, baselinePackage);
  }
  harness.recordFault(
    "stale-lockfile",
    staleDetected,
    staleDetected
      ? "Target 0.1.1 package manifest paired with the 0.1.0 lockfile was rejected."
      : "Target package manifest with stale baseline lockfile was accepted.",
    definition.name,
  );

  let hashDetected = false;
  try {
    const [first, ...remaining] = harness.runtime.targetArtifacts;
    assertArtifactHashes([{ ...first, expectedSha256: "0".repeat(64) }, ...remaining]);
  } catch {
    hashDetected = true;
  }
  harness.recordFault(
    "unexpected-tarball-hash",
    hashDetected,
    hashDetected ? "Unexpected expected/actual tarball hash rejected before installation." : "Hash mismatch was accepted.",
    definition.name,
  );
}

function secondMigrationNoop(harness, definition, id, required = true) {
  const before = databaseFingerprints(harness, definition);
  migrate(harness, definition, id, { required });
  const after = databaseFingerprints(harness, definition);
  return Object.keys(before).every((key) => before[key] === after[key]);
}

function exerciseBuildFailure(harness, definition) {
  const markerBuild = assertPathWithin(harness.options.workDir, harness.paths.markerBuild);
  if (existsSync(markerBuild)) {
    const marker = parseBuildMarker(readJson(markerBuild), harness.state.runId);
    const markerRuntime = harness.runtime.fixtures[marker.fixture];
    const command = markerRuntime?.commands.find(
      ({ id }) => id === marker.commandId,
    );
    if (
      marker.runId !== harness.state.runId
      || !markerRuntime
      || !command
      || command.exitCode === 0
    ) {
      throw new ProofBlockedError("Build fault marker is not bound to this run and journal", "fault-build");
    }
    harness.recordFault(
      "build-failure-after-migration",
      true,
      "Injected post-migration build failure was observed before exact rollback.",
      marker.fixture,
    );
    return true;
  }
  if (process.env.FAIL_BUILD_AFTER_MIGRATION !== "1") {
    harness.recordFault(
      "build-failure-after-migration",
      false,
      "FAIL_BUILD_AFTER_MIGRATION=1 was not exercised.",
      definition.name,
    );
    return false;
  }
  const appDir = fixtureAppDir(harness, definition);
  const failureFile = path.join(appDir, "server/proof-injected-build-failure.ts");
  assertPathWithin(appDir, failureFile);
  if (existsSync(failureFile)) {
    throw new ProofBlockedError(`Build failure injection file already exists for ${definition.name}`, "fault-build");
  }
  writeFileSync(failureFile, "export const forcedBuildFailure: = true;\n", "utf8");
  let failure;
  try {
    failure = harness.runCommand({
      id: `${definition.name}:fault-build-after-migration`,
      fixture: definition.name,
      command: "npm",
      args: ["run", "build"],
      cwd: appDir,
      env: { ...fixtureEnv(definition), FAIL_BUILD_AFTER_MIGRATION: "1" },
      required: false,
      allowFailure: true,
    });
  } finally {
    rmSync(failureFile, { force: true });
  }
  if (failure.result.exitCode === 0) {
    harness.recordFault("build-failure-after-migration", false, "Failure injection did not fail.", definition.name);
    return false;
  }
  atomicWriteJson(markerBuild, {
    runId: harness.state.runId,
    fixture: definition.name,
    commandId: failure.result.id,
    exitCode: failure.result.exitCode,
    injectedAt: nowIso(),
  });
  harness.recordFault(
    "build-failure-after-migration",
    true,
    `Injected build gate exited ${failure.result.exitCode} after target migration.`,
    definition.name,
  );
  return true;
}

async function startNominalColdUpdate(harness, definition) {
  const runtime = harness.runtime.fixtures[definition.name];
  beginMutationEpoch(harness, definition, "cold-update");
  runtime.updateStartedAtMs = Date.now();
  const coldCache = assertPathWithin(
    harness.options.workDir,
    path.join(harness.options.workDir, "cold-npm-cache", definition.name),
  );
  journalColdCacheBefore(harness, definition, coldCache);
  installTrain(
    harness,
    definition,
    harness.runtime.targetArtifacts,
    `${definition.name}:install-target`,
    { version: PROOF_TARGET_VERSION, cacheDir: coldCache },
  );
  journalColdCacheAfter(harness, definition, coldCache);
  generateMigration(
    harness,
    definition,
    `${definition.name}:migration-generate-target`,
    "stormstack-consent-0.1.1",
    { additiveGateId: `${definition.name}:verify-consent-additive-migration-target` },
  );
  migrate(harness, definition, `${definition.name}:migrate-target`);
  buildFixture(harness, definition, `${definition.name}:build-target`);
  await startFixtureProcesses(harness, definition, `${definition.name}:start-target`);
  harness.persist();
}

async function runWarmUpdate(harness, definition) {
  const runtime = harness.runtime.fixtures[definition.name];
  if (runtime.warmCompleted) return;
  beginMutationEpoch(harness, definition, "warm-reset");
  const reset = nextRecoveryAttempt(harness, definition, "warm-reset", "-before-warm");
  const restored = await rollbackFixture(harness, definition, {
    idSuffix: reset.suffix,
    recordRecovery: false,
  });
  if (!restored) throw new Error(`Baseline reset before warm update differs for ${definition.name}`);
  recordRecoveryEpoch(harness, definition, reset, restored);
  beginMutationEpoch(harness, definition, "warm-update");
  runtime.warmStartedAtMs = Date.now();
  const warmCache = assertPathWithin(
    harness.options.workDir,
    path.join(harness.options.workDir, "cold-npm-cache", definition.name),
  );
  journalWarmCacheBefore(harness, definition, warmCache);
  installTrain(harness, definition, harness.runtime.targetArtifacts, `${definition.name}:install-target-warm`, {
    version: PROOF_TARGET_VERSION,
    required: true,
    cacheDir: warmCache,
  });
  journalWarmCacheAfter(harness, definition, warmCache);
  generateMigration(harness, definition, `${definition.name}:migration-generate-target-warm`, "stormstack-consent-0.1.1-warm", {
    required: true,
    additiveGateId: `${definition.name}:verify-consent-additive-migration-target-warm`,
  });
  migrate(harness, definition, `${definition.name}:migrate-target-warm`, { required: true });
  buildFixture(harness, definition, `${definition.name}:build-target-warm`, true);
  await startFixtureProcesses(harness, definition, `${definition.name}:start-target-warm`);
  const sentinels = await journalVerification(harness, definition, "target-warm", `${definition.name}:verify-target-warm`);
  runtime.sentinels = { ...runtime.sentinels, ...sentinels };
  runtime.warmMigrationNoop = secondMigrationNoop(harness, definition, `${definition.name}:migrate-target-warm-noop`, true);
  await stopFixtureProcesses(harness, definition, `${definition.name}:stop-target-warm`);
  runtime.timings.updateWarmMs = Date.now() - runtime.warmStartedAtMs;
  runtime.changedFiles = classifyUpdateChanges(
    diffFileManifests(runtime.beforeUpdateFiles, fileManifest(fixtureAppDir(harness, definition))),
  );
  runtime.warmCompleted = true;
  completeMutationEpoch(harness, definition, "target");
  harness.persist();
}

async function recoverFixtureAfterFailure(harness, definition, fallbackPhase = "outer-failure") {
  const runtime = harness.runtime.fixtures[definition.name];
  const hasBackup = existsSync(path.join(backupPath(harness, definition), "backup-manifest.json"));
  if (!hasBackup || !needsRecovery(runtime)) return false;
  const descriptor = nextRecoveryAttempt(harness, definition, fallbackPhase);
  await stopFixtureIfRunning(
    harness,
    definition,
    `${definition.name}:stop-before${descriptor.suffix}`,
  );
  await stopPersistedFixtureProcesses(harness, definition);
  const exact = await rollbackFixture(harness, definition, {
    idSuffix: descriptor.suffix,
    recordRecovery: false,
  });
  recordRecoveryEpoch(harness, definition, descriptor, exact);
  if (!exact) throw new Error(`Failure recovery fingerprints differ for ${definition.name}`);
  return true;
}

async function recoverAllFixturesAfterFailure(harness, options = {}) {
  const failures = [];
  for (const runtime of Object.values(harness.runtime.fixtures)) {
    const recoveryWasRequired = needsRecovery(runtime);
    try {
      const recovered = await recoverFixtureAfterFailure(
        harness,
        runtime.definition,
        "outer-proof-failure",
      );
      if (options.requireAllNonBaseline && recoveryWasRequired && !recovered) {
        throw new Error("exact recovery was required but no verified backup was available");
      }
    } catch (error) {
      failures.push(`${runtime.definition.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) throw new Error(`Outer recovery failed: ${failures.join("; ")}`);
}

export async function settleTerminalVerdict(harness, terminalReport, dependencies = {}) {
  if (terminalReport.pass) {
    harness.state.status = "passed";
    return { report: terminalReport, exitStatus: 0 };
  }
  const recover = dependencies.recover ?? ((targetHarness) => recoverAllFixturesAfterFailure(
    targetHarness,
    { requireAllNonBaseline: true },
  ));
  const buildBlocked = dependencies.buildBlocked ?? buildStoppedReport;
  const buildRecoveredFail = dependencies.buildRecoveredFail ?? ((targetHarness, originalReport) => {
    const verdictError = new Error(originalReport.error ?? "The terminal evidence did not qualify for PASS.");
    verdictError.step = originalReport.stoppedAtStep ?? "proof-verdict";
    return buildStoppedReport(targetHarness, verdictError, false);
  });
  try {
    await recover(harness);
  } catch (error) {
    const blockedError = new ProofBlockedError(
      `Final FAIL recovery did not complete: ${error instanceof Error ? error.message : String(error)}`,
      "terminal-fail-recovery",
    );
    harness.state.status = "blocked";
    return {
      report: buildBlocked(harness, blockedError, true),
      exitStatus: 2,
    };
  }
  harness.state.status = "failed";
  return {
    report: buildRecoveredFail(harness, terminalReport),
    exitStatus: 1,
  };
}

async function runFixture(harness, definition) {
  const name = definition.name;
  const runtime = harness.runtime.fixtures[name];
  const appDir = fixtureAppDir(harness, definition);
  if (harness.options.resume && existsSync(appDir)) harness.verifyResumeHashes(name, appDir);

  try {
    if (!harness.hasStep(name, "generated")) generateFixture(harness, definition);
    if (!harness.hasStep(name, "customized")) {
      customizeFixture(appDir, definition);
      harness.completeStep(name, "customized", appDir);
    }

    await startPostgres(harness, definition);

    if (!harness.hasStep(name, "baseline-verified")) {
      runtime.timings.installMs = installTrain(
        harness,
        definition,
        harness.runtime.sourceArtifacts,
        `${name}:install-baseline`,
        { version: PROOF_BASE_VERSION },
      );
      if (definition.hasCrm) {
        generateMigration(
          harness,
          definition,
          `${name}:business-migration-prior`,
          "beta-business-prior",
          { config: "proof/drizzle-business.config.ts", required: false },
        );
      }
      generateMigration(
        harness,
        definition,
        `${name}:migration-generate-baseline`,
        "stormstack-baseline-0.1.0",
      );
      migrate(harness, definition, `${name}:migrate-baseline`);
      buildFixture(harness, definition, `${name}:build-baseline`);
      await startFixtureProcesses(harness, definition, `${name}:start-baseline`);
      const baselineSentinels = await journalVerification(
        harness,
        definition,
        "baseline",
        `${name}:verify-baseline`,
      );
      runtime.sentinels = { ...runtime.sentinels, ...baselineSentinels };
      await stopFixtureProcesses(harness, definition, `${name}:stop-baseline`);
      runtime.beforeUpdateFiles = backupClientFiles(appDir);
      runtime.timings.generationMs = Date.now() - runtime.generationStartedAtMs;
      runtime.baselineSnapshot = recoverySnapshot(harness, definition);
      harness.persist();
      harness.completeStep(name, "baseline-verified", appDir);
    }

    if (!harness.hasStep(name, "stopped")) harness.completeStep(name, "stopped", appDir);

    if (!harness.hasStep(name, "backed-up")) {
      const snapshot = backupFixture(harness, definition);
      if (JSON.stringify(snapshot) !== JSON.stringify(runtime.baselineSnapshot)) {
        throw new ProofBlockedError(`Baseline drifted before backup for ${name}`, "backup");
      }
      harness.completeStep(name, "backed-up", appDir);
      setCurrentTrain(harness, definition, "baseline");
    }

    exercisePreMigrationFaults(harness, definition);

    if (!harness.hasStep(name, "installed")) {
      beginMutationEpoch(harness, definition, "fault-update");
      installTrain(
        harness,
        definition,
        harness.runtime.targetArtifacts,
        `${name}:fault-install-target`,
        { version: PROOF_TARGET_VERSION, required: false },
      );
      harness.completeStep(name, "installed", appDir);
      const interruptionMarker = assertPathWithin(harness.options.workDir, harness.paths.markerInterrupted);
      if (process.env.FAIL_AFTER_INSTALL === "1" && !existsSync(interruptionMarker)) {
        atomicWriteJson(interruptionMarker, {
          runId: harness.state.runId,
          fixture: name,
          interruptedAt: nowIso(),
        });
        harness.state.fixtures[name].hashes.faultMarker = sha256File(interruptionMarker);
        harness.persist();
        harness.preserveForResume = true;
        throw new InjectedInterruption(name);
      }
    }

    const interruptionMarker = assertPathWithin(harness.options.workDir, harness.paths.markerInterrupted);
    if (existsSync(interruptionMarker)) {
      const marker = parseInterruptionMarker(
        readJson(interruptionMarker),
        harness.state.runId,
      );
      const resumedPastInstall = harness.options.resume && harness.hasStep(marker.fixture, "installed");
      harness.recordFault(
        "interrupted-after-install",
        resumedPastInstall,
        resumedPastInstall
          ? `Resumed ${marker.fixture} from its verified installed checkpoint without replaying installation.`
          : "Interruption marker exists but this process did not resume it.",
        marker.fixture,
      );
    } else if (!harness.runtime.faultMatrix.some(({ id }) => id === "interrupted-after-install")) {
      harness.recordFault(
        "interrupted-after-install",
        false,
        "FAIL_AFTER_INSTALL=1 followed by --resume was not exercised.",
        name,
      );
    }

    if (!harness.hasStep(name, "migration-generated")) {
      const duration = generateMigration(
        harness,
        definition,
        `${name}:fault-migration-generate-target`,
        "stormstack-consent-0.1.1-fault",
        {
          required: false,
          additiveGateId: `${name}:fault-verify-consent-additive-migration-target`,
        },
      );
      runtime.timings.migrationMs += duration;
      harness.completeStep(name, "migration-generated", appDir);
    }

    if (!harness.hasStep(name, "migrated")) {
      const result = migrate(harness, definition, `${name}:fault-migrate-target`, { required: false });
      runtime.timings.migrationMs += result.result.durationMs;
      harness.completeStep(name, "migrated", appDir);
    }

    if (!harness.hasStep(name, "started")) {
      exerciseBuildFailure(harness, definition);
      const faultRecovery = nextRecoveryAttempt(harness, definition, "fault-update", "");
      const recovered = await rollbackFixture(harness, definition, { idSuffix: "" });
      if (!recovered) throw new Error(`Rollback fingerprints differ for ${name}`);
      recordRecoveryEpoch(harness, definition, faultRecovery, recovered);
      await startNominalColdUpdate(harness, definition);
      harness.completeStep(name, "started", appDir);
    } else if (!harness.hasStep(name, "verified") && !harness.processes.has(name)) {
      throw new ProofBlockedError(`Cannot resume an active nominal lifecycle for ${name}`, "lifecycle");
    }

    if (!harness.hasStep(name, "verified")) {
      const verifyStarted = Date.now();
      const targetSentinels = await journalVerification(
        harness,
        definition,
        "target",
        `${name}:verify-target`,
      );
      runtime.timings.testsMs = Date.now() - verifyStarted;
      runtime.sentinels = { ...runtime.sentinels, ...targetSentinels };
      const nominalNoop = secondMigrationNoop(harness, definition, `${name}:migrate-target-noop`);
      runtime.migrationNoop = nominalNoop;
      const nominalChanges = classifyUpdateChanges(diffFileManifests(runtime.beforeUpdateFiles, fileManifest(appDir)));
      runtime.changedFiles = nominalChanges;
      harness.recordFault(
        `migration-noop-${name}`,
        nominalNoop,
        nominalNoop ? "Second nominal target migration left schema/data/sequences unchanged." : "Second target migration changed a fingerprint.",
        name,
      );
      harness.recordFault(
        `customizations-preserved-${name}`,
        nominalChanges.forbidden.length === 0 && targetSentinels.businessCustomization,
        nominalChanges.forbidden.length === 0
          ? "Rollback and nominal update preserved all client-owned files."
          : `Forbidden changes: ${nominalChanges.forbidden.join(", ")}`,
        name,
      );
      harness.persist();
      harness.completeStep(name, "verified", appDir);
    }

    if (!harness.hasStep(name, "stopped-final")) {
      if (harness.processes.has(name)) {
        await stopFixtureProcesses(harness, definition, `${name}:stop-target`);
      } else if (!runtime.commands.some(({ id }) => id === `${name}:stop-target`)) {
        throw new ProofBlockedError(`Target process lifecycle missing final stop for ${name}`, "lifecycle");
      }
      runtime.timings.updateColdMs = Date.now() - runtime.updateStartedAtMs;
      completeMutationEpoch(harness, definition, "target");
      await runWarmUpdate(harness, definition);
      if (!runtime.warmMigrationNoop) throw new Error(`Warm migration was not a no-op for ${name}`);
      if (runtime.changedFiles.forbidden.length > 0) {
        throw new Error(`Warm update changed client-owned files: ${runtime.changedFiles.forbidden.join(", ")}`);
      }
      harness.persist();
      harness.completeStep(name, "stopped-final", appDir);
    }
  } catch (error) {
    if (error instanceof InjectedInterruption) throw error;
    await stopFixtureIfRunning(harness, definition, `${name}:stop-on-error`);
    try {
      await recoverFixtureAfterFailure(harness, definition, "fixture-failure");
    } catch (rollbackError) {
      const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`${error instanceof Error ? error.message : String(error)}; rollback also failed: ${message}`);
    }
    throw error;
  }
}

async function proveConcurrentIsolation(harness) {
  const definitions = Object.values(harness.runtime.fixtures).map(({ definition }) => definition);
  const [alpha, beta] = definitions;
  if (!alpha || !beta) throw new ProofBlockedError("Concurrent proof requires Alpha and Beta", "concurrency");
  beginMutationEpoch(harness, alpha, "concurrent-proof");
  beginMutationEpoch(harness, beta, "concurrent-proof");
  try {
    await startFixtureProcesses(harness, alpha, "alpha:start-concurrent");
    await startFixtureProcesses(harness, beta, "beta:start-concurrent");
    await verifyConcurrentFixtures(harness, definitions);
  } finally {
    if (harness.processes.has(beta.name)) {
      await stopFixtureProcesses(harness, beta, "beta:stop-concurrent", false);
    }
    if (harness.processes.has(alpha.name)) {
      await stopFixtureProcesses(harness, alpha, "alpha:stop-concurrent", false);
    }
  }
  completeMutationEpoch(harness, alpha, "target");
  completeMutationEpoch(harness, beta, "target");
}

async function executeProof(options) {
  const harness = new ProofHarness(options);
  let report;
  let exitStatus = 1;
  let initialized = false;
  try {
    harness.initialize();
    initialized = true;
    ensureArtifacts(harness);
    for (const runtime of Object.values(harness.runtime.fixtures)) {
      await runFixture(harness, runtime.definition);
    }
    await proveConcurrentIsolation(harness);
    const settled = await settleTerminalVerdict(harness, buildTerminalReport(harness));
    report = settled.report;
    exitStatus = settled.exitStatus;
  } catch (error) {
    let terminalError = error;
    if (!(error instanceof InjectedInterruption) && harness.state && harness.runtime) {
      try {
        await recoverAllFixturesAfterFailure(harness);
      } catch (recoveryError) {
        terminalError = new Error(
          `${error instanceof Error ? error.message : String(error)}; ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
        );
      }
    }
    const blocked = terminalError instanceof ProofBlockedError;
    report = harness.state && harness.runtime
      ? buildStoppedReport(harness, terminalError, blocked)
      : buildEmergencyReport(options, terminalError);
    if (harness.state) harness.state.status = blocked ? "blocked" : "failed";
    exitStatus = blocked ? 2 : 1;
  }

  if (harness.state && harness.runtime) {
    try {
      harness.persist();
    } catch (error) {
      report = buildStoppedReport(harness, new ProofBlockedError(
        `Unable to persist terminal checkpoint: ${error instanceof Error ? error.message : String(error)}`,
        "persist-terminal",
      ), true);
      harness.state.status = "blocked";
      exitStatus = 2;
    }
  }

  if (!harness.preserveForResume) {
    let cleanup;
    try {
      cleanup = initialized
        ? await cleanupHarness(harness)
        : await cleanupAbandonedProof(options);
    } catch (error) {
      cleanup = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    if (!cleanup.ok) {
      const cleanupError = new ProofBlockedError(`Cleanup did not complete: ${cleanup.detail}`, "cleanup");
      report = harness.state && harness.runtime
        ? buildStoppedReport(harness, cleanupError, true)
        : buildEmergencyReport(options, cleanupError);
      if (harness.state) harness.state.status = "blocked";
      exitStatus = 2;
      if (harness.state && harness.runtime) {
        try {
          harness.persist();
        } catch {
          // The BLOCKED report remains the terminal fail-closed artifact.
        }
      }
    }
  }

  const validated = writeProofReport(harness, report);
  return { report: validated, exitStatus };
}

async function main() {
  let options;
  try {
    options = parseProofArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  try {
    const { report, exitStatus } = await executeProof(options);
    console.log(`${report.status}: ${path.join(options.outputDir, "proof-report.json")}`);
    process.exitCode = exitStatus;
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(SCRIPT_PATH)) {
  void main();
}
