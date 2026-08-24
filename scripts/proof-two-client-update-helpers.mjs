#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
  PROOF_BASE_VERSION,
  PROOF_SCHEMA_VERSION,
  PROOF_STEPS,
  PROOF_TARGET_VERSION,
  REQUIRED_FAULT_IDS,
  REQUIRED_RELEASE_PACKAGES,
  commandResultSchema,
  computeProofPass,
  faultResultSchema,
  packageArtifactSchema,
  parseProofReport,
  parseProofState,
  recoveryResultSchema,
} from "./proof-model.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPOSITORY_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
const DEFAULT_PORT_BASE = 46_000;
const HASH_IGNORES = new Set(["node_modules", "dist", ".proof"]);
const UPDATE_ALLOWED_ROOTS = new Set(["package.json", "package-lock.json", "drizzle"]);
export const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ProofBlockedError extends Error {
  constructor(message, step = "preflight") {
    super(message);
    this.name = "ProofBlockedError";
    this.step = step;
  }
}

export class ProofCommandError extends Error {
  constructor(result) {
    super(`Command failed (${result.id}, exit ${result.exitCode}): ${result.command}`);
    this.name = "ProofCommandError";
    this.result = result;
  }
}

export class InjectedInterruption extends ProofBlockedError {
  constructor(fixture) {
    super(
      `Injected interruption after target installation for ${fixture}; rerun with --resume`,
      `${fixture}:installed`,
    );
    this.name = "InjectedInterruption";
  }
}

export function usage() {
  return `Usage: npm run proof:two-client-update -- \\
  --baseline-ref <annotated-tag-or-commit> \\
  --target-ref <commit-or-tag> \\
  --work-dir <absolute-or-relative-directory> \\
  --output <report-directory> [--resume] [--keep-work-dir]

Options:
  --baseline-ref <ref>  Immutable Storm Stack 0.1.0 source state (required)
  --target-ref <ref>    Immutable Storm Stack 0.1.1 source state (required)
  --work-dir <dir>      Dedicated proof workspace and checkpoints (required)
  --output <dir>        Directory receiving proof-report.json/.md (required)
  --resume              Resume the exact checkpoint in --work-dir
  --keep-work-dir       Keep source worktrees after a terminal verdict
  --port-base <port>    First port range (default: ${DEFAULT_PORT_BASE})
  --help                Show this help

Fault exercise (required for a PASS):
  First invocation:  FAIL_AFTER_INSTALL=1 ...
  Resume invocation: FAIL_BUILD_AFTER_MIGRATION=1 ... --resume

The first invocation exits 2 with a validated BLOCKED report. The resume must
verify the checkpoint hashes before continuing. No command is retried silently.`;
}

export function parseProofArguments(argv) {
  const options = {
    baselineRef: "",
    targetRef: "",
    workDir: "",
    outputDir: "",
    resume: false,
    keepWorkDir: false,
    portBase: DEFAULT_PORT_BASE,
    help: false,
  };

  const values = new Map([
    ["--baseline-ref", "baselineRef"],
    ["--target-ref", "targetRef"],
    ["--work-dir", "workDir"],
    ["--output", "outputDir"],
    ["--port-base", "portBase"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--resume") {
      options.resume = true;
      continue;
    }
    if (argument === "--keep-work-dir") {
      options.keepWorkDir = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const key = values.get(argument);
    if (!key) {
      throw new ProofBlockedError(`Unknown argument: ${argument}`, "arguments");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new ProofBlockedError(`${argument} requires a value`, "arguments");
    }
    options[key] = key === "portBase" ? Number.parseInt(value, 10) : value;
    index += 1;
  }

  if (options.help) return options;
  for (const [key, flag] of [
    ["baselineRef", "--baseline-ref"],
    ["targetRef", "--target-ref"],
    ["workDir", "--work-dir"],
    ["outputDir", "--output"],
  ]) {
    if (!options[key]) {
      throw new ProofBlockedError(`${flag} is required`, "arguments");
    }
  }
  if (
    !Number.isInteger(options.portBase)
    || options.portBase < 1024
    || options.portBase + 13 > 65_535
  ) {
    throw new ProofBlockedError("--port-base must reserve 14 ports within 1024..65535", "arguments");
  }
  if (options.baselineRef === options.targetRef) {
    throw new ProofBlockedError("--baseline-ref and --target-ref must differ", "arguments");
  }

  options.workDir = canonicalizeProofPath(options.workDir, "--work-dir");
  options.outputDir = canonicalizeProofPath(options.outputDir, "--output");
  if ([path.parse(options.workDir).root, homedir(), REPOSITORY_ROOT].includes(options.workDir)) {
    throw new ProofBlockedError("--work-dir must be a dedicated child directory", "arguments");
  }
  if (options.workDir === options.outputDir) {
    throw new ProofBlockedError("--work-dir and --output must be distinct directories", "arguments");
  }
  return options;
}

export function canonicalizeProofPath(inputPath, label = "path") {
  const absolute = path.resolve(inputPath);
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
    throw new ProofBlockedError(`${label} must not be a symbolic link`, "arguments");
  }
  const missing = [];
  let ancestor = absolute;
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    missing.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const canonicalAncestor = existsSync(ancestor) ? realpathSync(ancestor) : ancestor;
  return path.join(canonicalAncestor, ...missing);
}

export function normalizeRunId(value) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!normalized) throw new ProofBlockedError("Unable to derive a safe run id", "preflight");
  return normalized.slice(0, 32);
}

export function createRunId(now = new Date(), entropy = randomBytes(3).toString("hex")) {
  return normalizeRunId(`${now.toISOString()}-${entropy}`);
}

export function fixtureDefinitions(runId, portBase = DEFAULT_PORT_BASE) {
  const safeRunId = normalizeRunId(runId);
  return [
    {
      name: "alpha",
      projectName: "alpha",
      displayName: "Alpha Ops",
      plugins: "auth,consent",
      route: "/projects",
      page: "ProjectsPage",
      sentinelText: "ALPHA_PROJECTS_OK",
      composeProjectName: `storm-proof-${safeRunId}-alpha`,
      postgresPort: portBase + 1,
      serverPort: portBase + 2,
      clientPort: portBase + 3,
      databaseName: "storm_proof_alpha",
      volumeName: `storm-proof-${safeRunId}-alpha_pgdata`,
      policyVersion: "1.0-alpha",
      hasCrm: false,
    },
    {
      name: "beta",
      projectName: "beta",
      displayName: "Beta Portal",
      plugins: "auth,consent,crm",
      route: "/documents",
      page: "DocumentsPage",
      sentinelText: "BETA_DOCUMENTS_OK",
      composeProjectName: `storm-proof-${safeRunId}-beta`,
      postgresPort: portBase + 11,
      serverPort: portBase + 12,
      clientPort: portBase + 13,
      databaseName: "storm_proof_beta",
      volumeName: `storm-proof-${safeRunId}-beta_pgdata`,
      policyVersion: "2026-beta",
      hasCrm: true,
    },
  ];
}

export function nowIso() {
  return new Date().toISOString();
}

export function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

export function atomicWriteJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, filePath);
}

export function atomicWriteText(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, filePath);
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function assertPathWithin(parentPath, candidatePath) {
  const rawParent = path.resolve(parentPath);
  const rawCandidate = path.resolve(candidatePath);
  if (rawCandidate === rawParent || !rawCandidate.startsWith(`${rawParent}${path.sep}`)) {
    throw new ProofBlockedError(`Refusing operation outside dedicated directory: ${rawCandidate}`, "cleanup");
  }
  const rawRelative = path.relative(rawParent, rawCandidate);
  let cursor = rawParent;
  for (const segment of rawRelative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new ProofBlockedError(`Refusing symbolic proof path: ${cursor}`, "cleanup");
    }
  }
  const parent = canonicalizeProofPath(rawParent, "proof parent");
  const candidate = canonicalizeProofPath(rawCandidate, "proof candidate");
  if (candidate === parent || !candidate.startsWith(`${parent}${path.sep}`)) {
    throw new ProofBlockedError(`Refusing operation outside dedicated directory: ${candidate}`, "cleanup");
  }
  const relative = path.relative(parent, candidate);
  cursor = parent;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new ProofBlockedError(`Refusing symbolic proof path: ${cursor}`, "cleanup");
    }
  }
  const canonical = existsSync(candidate) ? realpathSync(candidate) : candidate;
  if (!canonical.startsWith(`${parent}${path.sep}`)) {
    throw new ProofBlockedError(`Resolved proof path escaped workspace: ${canonical}`, "cleanup");
  }
  return canonical;
}

export function walkFiles(rootPath, relative = "", ignores = HASH_IGNORES) {
  if (!existsSync(rootPath)) return [];
  const directory = path.join(rootPath, relative);
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignores.has(entry.name)) continue;
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      throw new ProofBlockedError(`Symlinks are not accepted in proof snapshots: ${childRelative}`, "snapshot");
    }
    if (entry.isDirectory()) {
      result.push(...walkFiles(rootPath, childRelative, ignores));
    } else if (entry.isFile()) {
      result.push(childRelative);
    }
  }
  return result;
}

export function fileManifest(rootPath, options = {}) {
  const ignores = new Set(options.ignores ?? HASH_IGNORES);
  return Object.fromEntries(
    walkFiles(rootPath, "", ignores).map((relative) => [
      relative,
      sha256File(path.join(rootPath, relative)),
    ]),
  );
}

export function hashFileManifest(manifest) {
  return sha256Buffer(JSON.stringify(canonicalJson(manifest)));
}

export function hashTree(rootPath, options = {}) {
  return hashFileManifest(fileManifest(rootPath, options));
}

export function diffFileManifests(before, after) {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return paths.filter((file) => before[file] !== after[file]);
}

export function classifyUpdateChanges(changedPaths) {
  const allowed = [];
  const forbidden = [];
  for (const changedPath of changedPaths) {
    const root = changedPath.split("/")[0];
    (UPDATE_ALLOWED_ROOTS.has(root) ? allowed : forbidden).push(changedPath);
  }
  return { allowed, forbidden };
}

function quoteArgument(value) {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : JSON.stringify(value);
}

export function renderCommand(command, args) {
  return [command, ...args].map(quoteArgument).join(" ");
}

export function sanitizeId(value) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 120);
}

export function boundedOutput(value, max = 16 * 1024 * 1024) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n[output truncated from ${value.length} bytes]\n`;
}

export function commandEnvironment(extra = {}) {
  return { ...process.env, ...extra };
}

export function exitCode(result) {
  if (typeof result.status === "number") return result.status;
  return result.signal ? 128 : 1;
}

export function makeCommandResult({ id, fixture, command, startedAt, startedMs, status, logPath, required }) {
  const finishedAt = nowIso();
  return {
    id,
    ...(fixture ? { fixture } : {}),
    command,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.now() - startedMs),
    exitCode: status,
    required,
    attempt: 1,
    logPath,
  };
}

export function newFixtureRuntime(definition) {
  return {
    definition,
    commands: [],
    timings: {
      generationMs: 0,
      installMs: 0,
      migrationMs: 0,
      testsMs: 0,
      updateWarmMs: 0,
      updateColdMs: 0,
    },
    changedFiles: { allowed: [], forbidden: [] },
    sentinels: {
      auth: false,
      consentBaseline: false,
      consentWithdrawn: false,
      businessCustomization: false,
      csrfNegative: false,
    },
    migrationNoop: false,
    recovery: null,
    baselineSnapshot: null,
    beforeUpdateFiles: null,
    generationStartedAtMs: 0,
    updateStartedAtMs: 0,
    warmStartedAtMs: 0,
    warmMigrationNoop: false,
    warmCompleted: false,
    cache: {
      coldBefore: null,
      coldAfter: null,
      warmBefore: null,
      warmAfter: null,
    },
    mutationEpoch: 0,
    activeMutation: null,
    currentTrain: "unknown",
    recoveryAttempts: 0,
    recoveryHistory: [],
    managedProcesses: [],
  };
}

export function newRuntime(runId, portBase, definitions = fixtureDefinitions(runId, portBase)) {
  return {
    schemaVersion: 1,
    runId,
    portBase,
    baseCommit: "",
    targetCommit: "",
    sourceArtifacts: [],
    targetArtifacts: [],
    commands: [],
    fixtures: Object.fromEntries(definitions.map((definition) => [definition.name, newFixtureRuntime(definition)])),
    faultMatrix: [],
  };
}

const runtimeSha256 = z.string().regex(/^[a-f0-9]{64}$/);
const runtimeCommit = z.union([z.literal(""), z.string().regex(/^[a-f0-9]{40}$/)]);
const runtimeIsoTimestamp = z.string().datetime({ offset: true });
const recoverySnapshotSchema = z.object({
  packageTree: runtimeSha256,
  drizzleTree: runtimeSha256,
  schemaFingerprint: runtimeSha256,
  dataFingerprint: runtimeSha256,
  sequencesFingerprint: runtimeSha256,
}).strict();
const fixtureDefinitionSchema = z.object({
  name: z.enum(["alpha", "beta"]),
  projectName: z.enum(["alpha", "beta"]),
  displayName: z.string().min(1),
  plugins: z.string().min(1),
  route: z.string().startsWith("/"),
  page: z.string().min(1),
  sentinelText: z.string().min(1),
  composeProjectName: z.string().min(1),
  postgresPort: z.number().int().min(1024).max(65_535),
  serverPort: z.number().int().min(1024).max(65_535),
  clientPort: z.number().int().min(1024).max(65_535),
  databaseName: z.string().regex(/^[a-z][a-z0-9_]*$/),
  volumeName: z.string().min(1),
  policyVersion: z.string().min(1),
  hasCrm: z.boolean(),
}).strict();
const runtimeCacheSnapshotSchema = z.object({
  path: z.string().min(1),
  exists: z.boolean(),
  fileCount: z.number().int().nonnegative(),
  hash: runtimeSha256.optional(),
}).strict();
const runtimeRecoveryEpochSchema = z.object({
  epoch: z.number().int().positive(),
  phase: z.string().min(1),
  attempt: z.number().int().positive(),
  suffix: z.string(),
  exact: z.boolean(),
  finishedAt: runtimeIsoTimestamp,
}).strict();
const managedProcessSchema = z.object({
  role: z.enum(["server", "client"]),
  pid: z.number().int().positive(),
  pgid: z.number().int().positive(),
  cwd: z.string().min(1),
  command: z.string().min(1),
  startedAt: runtimeIsoTimestamp,
  active: z.boolean(),
  stoppedAt: runtimeIsoTimestamp.optional(),
}).strict();
const fixtureRuntimeSchema = z.object({
  definition: fixtureDefinitionSchema,
  commands: z.array(commandResultSchema),
  timings: z.object({
    generationMs: z.number().int().nonnegative(),
    installMs: z.number().int().nonnegative(),
    migrationMs: z.number().int().nonnegative(),
    testsMs: z.number().int().nonnegative(),
    updateWarmMs: z.number().int().nonnegative(),
    updateColdMs: z.number().int().nonnegative(),
  }).strict(),
  changedFiles: z.object({ allowed: z.array(z.string()), forbidden: z.array(z.string()) }).strict(),
  sentinels: z.object({
    auth: z.boolean(),
    consentBaseline: z.boolean(),
    consentWithdrawn: z.boolean(),
    businessCustomization: z.boolean(),
    csrfNegative: z.boolean(),
  }).strict(),
  migrationNoop: z.boolean(),
  recovery: recoveryResultSchema.nullable(),
  baselineSnapshot: recoverySnapshotSchema.nullable(),
  beforeUpdateFiles: z.record(z.string(), runtimeSha256).nullable(),
  generationStartedAtMs: z.number().int().nonnegative(),
  updateStartedAtMs: z.number().int().nonnegative(),
  warmStartedAtMs: z.number().int().nonnegative(),
  warmMigrationNoop: z.boolean(),
  warmCompleted: z.boolean(),
  cache: z.object({
    coldBefore: runtimeCacheSnapshotSchema.nullable(),
    coldAfter: runtimeCacheSnapshotSchema.nullable(),
    warmBefore: runtimeCacheSnapshotSchema.nullable(),
    warmAfter: runtimeCacheSnapshotSchema.nullable(),
  }).strict(),
  mutationEpoch: z.number().int().nonnegative(),
  activeMutation: z.object({
    epoch: z.number().int().positive(),
    phase: z.string().min(1),
    startedAt: runtimeIsoTimestamp,
  }).strict().nullable(),
  currentTrain: z.enum(["unknown", "baseline", "target"]),
  recoveryAttempts: z.number().int().nonnegative(),
  recoveryHistory: z.array(runtimeRecoveryEpochSchema),
  managedProcesses: z.array(managedProcessSchema).max(2).refine(
    (records) => new Set(records.map(({ role }) => role)).size === records.length,
    "managed process roles must be unique",
  ),
}).strict();
export const proofRuntimeSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/),
  portBase: z.number().int().min(1024).max(65_522),
  baseCommit: runtimeCommit,
  targetCommit: runtimeCommit,
  sourceArtifacts: z.array(packageArtifactSchema),
  targetArtifacts: z.array(packageArtifactSchema),
  commands: z.array(commandResultSchema),
  fixtures: z.object({ alpha: fixtureRuntimeSchema, beta: fixtureRuntimeSchema }).strict(),
  faultMatrix: z.array(faultResultSchema).max(REQUIRED_FAULT_IDS.length),
}).strict();

export function parseProofRuntime(value, expectedRunId, expectedPortBase) {
  const runtime = proofRuntimeSchema.parse(value);
  if (runtime.runId !== expectedRunId || runtime.portBase !== expectedPortBase) {
    throw new ProofBlockedError("Runtime and state identity differ", "resume");
  }
  const expectedDefinitions = fixtureDefinitions(expectedRunId, expectedPortBase);
  for (const definition of expectedDefinitions) {
    const actual = runtime.fixtures[definition.name].definition;
    if (JSON.stringify(canonicalJson(actual)) !== JSON.stringify(canonicalJson(definition))) {
      throw new ProofBlockedError(`Runtime definition drift for ${definition.name}`, "resume");
    }
  }
  return runtime;
}

const markerBaseSchema = {
  runId: z.string().min(1),
  fixture: z.enum(["alpha", "beta"]),
};
const interruptionMarkerSchema = z.object({
  ...markerBaseSchema,
  interruptedAt: z.string().datetime({ offset: true }),
}).strict();
const buildMarkerSchema = z.object({
  ...markerBaseSchema,
  commandId: z.string().min(1),
  exitCode: z.number().int().refine((value) => value !== 0),
  injectedAt: z.string().datetime({ offset: true }),
}).strict();

export function parseInterruptionMarker(value, expectedRunId) {
  const marker = interruptionMarkerSchema.parse(value);
  if (marker.runId !== expectedRunId) {
    throw new ProofBlockedError("Interruption marker belongs to another run", "resume");
  }
  return marker;
}

export function parseBuildMarker(value, expectedRunId) {
  const marker = buildMarkerSchema.parse(value);
  if (marker.runId !== expectedRunId) {
    throw new ProofBlockedError("Build marker belongs to another run", "fault-build");
  }
  return marker;
}

export function newState(runId, options) {
  const timestamp = nowIso();
  return {
    schemaVersion: PROOF_SCHEMA_VERSION,
    runId,
    portBase: options.portBase,
    status: "running",
    baseRef: options.baselineRef,
    targetRef: options.targetRef,
    startedAt: timestamp,
    updatedAt: timestamp,
    fixtures: {
      alpha: { completedSteps: [], hashes: {}, updatedAt: timestamp },
      beta: { completedSteps: [], hashes: {}, updatedAt: timestamp },
    },
  };
}

export function replaceOnce(source, needle, replacement, label = needle) {
  const first = source.indexOf(needle);
  if (first < 0) throw new ProofBlockedError(`Customization anchor missing: ${label}`, "customize");
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new ProofBlockedError(`Customization anchor is ambiguous: ${label}`, "customize");
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

export function patchStormDependencies(packageJson, artifacts) {
  const byName = new Map(artifacts.map((artifact) => [artifact.name, artifact]));
  const patched = structuredClone(packageJson);
  const installed = [];
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    if (!patched[section]) continue;
    for (const name of Object.keys(patched[section])) {
      const artifact = byName.get(name);
      if (!artifact) continue;
      patched[section][name] = `file:${artifact.tarballPath}`;
      installed.push(name);
    }
  }
  if (!installed.includes("@stormeoio/core") || !installed.includes("@stormeoio/cli")) {
    throw new ProofBlockedError("Generated fixture is missing core or CLI Storm Stack dependencies", "install");
  }
  return { packageJson: patched, installed: [...new Set(installed)].sort() };
}

export function assertArtifactHashes(artifacts) {
  for (const artifact of artifacts) {
    if (!existsSync(artifact.tarballPath)) {
      throw new ProofBlockedError(`Missing tarball: ${artifact.tarballPath}`, "artifact-hash");
    }
    const actual = sha256File(artifact.tarballPath);
    if (actual !== artifact.expectedSha256 || actual !== artifact.actualSha256) {
      throw new ProofBlockedError(`Unexpected tarball hash for ${artifact.name}`, "artifact-hash");
    }
  }
}

export function assertInstalledTrain(appDir, artifacts, expectedVersion) {
  const packageJson = readJson(path.join(appDir, "package.json"));
  const lock = readJson(path.join(appDir, "package-lock.json"));
  const lockRoot = lock.packages?.[""];
  if (!lockRoot) {
    throw new ProofBlockedError("Lockfile has no root package entry", "lockfile");
  }
  const byName = new Map(artifacts.map((artifact) => [artifact.name, artifact]));
  const installed = [];

  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, specifier] of Object.entries(packageJson[section] ?? {})) {
      if (!name.startsWith("@stormeoio/") && name !== "@stormeoio/create-storm-app") continue;
      const artifact = byName.get(name);
      if (!artifact || specifier !== `file:${artifact.tarballPath}`) {
        throw new ProofBlockedError(`Package manifest does not pin the expected tarball for ${name}`, "lockfile");
      }
      if (lockRoot[section]?.[name] !== specifier) {
        throw new ProofBlockedError(`Lockfile root specifier does not pin the expected tarball for ${name}`, "lockfile");
      }
      const lockEntry = lock.packages?.[`node_modules/${name}`];
      if (!lockEntry || lockEntry.version !== expectedVersion) {
        throw new ProofBlockedError(`Lockfile is stale for ${name}; expected ${expectedVersion}`, "lockfile");
      }
      if (typeof lockEntry.resolved !== "string" || !lockEntry.resolved.startsWith("file:")) {
        throw new ProofBlockedError(`Lockfile resolved source is not a file tarball for ${name}`, "lockfile");
      }
      const resolvedTarball = path.resolve(appDir, decodeURIComponent(lockEntry.resolved.slice("file:".length)));
      if (resolvedTarball !== path.resolve(artifact.tarballPath)) {
        throw new ProofBlockedError(`Lockfile resolved tarball differs for ${name}`, "lockfile");
      }
      if (typeof lockEntry.integrity === "string") {
        const actualIntegrity = `sha512-${createHash("sha512").update(readFileSync(artifact.tarballPath)).digest("base64")}`;
        if (lockEntry.integrity !== actualIntegrity) {
          throw new ProofBlockedError(`Lockfile integrity differs for ${name}`, "lockfile");
        }
      }
      const installedManifestPath = path.join(appDir, "node_modules", ...name.split("/"), "package.json");
      if (!existsSync(installedManifestPath)) {
        throw new ProofBlockedError(`Installed package is missing for ${name}`, "lockfile");
      }
      const installedManifest = readJson(installedManifestPath);
      if (installedManifest.name !== name || installedManifest.version !== expectedVersion) {
        throw new ProofBlockedError(`Installed package metadata differs for ${name}`, "lockfile");
      }
      installed.push(name);
    }
  }

  if (installed.length === 0) {
    throw new ProofBlockedError("No Storm Stack package found in generated fixture", "lockfile");
  }
  return installed.sort();
}

export function convertPackManifest(manifest, manifestDir, expectedCommit, expectedVersion) {
  if (manifest.commit !== expectedCommit || manifest.rootVersion !== expectedVersion || manifest.dirty) {
    throw new ProofBlockedError(
      `Pack manifest does not match immutable ${expectedCommit}@${expectedVersion}`,
      "pack",
    );
  }
  const names = manifest.artifacts.map(({ name }) => name);
  if (
    names.length !== REQUIRED_RELEASE_PACKAGES.length
    || !REQUIRED_RELEASE_PACKAGES.every((name) => names.includes(name))
  ) {
    throw new ProofBlockedError("Pack manifest does not contain the exact release train", "pack");
  }
  return manifest.artifacts.map((artifact) => {
    const tarballPath = path.resolve(manifestDir, artifact.filename);
    const actualSha256 = sha256File(tarballPath);
    if (actualSha256 !== artifact.sha256) {
      throw new ProofBlockedError(`Packed hash mismatch for ${artifact.name}`, "pack");
    }
    return {
      name: artifact.name,
      version: artifact.version,
      workspace: artifact.workspace,
      filename: artifact.filename,
      tarballPath,
      commit: expectedCommit,
      expectedSha256: artifact.sha256,
      actualSha256,
    };
  });
}

export function proofPaths(options) {
  return {
    state: path.join(options.workDir, "proof-state.json"),
    runtime: path.join(options.workDir, "proof-runtime.json"),
    markerInterrupted: path.join(options.workDir, "fault-interrupted-after-install.json"),
    markerBuild: path.join(options.workDir, "fault-build-after-migration.json"),
    logs: path.join(options.workDir, "logs"),
    worktrees: path.join(options.workDir, "source-worktrees"),
    artifacts: path.join(options.workDir, "artifacts"),
    artifactRevalidation: path.join(options.workDir, "artifact-revalidation"),
    fixtures: path.join(options.workDir, "fixtures"),
    reportJson: path.join(options.outputDir, "proof-report.json"),
    reportMarkdown: path.join(options.outputDir, "proof-report.md"),
  };
}
