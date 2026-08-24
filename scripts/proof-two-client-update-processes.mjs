import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";

import {
  ProofBlockedError,
  assertPathWithin,
  commandEnvironment,
  makeCommandResult,
  nowIso,
  sanitizeId,
} from "./proof-two-client-update-helpers.mjs";

export function fixtureAppDir(harness, definition) {
  return assertPathWithin(
    harness.options.workDir,
    path.join(harness.paths.fixtures, definition.name),
  );
}

export function fixtureEnv(definition) {
  return {
    COMPOSE_PROJECT_NAME: definition.composeProjectName,
    POSTGRES_DB: definition.databaseName,
    POSTGRES_PORT: String(definition.postgresPort),
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${definition.postgresPort}/${definition.databaseName}`,
    NODE_ENV: "development",
    PORT: String(definition.serverPort),
    CLIENT_PORT: String(definition.clientPort),
    APP_ORIGIN: `http://127.0.0.1:${definition.clientPort}`,
    SESSION_SECRET: `proof-${definition.name}-session-secret-0123456789abcdef`,
  };
}

export function writeFixtureEnv(appDir, definition) {
  const body = Object.entries(fixtureEnv(definition)).map(([key, value]) => `${key}=${value}`).join("\n");
  writeFileSync(path.join(appDir, ".env"), `${body}\n`, { encoding: "utf8", mode: 0o600 });
}

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => reject(new ProofBlockedError(`Port ${port} is already in use`, "ports")));
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolve()));
  });
}

export async function assertFixturePortsAvailable(definition) {
  await Promise.all([
    assertPortAvailable(definition.postgresPort),
    assertPortAvailable(definition.serverPort),
    assertPortAvailable(definition.clientPort),
  ]);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForHttp(url, timeoutMs, processRecord) {
  const started = Date.now();
  const attempts = [];
  while (Date.now() - started < timeoutMs) {
    if (processRecord?.child.proofSpawnError) throw processRecord.child.proofSpawnError;
    if (processRecord?.child.exitCode !== null) {
      throw new Error(`Managed process exited before healthcheck: ${url}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      attempts.push(`${new Date().toISOString()} HTTP ${response.status}`);
      if (response.ok) return attempts;
    } catch (error) {
      attempts.push(`${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}`);
    }
    await wait(500);
  }
  throw new Error(`Healthcheck timed out: ${url}\n${attempts.join("\n")}`);
}

export async function startFixtureProcesses(harness, definition, commandId) {
  const appDir = fixtureAppDir(harness, definition);
  const startedAt = nowIso();
  const startedMs = Date.now();
  const logPath = path.join(harness.paths.logs, `${sanitizeId(commandId)}.log`);
  assertPathWithin(harness.options.workDir, logPath);
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(logPath, "", "utf8");
  const logHandle = openSync(logPath, "a");
  const env = commandEnvironment(fixtureEnv(definition));
  const detached = process.platform !== "win32";
  const server = spawn("npm", ["start"], {
    cwd: appDir,
    env,
    stdio: ["ignore", logHandle, logHandle],
    detached,
  });
  const client = spawn("npm", ["run", "dev:client", "--", "--host", "127.0.0.1"], {
    cwd: appDir,
    env,
    stdio: ["ignore", logHandle, logHandle],
    detached,
  });
  for (const child of [server, client]) {
    child.proofSpawnError = null;
    child.once("error", (error) => {
      child.proofSpawnError = error;
    });
  }
  const record = { server, client, child: server, logHandle };
  harness.processes.set(definition.name, record);
  try {
    if (!server.pid || !client.pid) throw new Error("Managed process did not expose a PID");
    const cwd = realpathSync(appDir);
    harness.runtime.fixtures[definition.name].managedProcesses = [
      {
        role: "server",
        pid: server.pid,
        pgid: server.pid,
        cwd,
        command: "npm start",
        startedAt,
        active: true,
      },
      {
        role: "client",
        pid: client.pid,
        pgid: client.pid,
        cwd,
        command: "npm run dev:client",
        startedAt,
        active: true,
      },
    ];
    harness.persist();
    const serverAttempts = await waitForHttp(
      `http://127.0.0.1:${definition.serverPort}/api/health`,
      30_000,
      record,
    );
    const clientAttempts = await waitForHttp(
      `http://127.0.0.1:${definition.clientPort}/`,
      30_000,
      { child: client },
    );
    const detail = `${serverAttempts.join("\n")}\n${clientAttempts.join("\n")}\n`;
    const prior = readFileSync(logPath, "utf8");
    writeFileSync(logPath, `${prior}\n[health probes]\n${detail}`, "utf8");
    const result = makeCommandResult({
      id: commandId,
      fixture: definition.name,
      command: "npm start + npm run dev:client -- --host 127.0.0.1",
      startedAt,
      startedMs,
      status: 0,
      logPath,
      required: true,
    });
    harness.addCommand(result);
    return result;
  } catch (error) {
    await stopFixtureProcesses(harness, definition, `${definition.name}:stop-after-start-failure`, false);
    const result = makeCommandResult({
      id: commandId,
      fixture: definition.name,
      command: "npm start + npm run dev:client -- --host 127.0.0.1",
      startedAt,
      startedMs,
      status: 1,
      logPath,
      required: true,
    });
    harness.addCommand(result);
    throw error;
  }
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

function signalProcessTree(child, signal) {
  if (!child.pid) return false;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

export async function waitForFixturePortsReleased(definition, includePostgres = false, timeoutMs = 5_000) {
  const ports = [definition.serverPort, definition.clientPort];
  if (includePostgres) ports.push(definition.postgresPort);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await Promise.all(ports.map((port) => assertPortAvailable(port)));
      return true;
    } catch {
      await wait(100);
    }
  }
  return false;
}

export async function terminateProcessRecord(record, definition, operations = {}) {
  const signalTree = operations.signalProcessTree ?? signalProcessTree;
  const waitForChildExit = operations.waitForChildExit ?? waitForExit;
  const waitForPortsReleased = operations.waitForPortsReleased ?? waitForFixturePortsReleased;
  const children = [record.server, record.client];
  for (const child of children) signalTree(child, "SIGTERM");
  const graceful = await Promise.all(children.map((child) => waitForChildExit(child, 8_000)));
  let forced = false;
  for (const [index, child] of children.entries()) {
    if (!graceful[index]) forced = signalTree(child, "SIGKILL") || forced;
  }
  if (forced) await Promise.all(children.map((child) => waitForChildExit(child, 2_000)));
  let portsReleased = await waitForPortsReleased(definition);
  if (!portsReleased) {
    for (const child of children) forced = signalTree(child, "SIGKILL") || forced;
    await Promise.all(children.map((child) => waitForChildExit(child, 2_000)));
    portsReleased = await waitForPortsReleased(definition);
  }
  try {
    closeSync(record.logHandle);
  } catch {
    // The normal stop and emergency cleanup may converge on the same descriptor.
  }
  return {
    graceful: graceful.every(Boolean),
    forced,
    portsReleased,
    serverExit: record.server.exitCode,
    clientExit: record.client.exitCode,
  };
}

function processGroupMembers(pgid) {
  const result = spawnSync("ps", ["-eo", "pid=,pgid=,command="], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.status !== 0) {
    throw new ProofBlockedError(`Unable to inspect process group ${pgid}`, "process-cleanup");
  }
  return String(result.stdout).split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!match || Number(match[2]) !== pgid) return [];
    return [{ pid: Number(match[1]), pgid: Number(match[2]), command: match[3] }];
  });
}

function processCwd(pid) {
  const procCwd = `/proc/${pid}/cwd`;
  if (existsSync(procCwd)) {
    try {
      return realpathSync(procCwd);
    } catch {
      return "";
    }
  }
  const result = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.status !== 0) return "";
  const cwd = String(result.stdout).split("\n").find((line) => line.startsWith("n"));
  if (!cwd) return "";
  try {
    return realpathSync(cwd.slice(1));
  } catch {
    return "";
  }
}

function commandMatchesRole(command, role) {
  return role === "server"
    ? /(?:npm start|dist\/index|node .*server)/.test(command)
    : /(?:npm run dev:client|vite)/.test(command);
}

function signalPersistedGroup(pgid, signal) {
  try {
    if (process.platform === "win32") process.kill(pgid, signal);
    else process.kill(-pgid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForGroupExit(pgid, timeoutMs, inspectGroup = processGroupMembers) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (inspectGroup(pgid).length === 0) return true;
    await wait(100);
  }
  return inspectGroup(pgid).length === 0;
}

export async function terminatePersistedProcessGroups(records, definition, appDir, operations = {}) {
  const inspectGroup = operations.processGroupMembers ?? processGroupMembers;
  const inspectCwd = operations.processCwd ?? processCwd;
  const signalGroup = operations.signalProcessGroup ?? signalPersistedGroup;
  const awaitGroupExit = operations.waitForGroupExit
    ?? ((pgid, timeoutMs) => waitForGroupExit(pgid, timeoutMs, inspectGroup));
  const waitForPortsReleased = operations.waitForPortsReleased ?? waitForFixturePortsReleased;
  const expectedCwd = existsSync(appDir) ? realpathSync(appDir) : path.resolve(appDir);
  const details = [];
  let ok = true;
  for (const record of records) {
    const wasActive = record.active;
    // A record is inactive only after a fresh inspection proves its PGID empty.
    record.active = true;
    delete record.stoppedAt;
    if (record.cwd !== expectedCwd || record.pgid !== record.pid) {
      ok = false;
      details.push(`${record.role}: refused persisted identity mismatch`);
      continue;
    }
    let members = inspectGroup(record.pgid);
    if (members.length === 0) {
      record.active = false;
      record.stoppedAt = nowIso();
      details.push(`${record.role}: process group already absent`);
      continue;
    }
    const memberIdentities = members.map((member) => ({
      cwd: inspectCwd(member.pid),
      roleMatch: commandMatchesRole(member.command, record.role),
    }));
    const allMembersOwned = memberIdentities.every(({ cwd }) => cwd === expectedCwd);
    const identified = allMembersOwned && (
      wasActive || memberIdentities.some(({ roleMatch }) => roleMatch)
    );
    if (!identified) {
      ok = false;
      details.push(`${record.role}: refused process group without matching ownership`);
      continue;
    }
    signalGroup(record.pgid, "SIGTERM");
    await awaitGroupExit(record.pgid, 8_000);
    members = inspectGroup(record.pgid);
    let forced = false;
    if (members.length > 0) {
      forced = signalGroup(record.pgid, "SIGKILL");
      await awaitGroupExit(record.pgid, 2_000);
      members = inspectGroup(record.pgid);
    }
    const exited = members.length === 0;
    ok = ok && exited;
    if (exited) {
      record.active = false;
      record.stoppedAt = nowIso();
    }
    details.push(`${record.role}: exited=${exited} forced=${forced} remaining=${members.length}`);
  }
  const portsReleased = await waitForPortsReleased(definition);
  ok = ok && portsReleased;
  details.push(`portsReleased=${portsReleased}`);
  return { ok, detail: details.join("; ") };
}

export async function stopPersistedFixtureProcesses(harness, definition) {
  const runtime = harness.runtime.fixtures[definition.name];
  const result = await terminatePersistedProcessGroups(
    runtime.managedProcesses,
    definition,
    fixtureAppDir(harness, definition),
  );
  harness.persist();
  if (!result.ok) {
    throw new ProofBlockedError(
      `Unable to stop persisted process groups for ${definition.name}: ${result.detail}`,
      "process-cleanup",
    );
  }
  return result;
}

export async function stopFixtureProcesses(
  harness,
  definition,
  commandId,
  required = true,
  operations = {},
) {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const record = harness.processes.get(definition.name);
  let detail = "No managed process was active.\n";
  let status = 0;
  if (record) {
    const stopped = await terminateProcessRecord(record, definition, operations);
    detail = `serverExit=${stopped.serverExit} clientExit=${stopped.clientExit} forced=${stopped.forced} portsReleased=${stopped.portsReleased}\n`;
    status = stopped.graceful && !stopped.forced && stopped.portsReleased ? 0 : 1;
  }
  const managed = harness.runtime.fixtures[definition.name].managedProcesses;
  const persisted = await terminatePersistedProcessGroups(
    managed,
    definition,
    fixtureAppDir(harness, definition),
    operations,
  );
  status = status === 0 && persisted.ok ? 0 : 1;
  detail += `processGroups=${persisted.detail}\n`;
  if (record && persisted.ok) harness.processes.delete(definition.name);
  harness.recordSyntheticCommand({
    id: commandId,
    fixture: definition.name,
    command: "SIGTERM managed server and Vite client; verify every PGID; SIGKILL after 8s",
    startedAt,
    startedMs,
    exitCode: status,
    required,
    detail,
  });
}
