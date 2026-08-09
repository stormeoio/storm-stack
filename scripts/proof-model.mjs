import { z } from "zod";

export const PROOF_SCHEMA_VERSION = 1;
export const PROOF_BASE_VERSION = "0.1.0";
export const PROOF_TARGET_VERSION = "0.1.1";
export const PROOF_STEPS = [
  "generated",
  "customized",
  "baseline-verified",
  "stopped",
  "backed-up",
  "installed",
  "migration-generated",
  "migrated",
  "started",
  "verified",
  "stopped-final",
];
export const REQUIRED_RELEASE_PACKAGES = [
  "@stormstack/core",
  "@stormstack/react",
  "@stormstack/testing",
  "@stormstack/auth",
  "@stormstack/auth-social",
  "@stormstack/consent",
  "@stormstack/crm",
  "@stormstack/ticketing",
  "@stormstack/stripe",
  "@stormstack/cli",
  "create-storm-app",
];
export const REQUIRED_GLOBAL_COMMAND_IDS = [
  "resolve-baseline",
  "resolve-target",
  "pack-baseline",
  "release-acceptance-target",
  "pack-target",
  "verify-consent-client-api-stability",
  "revalidate-artifacts-baseline",
  "revalidate-artifacts-target",
  "verify-concurrent-isolation",
];
export const REQUIRED_FAULT_IDS = [
  "database-url-missing",
  "stale-lockfile",
  "interrupted-after-install",
  "build-failure-after-migration",
  "unexpected-tarball-hash",
  "migration-noop-alpha",
  "migration-noop-beta",
  "customizations-preserved-alpha",
  "customizations-preserved-beta",
];
export const REQUIRED_SENTINEL_IDS = [
  "auth",
  "consentBaseline",
  "consentWithdrawn",
  "businessCustomization",
];

export function requiredFixtureCommandIds(name) {
  return [
    `${name}:generate`,
    `${name}:install-baseline`,
    `${name}:migration-generate-baseline`,
    `${name}:migrate-baseline`,
    `${name}:build-baseline`,
    `${name}:start-baseline`,
    `${name}:verify-baseline`,
    `${name}:verify-ui-baseline`,
    `${name}:stop-baseline`,
    `${name}:backup`,
    `${name}:cold-cache-before`,
    `${name}:install-target`,
    `${name}:cold-cache-after`,
    `${name}:migration-generate-target`,
    `${name}:verify-consent-additive-migration-target`,
    `${name}:migrate-target`,
    `${name}:migrate-target-noop`,
    `${name}:build-target`,
    `${name}:start-target`,
    `${name}:verify-target`,
    `${name}:verify-ui-target`,
    `${name}:stop-target`,
    `${name}:rollback`,
    `${name}:start-rollback`,
    `${name}:verify-rollback`,
    `${name}:verify-ui-rollback`,
    `${name}:stop-rollback`,
    `${name}:rollback-before-warm`,
    `${name}:start-rollback-before-warm`,
    `${name}:verify-rollback-before-warm`,
    `${name}:verify-ui-rollback-before-warm`,
    `${name}:stop-rollback-before-warm`,
    `${name}:warm-cache-before`,
    `${name}:install-target-warm`,
    `${name}:warm-cache-after`,
    `${name}:migration-generate-target-warm`,
    `${name}:verify-consent-additive-migration-target-warm`,
    `${name}:migrate-target-warm`,
    `${name}:build-target-warm`,
    `${name}:start-target-warm`,
    `${name}:verify-target-warm`,
    `${name}:verify-ui-target-warm`,
    `${name}:migrate-target-warm-noop`,
    `${name}:stop-target-warm`,
  ];
}

const isoTimestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const gitCommit = z.string().regex(/^[a-f0-9]{40}$/);
const fixtureName = z.enum(["alpha", "beta"]);
const proofRunId = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/);

const proofFixtureStateSchema = z.object({
  completedSteps: z.array(z.enum(PROOF_STEPS)).refine(
    (steps) => steps.every((step, index) => PROOF_STEPS[index] === step),
    "completedSteps must be an ordered prefix of PROOF_STEPS",
  ),
  hashes: z.record(z.string(), sha256),
  updatedAt: isoTimestamp,
}).strict();

export const proofStateSchema = z.object({
  schemaVersion: z.literal(PROOF_SCHEMA_VERSION),
  runId: proofRunId,
  portBase: z.number().int().min(1024).max(65_522),
  status: z.enum(["running", "blocked", "failed", "passed"]),
  baseRef: z.string().min(1),
  targetRef: z.string().min(1),
  startedAt: isoTimestamp,
  updatedAt: isoTimestamp,
  fixtures: z.object({
    alpha: proofFixtureStateSchema,
    beta: proofFixtureStateSchema,
  }).strict(),
}).strict().refine((state) => state.baseRef !== state.targetRef, {
  path: ["targetRef"],
  message: "targetRef must differ from baseRef",
});

export const commandResultSchema = z.object({
  id: z.string().min(1),
  fixture: fixtureName.optional(),
  command: z.string().min(1),
  startedAt: isoTimestamp,
  finishedAt: isoTimestamp,
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int(),
  required: z.boolean().default(true),
  attempt: z.literal(1),
  logPath: z.string().min(1),
}).strict();

export const packageArtifactSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  workspace: z.string().min(1),
  filename: z.string().min(1),
  tarballPath: z.string().min(1),
  commit: gitCommit,
  expectedSha256: sha256,
  actualSha256: sha256,
}).strict();

const recoverySnapshotSchema = z.object({
  packageTree: sha256,
  drizzleTree: sha256,
  schemaFingerprint: sha256,
  dataFingerprint: sha256,
  sequencesFingerprint: sha256,
}).strict();

export const recoveryResultSchema = z.object({
  attempted: z.literal(true),
  before: recoverySnapshotSchema,
  after: recoverySnapshotSchema,
  appRestarted: z.boolean(),
}).strict();

const cacheSnapshotSchema = z.object({
  path: z.string().min(1),
  exists: z.boolean(),
  fileCount: z.number().int().nonnegative(),
  hash: sha256.optional(),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.exists !== Boolean(snapshot.hash) || (!snapshot.exists && snapshot.fileCount !== 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "cache existence, hash and file count are inconsistent",
    });
  }
});

const recoveryEpochSchema = z.object({
  epoch: z.number().int().positive(),
  phase: z.string().min(1),
  attempt: z.number().int().positive(),
  suffix: z.string(),
  exact: z.boolean(),
  finishedAt: isoTimestamp,
}).strict();

export const fixtureReportSchema = z.object({
  name: fixtureName,
  composeProjectName: z.string().min(1),
  postgresPort: z.number().int().min(1024).max(65_535),
  serverPort: z.number().int().min(1024).max(65_535),
  clientPort: z.number().int().min(1024).max(65_535),
  databaseName: z.string().regex(/^[a-z][a-z0-9_]*$/),
  volumeName: z.string().min(1),
  timings: z.object({
    generationMs: z.number().int().nonnegative(),
    installMs: z.number().int().nonnegative(),
    migrationMs: z.number().int().nonnegative(),
    testsMs: z.number().int().nonnegative(),
    updateWarmMs: z.number().int().nonnegative(),
    updateColdMs: z.number().int().nonnegative(),
  }).strict(),
  commands: z.array(commandResultSchema).min(1),
  changedFiles: z.object({
    allowed: z.array(z.string()),
    forbidden: z.array(z.string()),
  }).strict(),
  sentinels: z.record(z.string(), z.boolean()),
  migrationNoop: z.boolean(),
  warmCompleted: z.boolean(),
  warmMigrationNoop: z.boolean(),
  mutationSettled: z.boolean(),
  cache: z.object({
    coldBefore: cacheSnapshotSchema,
    coldAfter: cacheSnapshotSchema,
    warmBefore: cacheSnapshotSchema,
    warmAfter: cacheSnapshotSchema,
  }).strict(),
  recovery: recoveryResultSchema,
  recoveryHistory: z.array(recoveryEpochSchema).min(2),
}).strict();

export const faultResultSchema = z.object({
  id: z.string().min(1),
  fixture: fixtureName.optional(),
  passed: z.boolean(),
  detail: z.string().min(1),
}).strict();

const commonReportFields = {
  schemaVersion: z.literal(PROOF_SCHEMA_VERSION),
  runId: z.string().min(1),
  startedAt: isoTimestamp,
  finishedAt: isoTimestamp,
  nodeVersion: z.string().min(1),
  platform: z.string().min(1),
  cacheMode: z.enum(["warm", "cold", "mixed"]),
  baseRef: z.string().min(1),
  targetRef: z.string().min(1),
};

const evidenceFields = {
  baseCommit: gitCommit.optional(),
  targetCommit: gitCommit.optional(),
  sourceArtifacts: z.array(packageArtifactSchema),
  targetArtifacts: z.array(packageArtifactSchema),
  commands: z.array(commandResultSchema),
  fixtures: z.array(fixtureReportSchema).max(2),
  faultMatrix: z.array(faultResultSchema).max(REQUIRED_FAULT_IDS.length),
};

const passReportSchema = z.object({
  ...commonReportFields,
  ...evidenceFields,
  status: z.literal("PASS"),
  pass: z.literal(true),
  baseCommit: gitCommit,
  targetCommit: gitCommit,
}).strict();

const stoppedReportFields = {
  ...commonReportFields,
  ...evidenceFields,
  pass: z.literal(false),
  stoppedAtStep: z.string().min(1),
  error: z.string().min(1),
};

const failReportSchema = z.object({
  ...stoppedReportFields,
  status: z.literal("FAIL"),
}).strict();

const blockedReportSchema = z.object({
  ...stoppedReportFields,
  status: z.literal("BLOCKED"),
}).strict();

function uniqueStrings(values) {
  return new Set(values).size === values.length;
}

function containsRequiredIds(actual, required) {
  return uniqueStrings(actual)
    && actual.length >= required.length
    && required.every((id) => actual.includes(id));
}

function snapshotsMatch(recovery) {
  return recovery.attempted
    && recovery.appRestarted
    && Object.keys(recovery.before).every((key) => recovery.before[key] === recovery.after[key]);
}

function artifactsAreConsistent(report) {
  const sourceNames = report.sourceArtifacts.map(({ name }) => name);
  const targetNames = report.targetArtifacts.map(({ name }) => name);
  const expectedNames = REQUIRED_RELEASE_PACKAGES;
  const sourceVersions = new Set(report.sourceArtifacts.map(({ version }) => version));
  const targetVersions = new Set(report.targetArtifacts.map(({ version }) => version));

  return (
    uniqueStrings(sourceNames)
    && uniqueStrings(targetNames)
    && sourceNames.length === expectedNames.length
    && targetNames.length === expectedNames.length
    && expectedNames.every((name) => sourceNames.includes(name) && targetNames.includes(name))
    && sourceVersions.size === 1
    && targetVersions.size === 1
    && report.sourceArtifacts.every((artifact) => (
      artifact.version === PROOF_BASE_VERSION
      && artifact.commit === report.baseCommit
      && artifact.expectedSha256 === artifact.actualSha256
    ))
    && report.targetArtifacts.every((artifact) => (
      artifact.version === PROOF_TARGET_VERSION
      && artifact.commit === report.targetCommit
      && artifact.expectedSha256 === artifact.actualSha256
    ))
  );
}

function fixturesAreIsolated(fixtures) {
  const names = fixtures.map(({ name }) => name);
  const composeNames = fixtures.map(({ composeProjectName }) => composeProjectName);
  const databaseNames = fixtures.map(({ databaseName }) => databaseName);
  const volumeNames = fixtures.map(({ volumeName }) => volumeName);
  const ports = fixtures.flatMap(({ postgresPort, serverPort, clientPort }) => (
    [postgresPort, serverPort, clientPort]
  ));

  return (
    fixtures.length === 2
    && uniqueStrings(names)
    && names.includes("alpha")
    && names.includes("beta")
    && uniqueStrings(composeNames)
    && uniqueStrings(databaseNames)
    && uniqueStrings(volumeNames)
    && new Set(ports).size === ports.length
  );
}

function commandJournalPasses(commands, requiredIds) {
  const commandIds = commands.map(({ id }) => id);
  const commandById = new Map(commands.map((command) => [command.id, command]));
  return containsRequiredIds(commandIds, requiredIds)
    && requiredIds.every((id) => (
      commandById.get(id)?.required === true
      && commandById.get(id)?.exitCode === 0
    ))
    && commands.every((command) => !command.required || command.exitCode === 0)
    && commands.every((command) => command.attempt === 1);
}

function faultMatrixPasses(faultMatrix) {
  const actual = faultMatrix.map(({ id }) => id);
  return actual.length === REQUIRED_FAULT_IDS.length
    && containsRequiredIds(actual, REQUIRED_FAULT_IDS)
    && faultMatrix.every(({ passed }) => passed);
}

export function computeProofPass(report) {
  if (
    report.status !== "PASS"
    || report.pass !== true
    || !report.baseCommit
    || !report.targetCommit
    || report.baseRef === report.targetRef
    || report.baseCommit === report.targetCommit
    || report.cacheMode !== "mixed"
    || !artifactsAreConsistent(report)
    || !commandJournalPasses(report.commands, REQUIRED_GLOBAL_COMMAND_IDS)
    || !fixturesAreIsolated(report.fixtures)
    || !faultMatrixPasses(report.faultMatrix)
  ) {
    return false;
  }

  return report.fixtures.every((fixture) => (
    fixture.timings.updateWarmMs > 0
    && fixture.timings.updateWarmMs < 15 * 60 * 1000
    && commandJournalPasses(fixture.commands, requiredFixtureCommandIds(fixture.name))
    && fixture.changedFiles.forbidden.length === 0
    && REQUIRED_SENTINEL_IDS.every((id) => fixture.sentinels[id] === true)
    && Object.values(fixture.sentinels).every(Boolean)
    && fixture.migrationNoop
    && fixture.warmCompleted
    && fixture.warmMigrationNoop
    && fixture.mutationSettled
    && fixture.cache.coldBefore.exists === false
    && fixture.cache.coldBefore.fileCount === 0
    && fixture.cache.coldAfter.exists
    && fixture.cache.coldAfter.fileCount > 0
    && fixture.cache.warmBefore.exists
    && fixture.cache.warmBefore.hash === fixture.cache.coldAfter.hash
    && fixture.cache.warmAfter.exists
    && fixture.recoveryHistory.every(({ exact }) => exact)
    && snapshotsMatch(fixture.recovery)
  ));
}

export const proofReportSchema = z.discriminatedUnion("status", [
  passReportSchema,
  failReportSchema,
  blockedReportSchema,
]).superRefine((report, context) => {
  if (report.status !== "PASS") {
    return;
  }
  if (!computeProofPass(report)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pass"],
      message: "PASS report does not contain complete, verified proof evidence",
    });
  }
});

export function parseProofState(value) {
  return proofStateSchema.parse(value);
}

export function parseProofReport(value) {
  return proofReportSchema.parse(value);
}
