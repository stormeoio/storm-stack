// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  computeProofPass,
  parseProofReport,
  parseProofState,
  PROOF_BASE_VERSION,
  PROOF_SCHEMA_VERSION,
  PROOF_TARGET_VERSION,
  REQUIRED_FAULT_IDS,
  REQUIRED_GLOBAL_COMMAND_IDS,
  REQUIRED_RELEASE_PACKAGES,
  requiredFixtureCommandIds,
} from "./proof-model.mjs";

const timestamp = "2026-08-09T02:00:00.000Z";
const hash = createHash("sha256").update("storm-stack-proof").digest("hex");
const baseCommit = "a".repeat(40);
const targetCommit = "b".repeat(40);

function command(id, exitCode = 0) {
  return {
    id,
    command: `npm run ${id}`,
    startedAt: timestamp,
    finishedAt: timestamp,
    durationMs: 1,
    exitCode,
    required: true,
    attempt: 1,
    logPath: `/tmp/proof/${id}.log`,
  };
}

function snapshot() {
  return {
    packageTree: hash,
    drizzleTree: hash,
    schemaFingerprint: hash,
    dataFingerprint: hash,
    sequencesFingerprint: hash,
  };
}

function fixture(name, offset) {
  return {
    name,
    composeProjectName: `stormstack-proof-${name}`,
    postgresPort: 54_320 + offset,
    serverPort: 30_000 + offset,
    clientPort: 51_730 + offset,
    databaseName: `stormapp_${name}`,
    volumeName: `stormstack-proof-${name}-pgdata`,
    timings: {
      generationMs: 10,
      installMs: 10,
      migrationMs: 10,
      testsMs: 10,
      updateWarmMs: 100,
      updateColdMs: 200,
    },
    commands: requiredFixtureCommandIds(name).map((id) => command(id)),
    changedFiles: { allowed: ["package-lock.json"], forbidden: [] },
    sentinels: {
      auth: true,
      consentBaseline: true,
      consentWithdrawn: true,
      businessCustomization: true,
      csrfNegative: true,
    },
    migrationNoop: true,
    warmCompleted: true,
    warmMigrationNoop: true,
    mutationSettled: true,
    cache: {
      coldBefore: { path: `/tmp/proof/cache-${name}`, exists: false, fileCount: 0 },
      coldAfter: { path: `/tmp/proof/cache-${name}`, exists: true, fileCount: 2, hash },
      warmBefore: { path: `/tmp/proof/cache-${name}`, exists: true, fileCount: 2, hash },
      warmAfter: { path: `/tmp/proof/cache-${name}`, exists: true, fileCount: 3, hash },
    },
    recovery: {
      attempted: true,
      before: snapshot(),
      after: snapshot(),
      appRestarted: true,
    },
    recoveryHistory: [
      { epoch: 1, phase: "fault-update", attempt: 1, suffix: "", exact: true, finishedAt: timestamp },
      { epoch: 3, phase: "warm-reset", attempt: 2, suffix: "-before-warm", exact: true, finishedAt: timestamp },
    ],
  };
}

function artifact(name, version, commit) {
  return {
    name,
    version,
    workspace: name === "create-storm-app" ? "packages/create-storm-app" : `packages/${name.split("/").at(-1)}`,
    filename: `${name.replace("@stormstack/", "stormstack-")}-${version}.tgz`,
    tarballPath: `/tmp/proof/${name.replace("@stormstack/", "stormstack-")}-${version}.tgz`,
    commit,
    expectedSha256: hash,
    actualSha256: hash,
  };
}

function validReport() {
  return {
    schemaVersion: PROOF_SCHEMA_VERSION,
    runId: "proof-1",
    status: "PASS",
    pass: true,
    startedAt: timestamp,
    finishedAt: timestamp,
    nodeVersion: "20.20.2",
    platform: "darwin-arm64",
    cacheMode: "mixed",
    baseRef: "proof/consent-v0.1.0",
    targetRef: "target",
    baseCommit,
    targetCommit,
    sourceArtifacts: REQUIRED_RELEASE_PACKAGES.map((name) => artifact(name, PROOF_BASE_VERSION, baseCommit)),
    targetArtifacts: REQUIRED_RELEASE_PACKAGES.map((name) => artifact(name, PROOF_TARGET_VERSION, targetCommit)),
    commands: REQUIRED_GLOBAL_COMMAND_IDS.map((id) => command(id)),
    fixtures: [fixture("alpha", 1), fixture("beta", 2)],
    faultMatrix: REQUIRED_FAULT_IDS.map((id) => ({ id, passed: true, detail: "ok" })),
  };
}

describe("proofStateSchema", () => {
  function state() {
    return {
      schemaVersion: 1,
      runId: "proof-1",
      portBase: 47_000,
      status: "running",
      baseRef: "base",
      targetRef: "target",
      startedAt: timestamp,
      updatedAt: timestamp,
      fixtures: {
        alpha: { completedSteps: ["generated"], hashes: { package: hash }, updatedAt: timestamp },
        beta: { completedSteps: [], hashes: {}, updatedAt: timestamp },
      },
    };
  }

  it("accepts an ordered checkpoint prefix for both fixtures", () => {
    expect(parseProofState(state()).runId).toBe("proof-1");
  });

  it("rejects a missing fixture, malformed hash, duplicate or out-of-order step", () => {
    const missing = state();
    delete missing.fixtures.beta;
    expect(() => parseProofState(missing)).toThrow();

    const malformed = state();
    malformed.fixtures.alpha.hashes.package = "bad";
    expect(() => parseProofState(malformed)).toThrow();

    for (const steps of [["generated", "generated"], ["generated", "baseline-verified"]]) {
      const unordered = state();
      unordered.fixtures.alpha.completedSteps = steps;
      expect(() => parseProofState(unordered)).toThrow(/ordered prefix/);
    }
  });
});

describe("proofReportSchema", () => {
  it("accepts a complete report whose pass value is derived from evidence", () => {
    const report = validReport();
    expect(computeProofPass(report)).toBe(true);
    expect(parseProofReport(report).pass).toBe(true);
  });

  it.each([
    ["required command failure", (report) => { report.commands[0].exitCode = 1; }],
    ["required global command disguised as optional", (report) => {
      report.commands[0].required = false;
      report.commands[0].exitCode = 1;
    }],
    ["required fixture command disguised as optional", (report) => {
      report.fixtures[0].commands[0].required = false;
      report.fixtures[0].commands[0].exitCode = 1;
    }],
    ["missing lifecycle command", (report) => { report.fixtures[0].commands.pop(); }],
    ["missing concurrent evidence", (report) => { report.commands.pop(); }],
    ["missing Consent client API stability evidence", (report) => {
      report.commands = report.commands.filter(({ id }) => id !== "verify-consent-client-api-stability");
    }],
    ["missing immutable artifact revalidation evidence", (report) => {
      report.commands = report.commands.filter(({ id }) => id !== "revalidate-artifacts-target");
    }],
    ["missing warm lifecycle command", (report) => {
      report.fixtures[0].commands = report.fixtures[0].commands.filter(({ id }) => id !== "alpha:verify-target-warm");
    }],
    ["missing browser UI evidence", (report) => {
      report.fixtures[0].commands = report.fixtures[0].commands.filter(({ id }) => id !== "alpha:verify-ui-target");
    }],
    ["missing additive migration evidence", (report) => {
      report.fixtures[0].commands = report.fixtures[0].commands.filter(
        ({ id }) => id !== "alpha:verify-consent-additive-migration-target",
      );
    }],
    ["required command marked optional", (report) => { report.fixtures[0].commands[0].required = false; }],
    ["artifact hash mismatch", (report) => { report.targetArtifacts[0].actualSha256 = "c".repeat(64); }],
    ["incomplete package train", (report) => { report.sourceArtifacts.pop(); }],
    ["forbidden file", (report) => { report.fixtures[0].changedFiles.forbidden.push("client/src/App.tsx"); }],
    ["red sentinel", (report) => { report.fixtures[1].sentinels.businessCustomization = false; }],
    ["rollback mismatch", (report) => { report.fixtures[0].recovery.after.schemaFingerprint = "d".repeat(64); }],
    ["warm update timeout", (report) => { report.fixtures[0].timings.updateWarmMs = 15 * 60 * 1000; }],
    ["zero warm update", (report) => { report.fixtures[0].timings.updateWarmMs = 0; }],
    ["warm lifecycle incomplete", (report) => { report.fixtures[0].warmCompleted = false; }],
    ["warm migration changed state", (report) => { report.fixtures[0].warmMigrationNoop = false; }],
    ["mutation epoch unsettled", (report) => { report.fixtures[0].mutationSettled = false; }],
    ["cold cache was pre-populated", (report) => {
      report.fixtures[0].cache.coldBefore = { path: "/tmp/proof/cache-alpha", exists: true, fileCount: 1, hash };
    }],
    ["duplicated fixture", (report) => { report.fixtures[1].name = "alpha"; }],
    ["isolation collision", (report) => { report.fixtures[1].postgresPort = report.fixtures[0].serverPort; }],
    ["same source and target ref", (report) => { report.targetRef = report.baseRef; }],
    ["same source and target commit", (report) => { report.targetCommit = report.baseCommit; }],
    ["incomplete fault matrix", (report) => { report.faultMatrix.pop(); }],
    ["arbitrary fault", (report) => { report.faultMatrix[0].id = "invented"; }],
  ])("rejects incomplete PASS evidence: %s", (_label, mutate) => {
    const report = validReport();
    mutate(report);
    expect(computeProofPass(report)).toBe(false);
    expect(() => parseProofReport(report)).toThrow(/complete, verified proof evidence/);
  });

  it("represents an honest early BLOCKED report without fabricated fixtures", () => {
    const blocked = {
      schemaVersion: 1,
      runId: "proof-blocked",
      status: "BLOCKED",
      pass: false,
      startedAt: timestamp,
      finishedAt: timestamp,
      nodeVersion: "20.20.2",
      platform: "darwin-arm64",
      cacheMode: "mixed",
      baseRef: "missing-tag",
      targetRef: "HEAD",
      sourceArtifacts: [],
      targetArtifacts: [],
      commands: [],
      fixtures: [],
      faultMatrix: [],
      stoppedAtStep: "resolve-baseline",
      error: "Baseline tag is missing",
    };

    expect(parseProofReport(blocked)).toMatchObject({ status: "BLOCKED", pass: false });
    expect(computeProofPass(blocked)).toBe(false);
  });
});
