import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { PROOF_STEPS, parseProofState } from "./proof-model.mjs";
import {
  ProofBlockedError,
  ProofCommandError,
  REPOSITORY_ROOT,
  assertPathWithin,
  atomicWriteJson,
  boundedOutput,
  commandEnvironment,
  createRunId,
  exitCode,
  fixtureDefinitions,
  hashTree,
  makeCommandResult,
  newRuntime,
  newState,
  nowIso,
  parseProofRuntime,
  proofPaths,
  readJson,
  renderCommand,
  sanitizeId,
  sha256File,
} from "./proof-two-client-update-helpers.mjs";

export class ProofHarness {
  constructor(options) {
    this.options = options;
    this.paths = proofPaths(options);
    this.state = null;
    this.runtime = null;
    this.processes = new Map();
    this.preserveForResume = false;
  }

  persist() {
    this.validateControlledPaths();
    this.state.updatedAt = nowIso();
    atomicWriteJson(this.paths.state, parseProofState(this.state));
    atomicWriteJson(
      this.paths.runtime,
      parseProofRuntime(this.runtime, this.state.runId, this.state.portBase),
    );
  }

  validateControlledPaths() {
    const candidates = [
      this.paths.state,
      this.paths.runtime,
      this.paths.markerInterrupted,
      this.paths.markerBuild,
      this.paths.logs,
      this.paths.worktrees,
      this.paths.artifacts,
      this.paths.artifactRevalidation,
      this.paths.fixtures,
      path.join(this.options.workDir, "backups"),
      path.join(this.options.workDir, "cold-npm-cache"),
      path.join(this.paths.fixtures, "alpha"),
      path.join(this.paths.fixtures, "beta"),
    ];
    for (const candidate of candidates) assertPathWithin(this.options.workDir, candidate);
  }

  journalFor(fixture) {
    return fixture ? this.runtime.fixtures[fixture].commands : this.runtime.commands;
  }

  addCommand(result) {
    const journal = this.journalFor(result.fixture);
    if (journal.some(({ id }) => id === result.id)) {
      throw new ProofBlockedError(`Command id would be replayed: ${result.id}`, "journal");
    }
    journal.push(result);
    this.persist();
  }

  runCommand({ id, fixture, command, args = [], cwd = REPOSITORY_ROOT, env = {}, required = true, allowFailure = false, input }) {
    const startedAt = nowIso();
    const startedMs = Date.now();
    const logPath = path.join(this.paths.logs, `${sanitizeId(id)}.log`);
    assertPathWithin(this.options.workDir, logPath);
    mkdirSync(path.dirname(logPath), { recursive: true });
    const rendered = renderCommand(command, args);
    const result = spawnSync(command, args, {
      cwd,
      env: commandEnvironment(env),
      encoding: input === undefined ? "utf8" : undefined,
      input,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 20 * 60 * 1000,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const output = input === undefined
      ? `${result.stdout ?? ""}${result.stderr ?? ""}`
      : Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]).toString("utf8");
    writeFileSync(logPath, boundedOutput(output), "utf8");
    const commandResult = makeCommandResult({
      id,
      fixture,
      command: rendered,
      startedAt,
      startedMs,
      status: exitCode(result),
      logPath,
      required,
    });
    this.addCommand(commandResult);
    if (commandResult.exitCode !== 0 && !allowFailure) throw new ProofCommandError(commandResult);
    return { result: commandResult, stdout: result.stdout, stderr: result.stderr };
  }

  runBinaryOutput({ id, fixture, command, args = [], cwd, env = {}, required = true, outputPath }) {
    const startedAt = nowIso();
    const startedMs = Date.now();
    const logPath = path.join(this.paths.logs, `${sanitizeId(id)}.log`);
    assertPathWithin(this.options.workDir, logPath);
    const result = spawnSync(command, args, {
      cwd,
      env: commandEnvironment(env),
      encoding: null,
      maxBuffer: 256 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    writeFileSync(logPath, boundedOutput((result.stderr ?? Buffer.alloc(0)).toString("utf8")), "utf8");
    const commandResult = makeCommandResult({
      id,
      fixture,
      command: renderCommand(command, args),
      startedAt,
      startedMs,
      status: exitCode(result),
      logPath,
      required,
    });
    this.addCommand(commandResult);
    if (commandResult.exitCode !== 0) throw new ProofCommandError(commandResult);
    writeFileSync(outputPath, result.stdout ?? Buffer.alloc(0), { mode: 0o600 });
    return commandResult;
  }

  recordSyntheticCommand({ id, fixture, command, startedAt, startedMs, exitCode: status, required = true, detail = "" }) {
    const logPath = path.join(this.paths.logs, `${sanitizeId(id)}.log`);
    assertPathWithin(this.options.workDir, logPath);
    mkdirSync(path.dirname(logPath), { recursive: true });
    writeFileSync(logPath, detail, "utf8");
    const result = makeCommandResult({ id, fixture, command, startedAt, startedMs, status, logPath, required });
    this.addCommand(result);
    if (status !== 0 && required) throw new ProofCommandError(result);
    return result;
  }

  hasStep(fixture, step) {
    return this.state.fixtures[fixture].completedSteps.includes(step);
  }

  checkpointHashes(appDir) {
    assertPathWithin(this.options.workDir, appDir);
    const inputs = {};
    for (const relative of ["package.json", "package-lock.json", "client", "server", "drizzle"]) {
      const candidate = path.join(appDir, relative);
      if (!existsSync(candidate)) continue;
      inputs[relative] = statSync(candidate).isDirectory() ? hashTree(candidate) : sha256File(candidate);
    }
    return inputs;
  }

  completeStep(fixture, step, appDir) {
    const fixtureState = this.state.fixtures[fixture];
    const expected = PROOF_STEPS[fixtureState.completedSteps.length];
    if (expected !== step) {
      throw new ProofBlockedError(`Invalid checkpoint transition for ${fixture}: expected ${expected}, got ${step}`, "checkpoint");
    }
    fixtureState.completedSteps.push(step);
    fixtureState.hashes = this.checkpointHashes(appDir);
    fixtureState.updatedAt = nowIso();
    this.persist();
  }

  verifyResumeHashes(fixture, appDir) {
    const expected = this.state.fixtures[fixture].hashes;
    if (Object.keys(expected).length === 0) return;
    const actual = this.checkpointHashes(appDir);
    for (const [key, value] of Object.entries(expected)) {
      const actualValue = key === "faultMarker" && existsSync(this.paths.markerInterrupted)
        ? sha256File(this.paths.markerInterrupted)
        : actual[key];
      if (actualValue !== value) {
        throw new ProofBlockedError(`Checkpoint hash drift for ${fixture}:${key}`, "resume");
      }
    }
  }

  recordFault(id, passed, detail, fixture) {
    const existing = this.runtime.faultMatrix.find((fault) => fault.id === id);
    const next = { id, ...(fixture ? { fixture } : {}), passed, detail };
    if (existing) Object.assign(existing, next);
    else this.runtime.faultMatrix.push(next);
    this.persist();
  }

  initialize() {
    if (this.options.resume) {
      this.validateControlledPaths();
      if (!existsSync(this.paths.state) || !existsSync(this.paths.runtime)) {
        throw new ProofBlockedError("--resume requires proof-state.json and proof-runtime.json", "resume");
      }
      this.state = parseProofState(readJson(this.paths.state));
      this.runtime = parseProofRuntime(
        readJson(this.paths.runtime),
        this.state.runId,
        this.state.portBase,
      );
      if (
        this.state.baseRef !== this.options.baselineRef
        || this.state.targetRef !== this.options.targetRef
        || this.state.portBase !== this.options.portBase
      ) {
        throw new ProofBlockedError("Resume refs differ from the checkpoint", "resume");
      }
      this.state.status = "running";
      this.persist();
      return;
    }
    if (existsSync(this.paths.state) || existsSync(this.paths.runtime)) {
      throw new ProofBlockedError("Proof workspace already contains state; use --resume or another directory", "preflight");
    }
    this.validateControlledPaths();
    if (existsSync(path.join(this.options.workDir, "cold-npm-cache"))) {
      throw new ProofBlockedError("Cold npm cache must be absent for a new proof run", "cold-cache");
    }
    mkdirSync(this.options.workDir, { recursive: true });
    mkdirSync(this.options.outputDir, { recursive: true });
    const runId = createRunId();
    const definitions = fixtureDefinitions(runId, this.options.portBase);
    this.state = newState(runId, this.options);
    this.runtime = newRuntime(runId, this.options.portBase, definitions);
    this.persist();
  }
}
