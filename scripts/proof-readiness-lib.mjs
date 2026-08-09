import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer, createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const readinessRootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_BUDGET_MS = 2 * 60 * 60 * 1000;
const DEFAULT_COMMAND_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_CAPTURED_OUTPUT = 128 * 1024;
const RESOURCE_PREFIX = "stormstack-readiness-";

export class ReadinessBudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReadinessBudgetError";
  }
}

export function parseReadinessArguments(
  argv,
  environment = process.env,
  currentDirectory = process.cwd(),
) {
  const options = {
    baseRef: environment.GATE_BASE_REF ?? "HEAD",
    output: resolve(currentDirectory, "proof-readiness-report.json"),
    budgetMs: Number(environment.READINESS_BUDGET_MS ?? DEFAULT_BUDGET_MS),
    commandTimeoutMs: Number(
      environment.READINESS_COMMAND_TIMEOUT_MS ?? DEFAULT_COMMAND_TIMEOUT_MS,
    ),
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (
      argument === "--base-ref" ||
      argument === "--output" ||
      argument === "--budget-ms" ||
      argument === "--command-timeout-ms"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === "--base-ref") options.baseRef = value;
      if (argument === "--output") options.output = resolve(currentDirectory, value);
      if (argument === "--budget-ms") options.budgetMs = Number(value);
      if (argument === "--command-timeout-ms") options.commandTimeoutMs = Number(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!options.baseRef.trim()) {
    throw new Error("Readiness base ref must not be empty.");
  }
  if (!Number.isFinite(options.budgetMs) || options.budgetMs <= 0) {
    throw new Error("Readiness budget must be a positive number of milliseconds.");
  }
  if (!Number.isFinite(options.commandTimeoutMs) || options.commandTimeoutMs <= 0) {
    throw new Error("Command timeout must be a positive number of milliseconds.");
  }
  return options;
}

export function isSupportedNodeVersion(version) {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major > 20 || (major === 20 && minor >= 19);
}

export function gitResolveArguments(ref) {
  if (typeof ref !== "string" || !ref.trim()) {
    throw new Error("Git ref must not be empty.");
  }
  return ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`];
}

export function normalizeResolvedCommit(output) {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1 || !/^[0-9a-f]{40,64}$/i.test(lines[0])) {
    throw new Error(`Git did not resolve exactly one commit: ${output.trim() || "<empty>"}`);
  }
  return lines[0].toLowerCase();
}

export function computeCommandTimeout({ nowMs, deadlineMs, requestedMs }) {
  const remainingMs = Math.floor(deadlineMs - nowMs);
  if (remainingMs <= 0) {
    throw new ReadinessBudgetError("Readiness global budget is exhausted.");
  }
  if (!Number.isFinite(requestedMs) || requestedMs <= 0) {
    throw new Error("Command timeout must be positive.");
  }
  return Math.max(1, Math.min(Math.floor(requestedMs), remainingMs));
}

export function computeLoopDeadline(nowMs, globalDeadlineMs, maximumWaitMs) {
  if (!Number.isFinite(maximumWaitMs) || maximumWaitMs <= 0) {
    throw new Error("Loop timeout must be positive.");
  }
  if (globalDeadlineMs <= nowMs) {
    throw new ReadinessBudgetError("Readiness global budget is exhausted.");
  }
  return Math.min(globalDeadlineMs, nowMs + maximumWaitMs);
}

export function computeLoopDelay(nowMs, loopDeadlineMs, requestedDelayMs) {
  const remainingMs = Math.floor(loopDeadlineMs - nowMs);
  if (remainingMs <= 0) return 0;
  return Math.max(1, Math.min(Math.floor(requestedDelayMs), remainingMs));
}

export function createReadinessResourceNames(seed = `${process.pid}-${randomBytes(4).toString("hex")}`) {
  const safeSeed = seed.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 32);
  if (!safeSeed) throw new Error("Readiness resource seed must contain a safe character.");
  return {
    directoryPrefix: `${RESOURCE_PREFIX}${safeSeed}-`,
    composeProject: `${RESOURCE_PREFIX}${safeSeed}`.slice(0, 63),
    database: "stormapp",
    service: "postgres",
  };
}

export function isOwnedReadinessDirectory(path, temporaryRoot = tmpdir()) {
  const resolvedPath = resolve(path);
  const resolvedTemporaryRoot = resolve(temporaryRoot);
  return (
    dirname(resolvedPath) === resolvedTemporaryRoot &&
    basename(resolvedPath).startsWith(RESOURCE_PREFIX)
  );
}

export function worktreeAddArguments(worktreePath, resolvedCommit) {
  normalizeResolvedCommit(resolvedCommit);
  return ["worktree", "add", "--detach", worktreePath, resolvedCommit];
}

export function parseNpmPackFilename(output) {
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    throw new Error("npm pack did not return valid JSON.");
  }
  const packed = Array.isArray(payload) ? payload[0] : payload;
  if (!packed || typeof packed.filename !== "string" || basename(packed.filename) !== packed.filename) {
    throw new Error("npm pack did not return a safe tarball filename.");
  }
  return packed.filename;
}

function appendCaptured(current, chunk) {
  const combined = current + chunk.toString();
  return combined.length <= MAX_CAPTURED_OUTPUT
    ? combined
    : `[output truncated]\n${combined.slice(-MAX_CAPTURED_OUTPUT)}`;
}

function killProcessGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process already exited.
    }
  }
}

function renderCommand(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

export function createCommandExecutor({
  defaultCwd,
  deadlineAt,
  defaultTimeoutMs,
  record,
  defaultEnv = process.env,
  now = Date.now,
  spawnCommand = spawn,
}) {
  return async function execute(command, args = [], options = {}) {
    const timeoutMs = computeCommandTimeout({
      nowMs: now(),
      deadlineMs: deadlineAt,
      requestedMs: options.timeoutMs ?? defaultTimeoutMs,
    });
    const startedAtMs = now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeoutHandle;
    let forceHandle;
    let abandonHandle;

    const result = await new Promise((resolveResult) => {
      const child = spawnCommand(command, args, {
        cwd: options.cwd ?? defaultCwd,
        env: { ...defaultEnv, ...(options.env ?? {}) },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const finish = (exitCode, signal, spawnError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        clearTimeout(forceHandle);
        clearTimeout(abandonHandle);
        if (spawnError) stderr = appendCaptured(stderr, spawnError.message);
        resolveResult({
          id: options.id ?? command,
          command: renderCommand(command, args),
          cwd: options.cwd ?? defaultCwd,
          startedAt: new Date(startedAtMs).toISOString(),
          finishedAt: new Date(now()).toISOString(),
          durationMs: now() - startedAtMs,
          timeoutMs,
          timedOut,
          exitCode: timedOut ? 124 : (exitCode ?? 1),
          allowedFailure: Boolean(options.allowFailure && !timedOut && exitCode !== 0),
          signal: signal ?? null,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      };

      child.stdout?.on("data", (chunk) => {
        stdout = appendCaptured(stdout, chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr = appendCaptured(stderr, chunk);
      });
      child.once("error", (error) => finish(127, null, error));
      child.once("close", (code, signal) => finish(code, signal));

      timeoutHandle = setTimeout(() => {
        timedOut = true;
        killProcessGroup(child, "SIGTERM");
        forceHandle = setTimeout(() => killProcessGroup(child, "SIGKILL"), 1000);
        abandonHandle = setTimeout(() => finish(124, "SIGKILL"), 3000);
      }, timeoutMs);
    });

    record(result);
    return result;
  };
}

export function requireSuccess(result) {
  if (result.exitCode !== 0 || result.timedOut) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const reason = result.timedOut ? `timed out after ${result.timeoutMs}ms` : `failed (${result.exitCode})`;
    throw new Error(`${result.id} ${reason}${output ? `\n${output}` : ""}`);
  }
  return result;
}

function recordCheck(record, id, startedAtMs, exitCode, detail, now = Date.now) {
  const result = {
    id,
    command: id,
    cwd: readinessRootDir,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(now()).toISOString(),
    durationMs: now() - startedAtMs,
    timeoutMs: null,
    timedOut: false,
    exitCode,
    signal: null,
    stdout: exitCode === 0 ? detail : "",
    stderr: exitCode === 0 ? "" : detail,
  };
  record(result);
  return result;
}

export function safeCleanupDirectory(path) {
  if (!isOwnedReadinessDirectory(path)) {
    throw new Error(`Refusing to clean unexpected readiness directory: ${path}`);
  }
  rmSync(path, { recursive: true, force: true });
}

export async function reserveFreePort(deadlineAt) {
  const timeoutMs = computeCommandTimeout({
    nowMs: Date.now(),
    deadlineMs: deadlineAt,
    requestedMs: 3000,
  });
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    const timer = setTimeout(() => {
      server.close();
      rejectPort(new Error("Timed out while reserving a local port."));
    }, timeoutMs);
    server.once("error", (error) => {
      clearTimeout(timer);
      rejectPort(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        clearTimeout(timer);
        if (error || port === 0) rejectPort(error ?? new Error("Failed to reserve a local port."));
        else resolvePort(port);
      });
    });
  });
}

export async function canConnect(port, timeoutMs) {
  return await new Promise((resolveConnection) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (connected) => {
      socket.destroy();
      resolveConnection(connected);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export async function waitForPortClosed(port, globalDeadlineAt, maximumWaitMs = 15_000) {
  const loopDeadline = computeLoopDeadline(Date.now(), globalDeadlineAt, maximumWaitMs);
  while (Date.now() < loopDeadline) {
    const connectTimeoutMs = Math.max(1, Math.min(500, loopDeadline - Date.now()));
    if (!(await canConnect(port, connectTimeoutMs))) return;
    const delayMs = computeLoopDelay(Date.now(), loopDeadline, 200);
    if (delayMs > 0) await sleep(delayMs);
  }
  throw new Error(`Port ${port} was not released before the cleanup deadline.`);
}

export async function waitForPostgres(execute, composeArgs, deadlineAt) {
  const loopDeadline = computeLoopDeadline(Date.now(), deadlineAt, 45_000);
  let lastFailure = "";
  let attempt = 0;
  while (Date.now() < loopDeadline) {
    attempt += 1;
    const result = await execute(
      "docker",
      composeArgs("exec", "-T", "postgres", "pg_isready", "-U", "postgres", "-d", "stormapp"),
      { id: `postgres-ready-${attempt}`, timeoutMs: 3000, allowFailure: true },
    );
    if (result.exitCode === 0) return;
    lastFailure = result.stderr || result.stdout;
    const delayMs = computeLoopDelay(Date.now(), loopDeadline, 500);
    if (delayMs > 0) await sleep(delayMs);
  }
  throw new Error(`PostgreSQL readiness timed out${lastFailure ? `: ${lastFailure}` : "."}`);
}

export function startManagedProcess({ command, args, cwd, env, id, deadlineAt, record }) {
  const startedAtMs = Date.now();
  const lifetimeMs = computeCommandTimeout({
    nowMs: startedAtMs,
    deadlineMs: deadlineAt,
    requestedMs: deadlineAt - startedAtMs,
  });
  let stdout = "";
  let stderr = "";
  let settled = false;
  let timedOut = false;
  let stopRequested = false;
  let forceHandle;
  let abandonHandle;
  let resolveExit;

  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const exitPromise = new Promise((resolvePromise) => {
    resolveExit = resolvePromise;
  });
  const finish = (exitCode, signal, spawnError) => {
    if (settled) return;
    settled = true;
    clearTimeout(budgetHandle);
    clearTimeout(forceHandle);
    clearTimeout(abandonHandle);
    if (spawnError) stderr = appendCaptured(stderr, spawnError.message);
    const result = {
      id,
      command: renderCommand(command, args),
      cwd,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      timeoutMs: lifetimeMs,
      timedOut,
      exitCode: timedOut ? 124 : (stopRequested && signal === "SIGTERM" ? 0 : (exitCode ?? 1)),
      originalExitCode: exitCode,
      stopRequested,
      signal: signal ?? null,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
    record(result);
    resolveExit(result);
  };

  child.stdout?.on("data", (chunk) => {
    stdout = appendCaptured(stdout, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr = appendCaptured(stderr, chunk);
  });
  child.once("error", (error) => finish(127, null, error));
  child.once("close", (code, signal) => finish(code, signal));

  const budgetHandle = setTimeout(() => {
    timedOut = true;
    killProcessGroup(child, "SIGTERM");
    forceHandle = setTimeout(() => killProcessGroup(child, "SIGKILL"), 1000);
    abandonHandle = setTimeout(() => finish(124, "SIGKILL"), 3000);
  }, lifetimeMs);

  return {
    get exited() {
      return settled;
    },
    exitPromise,
    async stop() {
      if (!settled) {
        stopRequested = true;
        killProcessGroup(child, "SIGTERM");
      }
      const graceful = await Promise.race([exitPromise, sleep(2000).then(() => null)]);
      if (graceful) return graceful;
      killProcessGroup(child, "SIGKILL");
      const forced = await Promise.race([exitPromise, sleep(2000).then(() => null)]);
      if (forced) return forced;
      timedOut = true;
      finish(124, "SIGKILL");
      return await exitPromise;
    },
  };
}

export async function waitForHealth(url, managedProcess, deadlineAt, record, id) {
  const startedAtMs = Date.now();
  const loopDeadline = computeLoopDeadline(startedAtMs, deadlineAt, 30_000);
  let lastFailure = "";
  while (Date.now() < loopDeadline) {
    if (managedProcess.exited) {
      const processResult = await managedProcess.exitPromise;
      lastFailure = processResult.stderr || processResult.stdout || `exit ${processResult.exitCode}`;
      break;
    }
    try {
      const timeoutMs = Math.max(1, Math.min(1500, loopDeadline - Date.now()));
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      const body = await response.text();
      if (response.ok && /"ok"\s*:\s*true/.test(body)) {
        recordCheck(record, id, startedAtMs, 0, body);
        return;
      }
      lastFailure = `HTTP ${response.status}: ${body}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    const delayMs = computeLoopDelay(Date.now(), loopDeadline, 250);
    if (delayMs > 0) await sleep(delayMs);
  }
  recordCheck(record, id, startedAtMs, 1, lastFailure || "Health endpoint timed out.");
  throw new Error(`${id} failed: ${lastFailure || "health endpoint timed out"}`);
}
