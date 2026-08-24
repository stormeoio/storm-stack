import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { REQUIRED_RELEASE_PACKAGES } from "./proof-model.mjs";

import {
  ProofBlockedError,
  assertArtifactHashes,
  assertInstalledTrain,
  assertPathWithin,
  atomicWriteJson,
  canonicalizeProofPath,
  classifyUpdateChanges,
  diffFileManifests,
  fileManifest,
  fixtureDefinitions,
  hashTree,
  newRuntime,
  parseBuildMarker,
  parseInterruptionMarker,
  parseProofArguments,
  parseProofRuntime,
  patchStormDependencies,
  replaceOnce,
} from "./proof-two-client-update-helpers.mjs";
import { renderProofMarkdown } from "./proof-two-client-update-report.mjs";
import {
  customizeFixture,
  normalizePgDump,
  verifyConcurrentFixtures,
} from "./proof-two-client-update-fixtures.mjs";
import { ProofHarness, settleTerminalVerdict } from "./proof-two-client-update.mjs";
import { revalidateCheckpointArtifacts } from "./proof-two-client-update-artifacts.mjs";
import {
  inspectConsentAdditiveMigration,
  inspectConsentClientApiStability,
  migrationSqlSnapshot,
} from "./proof-two-client-update-gates.mjs";
import {
  stopFixtureProcesses,
  terminatePersistedProcessGroups,
} from "./proof-two-client-update-processes.mjs";
import {
  beginMutationEpoch,
  completeMutationEpoch,
  nextRecoveryAttempt,
  recordRecoveryEpoch,
} from "./proof-two-client-update-runtime.mjs";
import { scaffold } from "../packages/create-storm-app/src/scaffold.ts";

const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "storm-proof-unit-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
});

describe("proof CLI contract", () => {
  it("requires explicit immutable refs and distinct directories", () => {
    expect(() => parseProofArguments([])).toThrow("--baseline-ref is required");
    expect(() => parseProofArguments([
      "--baseline-ref", "proof/base",
      "--target-ref", "proof/base",
      "--work-dir", "work",
      "--output", "output",
    ])).toThrow("must differ");
  });

  it("parses resume and a bounded port range", () => {
    const options = parseProofArguments([
      "--baseline-ref", "proof/base",
      "--target-ref", "target",
      "--work-dir", "work",
      "--output", "output",
      "--port-base", "47000",
      "--resume",
    ]);
    expect(options.resume).toBe(true);
    expect(options.portBase).toBe(47_000);
    expect(path.isAbsolute(options.workDir)).toBe(true);
  });

  it("refuses a repository root as the mutable proof workspace", () => {
    expect(() => parseProofArguments([
      "--baseline-ref", "proof/base",
      "--target-ref", "target",
      "--work-dir", ".",
      "--output", "output",
    ])).toThrow("dedicated child directory");
  });

  it("canonicalizes a symlinked system ancestor but refuses a symlink workdir", () => {
    const root = temporaryDirectory();
    const real = path.join(root, "real-work");
    const linked = path.join(root, "linked-work");
    mkdirSync(real);
    symlinkSync(real, linked, "dir");
    expect(() => canonicalizeProofPath(linked, "--work-dir")).toThrow("symbolic link");
    const nested = canonicalizeProofPath(path.join(root, "missing", "proof"), "--work-dir");
    expect(path.isAbsolute(nested)).toBe(true);
  });

  it("defines materially distinct and fully isolated fixtures", () => {
    const [alpha, beta] = fixtureDefinitions("proof-run", 47_000);
    expect(alpha.plugins).toBe("auth,consent");
    expect(beta.plugins).toBe("auth,consent,crm");
    expect(alpha.route).toBe("/projects");
    expect(beta.route).toBe("/documents");
    expect(new Set([
      alpha.postgresPort,
      alpha.serverPort,
      alpha.clientPort,
      beta.postgresPort,
      beta.serverPort,
      beta.clientPort,
    ])).toHaveLength(6);
    expect(alpha.composeProjectName).not.toBe(beta.composeProjectName);
    expect(alpha.databaseName).not.toBe(beta.databaseName);
    expect(alpha.volumeName).not.toBe(beta.volumeName);
  });
});

describe("terminal FAIL settlement", () => {
  it("rolls back before cleanup and rebuilds FAIL evidence after recovery", async () => {
    const report = { status: "FAIL", pass: false, evidence: "original" };
    const harness = { state: { status: "running" } };
    const order = [];
    const recoveredReport = { status: "FAIL", pass: false, evidence: "includes-recovery" };
    const recover = vi.fn(async () => { order.push("recover"); });
    const buildRecoveredFail = vi.fn(() => {
      order.push("report");
      return recoveredReport;
    });
    const settled = await settleTerminalVerdict(harness, report, {
      recover,
      buildRecoveredFail,
    });
    expect(recover).toHaveBeenCalledOnce();
    expect(buildRecoveredFail).toHaveBeenCalledWith(harness, report);
    expect(order).toEqual(["recover", "report"]);
    expect(settled).toEqual({ report: recoveredReport, exitStatus: 1 });
    expect(harness.state.status).toBe("failed");
  });

  it("downgrades a failed terminal recovery to BLOCKED/code 2", async () => {
    const report = { status: "FAIL", pass: false };
    const harness = { state: { status: "running" } };
    const blockedReport = { status: "BLOCKED", pass: false };
    const buildBlocked = vi.fn(() => blockedReport);
    const settled = await settleTerminalVerdict(harness, report, {
      recover: async () => { throw new Error("rollback mismatch"); },
      buildBlocked,
    });
    expect(settled).toEqual({ report: blockedReport, exitStatus: 2 });
    expect(harness.state.status).toBe("blocked");
    expect(buildBlocked).toHaveBeenCalledWith(
      harness,
      expect.objectContaining({ step: "terminal-fail-recovery" }),
      true,
    );
  });
});

describe("proof filesystem and package guards", () => {
  it("customizes the authenticated consent helper from a real scaffold", () => {
    const target = path.join(temporaryDirectory(), "alpha");
    scaffold({
      projectName: "alpha",
      plugins: ["@stormeoio/auth", "@stormeoio/consent"],
      packageManager: "npm",
      withClient: true,
    }, target);
    const [definition] = fixtureDefinitions("real-scaffold", 47_000);
    customizeFixture(target, definition);
    const app = readFileSync(path.join(target, "client/src/App.tsx"), "utf8");
    expect(app).toContain('<ConsentBanner policyVersion="1.0-alpha" />');
    expect(app).toContain("/* storm:root-auth @stormeoio/consent:start */");
    expect(app).not.toContain("return user ? <ConsentBanner /> : null");
    const index = readFileSync(path.join(target, "client/index.html"), "utf8");
    expect(index.indexOf("data-storm-proof-page-errors"))
      .toBeLessThan(index.indexOf('type="module"'));
  });

  it("normalizes random pg_dump restrict keys without altering SQL", () => {
    const first = Buffer.from("\\restrict A1random\nCREATE TABLE proof(id int);\n\\unrestrict A1random\n");
    const second = Buffer.from("\\restrict B2random\nCREATE TABLE proof(id int);\n\\unrestrict B2random\n");
    expect(normalizePgDump(first).equals(normalizePgDump(second))).toBe(true);
    expect(normalizePgDump(first).toString("utf8")).toContain("CREATE TABLE proof(id int);");
  });

  it("writes JSON atomically and hashes deterministic trees", () => {
    const directory = temporaryDirectory();
    const jsonPath = path.join(directory, "state.json");
    atomicWriteJson(jsonPath, { status: "running", count: 1 });
    expect(JSON.parse(readFileSync(jsonPath, "utf8"))).toEqual({ status: "running", count: 1 });
    const first = hashTree(directory, { ignores: [] });
    const second = hashTree(directory, { ignores: [] });
    expect(first).toBe(second);
    expect(readFileSync(jsonPath, "utf8").endsWith("\n")).toBe(true);
  });

  it("refuses cleanup targets outside the dedicated work directory", () => {
    const directory = temporaryDirectory();
    expect(assertPathWithin(directory, path.join(directory, "fixtures", "alpha"))).toContain("alpha");
    expect(() => assertPathWithin(directory, path.dirname(directory))).toThrow(ProofBlockedError);
    expect(() => assertPathWithin(directory, directory)).toThrow("outside dedicated directory");
    const target = path.join(directory, "fixtures");
    const outside = temporaryDirectory();
    symlinkSync(outside, target, "dir");
    expect(() => assertPathWithin(directory, path.join(target, "alpha"))).toThrow("symbolic proof path");
  });

  it("classifies package and Drizzle changes without allowing client overwrites", () => {
    const changes = classifyUpdateChanges([
      "package.json",
      "package-lock.json",
      "drizzle/0001_target.sql",
      "client/src/App.tsx",
    ]);
    expect(changes.allowed).toEqual([
      "package.json",
      "package-lock.json",
      "drizzle/0001_target.sql",
    ]);
    expect(changes.forbidden).toEqual(["client/src/App.tsx"]);
  });

  it("detects additions, removals and content changes", () => {
    const directory = temporaryDirectory();
    writeFileSync(path.join(directory, "kept.txt"), "before", "utf8");
    writeFileSync(path.join(directory, "removed.txt"), "remove", "utf8");
    const before = fileManifest(directory, { ignores: [] });
    writeFileSync(path.join(directory, "kept.txt"), "after", "utf8");
    rmSync(path.join(directory, "removed.txt"));
    writeFileSync(path.join(directory, "added.txt"), "add", "utf8");
    const after = fileManifest(directory, { ignores: [] });
    expect(diffFileManifests(before, after)).toEqual(["added.txt", "kept.txt", "removed.txt"]);
  });

  it("patches only generated Storm Stack dependency entries", () => {
    const manifest = {
      dependencies: { "@stormeoio/core": "^0.1.0", express: "^5" },
      devDependencies: { "@stormeoio/cli": "^0.1.0" },
    };
    const artifacts = [
      { name: "@stormeoio/core", tarballPath: "/proof/core.tgz" },
      { name: "@stormeoio/cli", tarballPath: "/proof/cli.tgz" },
    ];
    const patched = patchStormDependencies(manifest, artifacts);
    expect(patched.packageJson.dependencies.express).toBe("^5");
    expect(patched.packageJson.dependencies["@stormeoio/core"]).toBe("file:/proof/core.tgz");
    expect(patched.installed).toEqual(["@stormeoio/cli", "@stormeoio/core"]);
    expect(manifest.dependencies["@stormeoio/core"]).toBe("^0.1.0");
  });

  it("rejects a tarball hash mismatch before installation", () => {
    const directory = temporaryDirectory();
    const tarballPath = path.join(directory, "core.tgz");
    writeFileSync(tarballPath, "packed bytes", "utf8");
    const actual = createHash("sha256").update("packed bytes").digest("hex");
    expect(() => assertArtifactHashes([{
      name: "@stormeoio/core",
      tarballPath,
      expectedSha256: "0".repeat(64),
      actualSha256: actual,
    }])).toThrow("Unexpected tarball hash");
  });

  it("rejects a stale lockfile train", () => {
    const appDir = temporaryDirectory();
    const tarballPath = path.join(appDir, "core.tgz");
    writeFileSync(tarballPath, "core", "utf8");
    writeFileSync(path.join(appDir, "package.json"), JSON.stringify({
      dependencies: { "@stormeoio/core": `file:${tarballPath}` },
    }), "utf8");
    writeFileSync(path.join(appDir, "package-lock.json"), JSON.stringify({
      packages: {
        "": { dependencies: { "@stormeoio/core": `file:${tarballPath}` } },
        "node_modules/@stormeoio/core": {
          version: "0.1.0",
          resolved: `file:${tarballPath}`,
        },
      },
    }), "utf8");
    expect(() => assertInstalledTrain(appDir, [{
      name: "@stormeoio/core",
      tarballPath,
    }], "0.1.1")).toThrow("Lockfile is stale");
  });

  it("rejects a registry-resolved lock even when its version looks current", () => {
    const appDir = temporaryDirectory();
    const tarballPath = path.join(appDir, "core.tgz");
    writeFileSync(tarballPath, "core", "utf8");
    writeFileSync(path.join(appDir, "package.json"), JSON.stringify({
      dependencies: { "@stormeoio/core": `file:${tarballPath}` },
    }), "utf8");
    writeFileSync(path.join(appDir, "package-lock.json"), JSON.stringify({
      packages: {
        "": { dependencies: { "@stormeoio/core": `file:${tarballPath}` } },
        "node_modules/@stormeoio/core": {
          version: "0.1.1",
          resolved: "https://registry.npmjs.org/@stormeoio/core/-/core-0.1.1.tgz",
        },
      },
    }), "utf8");
    expect(() => assertInstalledTrain(appDir, [{
      name: "@stormeoio/core",
      tarballPath,
    }], "0.1.1")).toThrow("is not a file tarball");
  });

  it("accepts only an exact file lock, integrity and installed package", () => {
    const appDir = temporaryDirectory();
    const tarballPath = path.join(appDir, "core.tgz");
    const bytes = Buffer.from("exact core tarball");
    writeFileSync(tarballPath, bytes);
    const installedDir = path.join(appDir, "node_modules/@stormeoio/core");
    mkdirSync(installedDir, { recursive: true });
    writeFileSync(path.join(installedDir, "package.json"), JSON.stringify({
      name: "@stormeoio/core",
      version: "0.1.1",
    }), "utf8");
    const specifier = `file:${tarballPath}`;
    writeFileSync(path.join(appDir, "package.json"), JSON.stringify({
      dependencies: { "@stormeoio/core": specifier },
    }), "utf8");
    writeFileSync(path.join(appDir, "package-lock.json"), JSON.stringify({
      packages: {
        "": { dependencies: { "@stormeoio/core": specifier } },
        "node_modules/@stormeoio/core": {
          version: "0.1.1",
          resolved: specifier,
          integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
        },
      },
    }), "utf8");
    expect(assertInstalledTrain(appDir, [{
      name: "@stormeoio/core",
      tarballPath,
    }], "0.1.1")).toEqual(["@stormeoio/core"]);
  });

  it("fails customization when an anchor is absent or ambiguous", () => {
    expect(replaceOnce("before anchor after", "anchor", "new")).toBe("before new after");
    expect(() => replaceOnce("no match", "anchor", "new")).toThrow("anchor missing");
    expect(() => replaceOnce("anchor anchor", "anchor", "new")).toThrow("ambiguous");
  });
});

describe("proof checkpoint resume", () => {
  it("validates runtime shape and binds it to the state run id", () => {
    const runtime = newRuntime("run-a", 47_000);
    expect(parseProofRuntime(runtime, "run-a", 47_000).runId).toBe("run-a");
    expect(() => parseProofRuntime(runtime, "run-b", 47_000)).toThrow("identity differ");
    expect(() => parseProofRuntime({ ...runtime, unexpected: true }, "run-a", 47_000)).toThrow();
    const drifted = structuredClone(runtime);
    drifted.fixtures.alpha.definition.composeProjectName = "unrelated-project";
    expect(() => parseProofRuntime(drifted, "run-a", 47_000)).toThrow("definition drift");
  });

  it("rejects stale or successful fault markers", () => {
    const interrupted = {
      runId: "run-a",
      fixture: "alpha",
      interruptedAt: "2026-08-09T00:00:00.000Z",
    };
    expect(parseInterruptionMarker(interrupted, "run-a")).toEqual(interrupted);
    expect(() => parseInterruptionMarker(interrupted, "run-b")).toThrow("another run");
    expect(() => parseBuildMarker({
      runId: "run-a",
      fixture: "alpha",
      commandId: "alpha:fault-build",
      exitCode: 0,
      injectedAt: "2026-08-09T00:00:00.000Z",
    }, "run-a")).toThrow();
  });

  it("persists atomically and refuses a drifted completed checkpoint", () => {
    const root = temporaryDirectory();
    const options = {
      baselineRef: "proof/base",
      targetRef: "target",
      workDir: path.join(root, "work"),
      outputDir: path.join(root, "output"),
      portBase: 47_000,
      resume: false,
      keepWorkDir: true,
    };
    const harness = new ProofHarness(options);
    harness.initialize();
    const alphaDir = path.join(options.workDir, "fixtures", "alpha");
    mkdirSync(alphaDir, { recursive: true });
    writeFileSync(path.join(alphaDir, "package.json"), "{}\n", "utf8");
    harness.completeStep("alpha", "generated", alphaDir);

    const resumed = new ProofHarness({ ...options, resume: true });
    resumed.initialize();
    expect(() => resumed.verifyResumeHashes("alpha", alphaDir)).not.toThrow();
    writeFileSync(path.join(alphaDir, "package.json"), "{\"drift\":true}\n", "utf8");
    expect(() => resumed.verifyResumeHashes("alpha", alphaDir)).toThrow("Checkpoint hash drift");
  });

  it("refuses a pre-existing cold cache on a new run", () => {
    const root = temporaryDirectory();
    const options = {
      baselineRef: "proof/base",
      targetRef: "target",
      workDir: path.join(root, "work"),
      outputDir: path.join(root, "output"),
      portBase: 47_000,
      resume: false,
      keepWorkDir: true,
    };
    mkdirSync(path.join(options.workDir, "cold-npm-cache"), { recursive: true });
    expect(() => new ProofHarness(options).initialize()).toThrow("must be absent");
  });

  it("rejects symlinked checkpoint files and fixture roots before resume reads", () => {
    const root = temporaryDirectory();
    const options = {
      baselineRef: "proof/base",
      targetRef: "target",
      workDir: path.join(root, "work"),
      outputDir: path.join(root, "output"),
      portBase: 47_000,
      resume: false,
      keepWorkDir: true,
    };
    const harness = new ProofHarness(options);
    harness.initialize();
    const statePath = path.join(options.workDir, "proof-state.json");
    const externalState = path.join(root, "external-state.json");
    writeFileSync(externalState, readFileSync(statePath));
    rmSync(statePath);
    symlinkSync(externalState, statePath);
    expect(() => new ProofHarness({ ...options, resume: true }).initialize()).toThrow("symbolic proof path");

    rmSync(statePath);
    writeFileSync(statePath, readFileSync(externalState));
    const externalFixture = path.join(root, "external-fixture");
    mkdirSync(externalFixture);
    mkdirSync(path.join(options.workDir, "fixtures"), { recursive: true });
    symlinkSync(externalFixture, path.join(options.workDir, "fixtures", "alpha"), "dir");
    expect(() => new ProofHarness({ ...options, resume: true }).initialize()).toThrow("symbolic proof path");
  });

  it("tracks mutation and recovery epochs independently", () => {
    const runtime = newRuntime("epoch-run", 47_000);
    const harness = { runtime, persist: vi.fn() };
    const [alpha] = fixtureDefinitions("epoch-run", 47_000);
    beginMutationEpoch(harness, alpha, "fault-update");
    const recovery = nextRecoveryAttempt(harness, alpha, "fault-update", "");
    recordRecoveryEpoch(harness, alpha, recovery, true);
    beginMutationEpoch(harness, alpha, "cold-update");
    completeMutationEpoch(harness, alpha, "target");
    const laterRecovery = nextRecoveryAttempt(harness, alpha, "outer-proof-failure");
    recordRecoveryEpoch(harness, alpha, laterRecovery, true);
    expect(runtime.fixtures.alpha).toMatchObject({
      mutationEpoch: 3,
      activeMutation: null,
      currentTrain: "baseline",
      recoveryAttempts: 2,
    });
    expect(runtime.fixtures.alpha.recoveryHistory).toHaveLength(2);
    expect(laterRecovery.suffix).toContain("recovery-e3-a2");
  });

  it("refuses to signal a persisted process group with a mismatched identity", async () => {
    const appDir = temporaryDirectory();
    const [definition] = fixtureDefinitions("pid-run", 47_000);
    const result = await terminatePersistedProcessGroups([{
      role: "server",
      pid: process.pid,
      pgid: process.pid + 1,
      cwd: appDir,
      command: "npm start",
      startedAt: "2026-08-09T00:00:00.000Z",
      active: true,
    }], definition, appDir);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("identity mismatch");
  });
});

describe("managed process-group cleanup", () => {
  function processFixture(root, managedProcesses) {
    const [definition] = fixtureDefinitions("process-run", 47_000);
    const fixtures = path.join(root, "fixtures");
    const appDir = path.join(fixtures, definition.name);
    mkdirSync(appDir, { recursive: true });
    const commands = [];
    const harness = {
      options: { workDir: root },
      paths: { fixtures },
      processes: new Map(),
      runtime: {
        fixtures: {
          [definition.name]: { managedProcesses },
        },
      },
      recordSyntheticCommand(command) {
        commands.push(command);
      },
    };
    return { appDir, commands, definition, harness };
  }

  function managedProcess(role, pid, cwd, active = true) {
    return {
      role,
      pid,
      pgid: pid,
      cwd,
      command: role === "server" ? "npm start" : "npm run dev:client",
      startedAt: "2026-08-09T00:00:00.000Z",
      active,
      ...(active ? {} : { stoppedAt: "2026-08-09T00:00:01.000Z" }),
    };
  }

  function liveRecord(serverPid, clientPid) {
    return {
      server: { pid: serverPid, exitCode: 0 },
      client: { pid: clientPid, exitCode: 0 },
      logHandle: -1,
    };
  }

  it("re-inspects every PGID after direct npm exits even when ports are free", async () => {
    const root = temporaryDirectory();
    const fixtures = path.join(root, "fixtures");
    const appDir = path.join(fixtures, "alpha");
    mkdirSync(appDir, { recursive: true });
    const canonicalAppDir = realpathSync(appDir);
    const managed = [
      managedProcess("server", 10_101, canonicalAppDir, false),
      managedProcess("client", 10_102, canonicalAppDir, false),
    ];
    const { commands, definition, harness } = processFixture(root, managed);
    harness.processes.set(definition.name, liveRecord(10_101, 10_102));
    const groups = new Map([
      [10_101, [{ pid: 20_101, pgid: 10_101, command: "node dist/index.js" }]],
      [10_102, []],
    ]);
    const inspectedPgids = [];
    const activeWhileOccupied = [];
    const directSignals = [];
    const groupSignals = [];

    await stopFixtureProcesses(harness, definition, "alpha:stop", true, {
      signalProcessTree(child, signal) {
        directSignals.push([child.pid, signal]);
        return true;
      },
      waitForChildExit: async () => true,
      waitForPortsReleased: async () => true,
      processGroupMembers(pgid) {
        inspectedPgids.push(pgid);
        const members = groups.get(pgid) ?? [];
        if (members.length > 0) {
          activeWhileOccupied.push(managed.find((record) => record.pgid === pgid).active);
        }
        return members;
      },
      processCwd: () => canonicalAppDir,
      signalProcessGroup(pgid, signal) {
        groupSignals.push([pgid, signal]);
        groups.set(pgid, []);
        return true;
      },
      waitForGroupExit: async () => true,
    });

    expect(directSignals).toEqual([
      [10_101, "SIGTERM"],
      [10_102, "SIGTERM"],
    ]);
    expect(new Set(inspectedPgids)).toEqual(new Set([10_101, 10_102]));
    expect(activeWhileOccupied).toEqual([true]);
    expect(groupSignals).toEqual([[10_101, "SIGTERM"]]);
    expect(managed.every(({ active }) => active === false)).toBe(true);
    expect(harness.processes.has(definition.name)).toBe(false);
    expect(commands[0]).toMatchObject({ exitCode: 0, required: true });
  });

  it("fails and keeps a record active while a non-listening descendant remains", async () => {
    const root = temporaryDirectory();
    const fixtures = path.join(root, "fixtures");
    const appDir = path.join(fixtures, "alpha");
    mkdirSync(appDir, { recursive: true });
    const canonicalAppDir = realpathSync(appDir);
    const managed = [
      managedProcess("server", 11_101, canonicalAppDir),
      managedProcess("client", 11_102, canonicalAppDir),
    ];
    const { commands, definition, harness } = processFixture(root, managed);
    harness.processes.set(definition.name, liveRecord(11_101, 11_102));
    const descendant = { pid: 21_101, pgid: 11_101, command: "node background-worker.js" };
    const groupSignals = [];

    await stopFixtureProcesses(harness, definition, "alpha:stop", false, {
      signalProcessTree: () => true,
      waitForChildExit: async () => true,
      waitForPortsReleased: async () => true,
      processGroupMembers: (pgid) => (pgid === 11_101 ? [descendant] : []),
      processCwd: () => canonicalAppDir,
      signalProcessGroup(pgid, signal) {
        groupSignals.push([pgid, signal]);
        return true;
      },
      waitForGroupExit: async () => false,
    });

    expect(groupSignals).toEqual([
      [11_101, "SIGTERM"],
      [11_101, "SIGKILL"],
    ]);
    expect(managed[0].active).toBe(true);
    expect(managed[0]).not.toHaveProperty("stoppedAt");
    expect(managed[1].active).toBe(false);
    expect(harness.processes.has(definition.name)).toBe(true);
    expect(commands[0]).toMatchObject({ exitCode: 1, required: false });
    expect(commands[0].detail).toContain("remaining=1");
  });
});

describe("concurrent fixture proof", () => {
  it("proves distinct HTTP identities and isolated rows while both fixtures run", async () => {
    const requested = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const endpoint = String(url);
      requested.push(endpoint);
      const client = endpoint.endsWith("/") && !endpoint.endsWith("/api/health");
      const fixture = endpoint.includes(":4700") ? "alpha" : "beta";
      return {
        ok: true,
        status: 200,
        text: async () => client
          ? `<html><title>${fixture}</title></html>`
          : '{"ok":true,"uptime":1}',
      };
    }));
    const commands = [];
    const harness = {
      recordSyntheticCommand(command) {
        commands.push(command);
      },
    };
    await verifyConcurrentFixtures(
      harness,
      fixtureDefinitions("run", 47_000),
      {
        databaseProbe: (definition) => ({
          fixture: definition.name,
          databaseName: definition.databaseName,
          rows: definition.hasCrm
            ? "beta-record:beta-client-migration-data-v1"
            : "alpha-record:alpha-project-data-v1",
          expectedRows: definition.hasCrm
            ? "beta-record:beta-client-migration-data-v1"
            : "alpha-record:alpha-project-data-v1",
          isolated: true,
        }),
      },
    );
    expect(requested).toEqual([
      "http://127.0.0.1:47002/api/health",
      "http://127.0.0.1:47003/",
      "http://127.0.0.1:47012/api/health",
      "http://127.0.0.1:47013/",
    ]);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      id: "verify-concurrent-isolation",
      exitCode: 0,
      required: true,
    });
    expect(commands[0].detail).toContain('"identityMatched": true');
    expect(commands[0].detail).toContain('"isolated": true');
  });

  it("fails closed when one fixture can see the other fixture's business row", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => ({
      ok: true,
      status: 200,
      text: async () => String(url).endsWith("/api/health")
        ? '{"ok":true}'
        : `<title>${String(url).includes(":47003") ? "alpha" : "beta"}</title>`,
    })));
    const commands = [];
    await verifyConcurrentFixtures(
      { recordSyntheticCommand: (command) => commands.push(command) },
      fixtureDefinitions("run", 47_000),
      {
        databaseProbe: (definition) => ({
          fixture: definition.name,
          databaseName: definition.databaseName,
          rows: "alpha-record:alpha-project-data-v1,beta-record:beta-client-migration-data-v1",
          expectedRows: `${definition.name}-record`,
          isolated: false,
        }),
      },
    );
    expect(commands[0]).toMatchObject({
      id: "verify-concurrent-isolation",
      exitCode: 1,
      required: true,
    });
  });
});

function packedConsentArtifact(root, label, version, declaration, clientExport) {
  const packageRoot = path.join(root, `${label}-package`, "package");
  mkdirSync(path.join(packageRoot, "dist/client"), { recursive: true });
  writeFileSync(path.join(packageRoot, "dist/client/index.d.ts"), declaration, "utf8");
  writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
    name: "@stormeoio/consent",
    version,
    exports: { "./client": clientExport },
  }), "utf8");
  const tarballPath = path.join(root, `consent-${label}.tgz`);
  const packed = spawnSync("tar", ["-czf", tarballPath, "-C", path.dirname(packageRoot), "package"]);
  if (packed.status !== 0) throw new Error(`test tar failed: ${packed.stderr}`);
  const digest = createHash("sha256").update(readFileSync(tarballPath)).digest("hex");
  return {
    name: "@stormeoio/consent",
    version,
    workspace: "packages/plugin-consent",
    filename: path.basename(tarballPath),
    tarballPath,
    commit: label === "baseline" ? "a".repeat(40) : "b".repeat(40),
    expectedSha256: digest,
    actualSha256: digest,
  };
}

function gitTestCommand(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`test git failed: ${result.stderr}`);
  return result.stdout.trim();
}

function checkpointArtifactTrain(directory, version, commit, bytesByName) {
  mkdirSync(directory, { recursive: true });
  return REQUIRED_RELEASE_PACKAGES.map((name, index) => {
    const filename = `${name.replace("@stormeoio/", "stormeoio-")}-${version}.tgz`;
    const tarballPath = path.join(directory, filename);
    const bytes = bytesByName.get(name) ?? Buffer.from(`artifact-${name}`);
    writeFileSync(tarballPath, bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    return {
      name,
      version,
      workspace: `packages/release-${index}`,
      filename,
      tarballPath,
      commit,
      expectedSha256: digest,
      actualSha256: digest,
    };
  });
}

describe("checkpoint artifact revalidation", () => {
  it("rebuilds from the immutable commit and detects coherent runtime/tarball tampering", () => {
    const root = temporaryDirectory();
    const workDir = path.join(root, "work");
    const worktree = path.join(workDir, "source-worktrees/baseline");
    mkdirSync(path.join(worktree, "scripts"), { recursive: true });
    writeFileSync(path.join(worktree, "package.json"), JSON.stringify({ version: "0.1.0" }), "utf8");
    writeFileSync(path.join(worktree, "scripts/pack-tarballs.mjs"), "export {};\n", "utf8");
    gitTestCommand(worktree, ["init", "-q"]);
    gitTestCommand(worktree, ["add", "."]);
    gitTestCommand(worktree, [
      "-c", "user.name=Proof Test", "-c", "user.email=proof@example.test",
      "commit", "-qm", "baseline",
    ]);
    const commit = gitTestCommand(worktree, ["rev-parse", "HEAD"]);
    const stableBytes = new Map(REQUIRED_RELEASE_PACKAGES.map((name) => [
      name,
      Buffer.from(`immutable-${name}`),
    ]));
    const existing = checkpointArtifactTrain(
      path.join(workDir, "artifacts/baseline"),
      "0.1.0",
      commit,
      stableBytes,
    );
    const commands = [{ id: "pack-baseline", required: true, exitCode: 0 }];
    const harness = {
      options: { workDir },
      paths: { artifactRevalidation: path.join(workDir, "artifact-revalidation") },
      runtime: { commands },
      runCommand({ id, args }) {
        const destination = args[args.indexOf("--destination") + 1];
        const rebuilt = checkpointArtifactTrain(destination, "0.1.0", commit, stableBytes);
        writeFileSync(path.join(destination, "tarballs-manifest.json"), JSON.stringify({
          schemaVersion: 2,
          commit,
          rootVersion: "0.1.0",
          dirty: false,
          artifacts: rebuilt.map((artifact) => ({
            name: artifact.name,
            version: artifact.version,
            workspace: artifact.workspace,
            filename: artifact.filename,
            sha256: artifact.actualSha256,
          })),
        }), "utf8");
        commands.push({ id, required: false, exitCode: 0 });
      },
      recordSyntheticCommand(command) {
        commands.push(command);
      },
    };

    expect(revalidateCheckpointArtifacts(harness, {
      label: "baseline",
      worktree,
      commit,
      version: "0.1.0",
      existing,
      requiredCommandIds: ["pack-baseline"],
    })).toHaveLength(REQUIRED_RELEASE_PACKAGES.length);
    expect(commands.some(({ id }) => id === "revalidate-artifacts-baseline")).toBe(true);

    const tampered = Buffer.from("coherent-runtime-and-tarball-tamper");
    writeFileSync(existing[0].tarballPath, tampered);
    const tamperedHash = createHash("sha256").update(tampered).digest("hex");
    existing[0].expectedSha256 = tamperedHash;
    existing[0].actualSha256 = tamperedHash;
    expect(() => revalidateCheckpointArtifacts(harness, {
      label: "baseline",
      worktree,
      commit,
      version: "0.1.0",
      existing,
      requiredCommandIds: ["pack-baseline"],
    })).toThrow("differ from the immutable rebuild");
    expect(commands.some(({ id }) => id === "revalidate-artifacts-baseline-resume-2")).toBe(true);
  });
});

describe("Consent release gates", () => {
  it("byte-compares packed React declarations and the ./client export map", () => {
    const root = temporaryDirectory();
    const declaration = "export interface ConsentBannerProps { apiBaseUrl?: string; policyVersion?: string; className?: string; }\n";
    const clientExport = {
      types: "./dist/client/index.d.ts",
      import: "./dist/client/index.mjs",
      require: "./dist/client/index.js",
    };
    const baseline = packedConsentArtifact(root, "baseline", "0.1.0", declaration, clientExport);
    const target = packedConsentArtifact(root, "target", "0.1.1", declaration, clientExport);
    const stable = inspectConsentClientApiStability([baseline], [target]);
    expect(stable).toMatchObject({
      declarationBytesEqual: true,
      declarationHashesEqual: true,
      clientExportsEqual: true,
      pass: true,
    });

    const changed = packedConsentArtifact(root, "changed", "0.1.1", `${declaration}export type Drift = true;\n`, {
      ...clientExport,
      browser: "./dist/client/index.mjs",
    });
    expect(inspectConsentClientApiStability([baseline], [changed])).toMatchObject({
      declarationBytesEqual: false,
      clientExportsEqual: false,
      pass: false,
    });
  });

  it("accepts only the additive withdrawn_at migration shape", () => {
    const appDir = temporaryDirectory();
    const drizzle = path.join(appDir, "drizzle");
    mkdirSync(drizzle);
    writeFileSync(path.join(drizzle, "0000_baseline.sql"), "CREATE TABLE proof (id integer);\n", "utf8");
    const before = migrationSqlSnapshot(appDir);
    const targetSql = path.join(drizzle, "0001_consent.sql");
    writeFileSync(
      targetSql,
      'ALTER TABLE "storm_consent_preferences" ADD COLUMN "withdrawn_at" timestamp with time zone;\n',
      "utf8",
    );
    expect(inspectConsentAdditiveMigration(appDir, before)).toMatchObject({ pass: true });

    writeFileSync(
      targetSql,
      'ALTER TABLE "storm_consent_preferences" ADD COLUMN "withdrawn_at" timestamp with time zone NOT NULL DEFAULT now();\n',
      "utf8",
    );
    const rejected = inspectConsentAdditiveMigration(appDir, before);
    expect(rejected.pass).toBe(false);
    expect(rejected.inspected[0].destructivePatterns).toEqual(["DEFAULT", "NOT NULL"]);

    writeFileSync(
      targetSql,
      'ALTER TABLE "storm_consent_preferences" RENAME COLUMN "withdrawn_at" TO "removed_at"; DROP TABLE "proof";\n',
      "utf8",
    );
    expect(inspectConsentAdditiveMigration(appDir, before).inspected[0].destructivePatterns)
      .toEqual(["DROP", "RENAME"]);
  });

  it("refuses changes or deletions in historical SQL migrations", () => {
    const appDir = temporaryDirectory();
    const drizzle = path.join(appDir, "drizzle");
    mkdirSync(drizzle);
    const baselineSql = path.join(drizzle, "0000_baseline.sql");
    writeFileSync(baselineSql, "CREATE TABLE proof (id integer);\n", "utf8");
    const before = migrationSqlSnapshot(appDir);
    writeFileSync(
      path.join(drizzle, "0001_consent.sql"),
      'ALTER TABLE "storm_consent_preferences" ADD COLUMN "withdrawn_at" timestamp with time zone;\n',
      "utf8",
    );

    writeFileSync(baselineSql, "CREATE TABLE proof (id bigint);\n", "utf8");
    const modified = inspectConsentAdditiveMigration(appDir, before);
    expect(modified.pass).toBe(false);
    expect(modified.historicalModified).toEqual(["0000_baseline.sql"]);

    rmSync(baselineSql);
    const deleted = inspectConsentAdditiveMigration(appDir, before);
    expect(deleted.pass).toBe(false);
    expect(deleted.historicalDeleted).toEqual(["0000_baseline.sql"]);
  });
});

describe("proof Markdown", () => {
  it("links the validated JSON evidence and never claims an incomplete pass", () => {
    const markdown = renderProofMarkdown({
      schemaVersion: 1,
      status: "BLOCKED",
      pass: false,
      runId: "run",
      startedAt: "2026-08-09T00:00:00.000Z",
      finishedAt: "2026-08-09T00:00:01.000Z",
      baseRef: "proof/base",
      targetRef: "target",
      nodeVersion: "v20.20.2",
      platform: "test",
      cacheMode: "mixed",
      sourceArtifacts: [],
      targetArtifacts: [],
      fixtures: [],
      faultMatrix: [],
      commands: [],
      stoppedAtStep: "resolve-baseline",
      error: "baseline tag missing",
    });
    expect(markdown).toContain("Verdict : **BLOCKED**");
    expect(markdown).toContain("Calcul PASS : **false**");
    expect(markdown).toContain("[proof-report.json](./proof-report.json)");
    expect(markdown).not.toContain("Verdict: **PASS**");
  });
});
