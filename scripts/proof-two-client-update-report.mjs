import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PROOF_SCHEMA_VERSION,
  REQUIRED_FAULT_IDS,
  computeProofPass,
  parseProofReport,
  parseProofState,
} from "./proof-model.mjs";
import {
  ProofBlockedError,
  REPOSITORY_ROOT,
  assertPathWithin,
  atomicWriteJson,
  atomicWriteText,
  commandEnvironment,
  exitCode,
  fixtureDefinitions,
  nowIso,
  parseProofRuntime,
  readJson,
} from "./proof-two-client-update-helpers.mjs";
import {
  dockerArgs,
  dockerEnv,
  fixtureAppDir,
} from "./proof-two-client-update-fixtures.mjs";
import {
  terminateProcessRecord,
  terminatePersistedProcessGroups,
  waitForFixturePortsReleased,
} from "./proof-two-client-update-processes.mjs";

function fixtureReport(harness, definition) {
  const runtime = harness.runtime.fixtures[definition.name];
  if (!runtime.recovery) {
    throw new ProofBlockedError(`Fixture ${definition.name} has no recovery evidence`, "report");
  }
  if (!runtime.warmCompleted || !runtime.warmMigrationNoop) {
    throw new ProofBlockedError(`Fixture ${definition.name} has no complete warm lifecycle`, "report");
  }
  if (Object.values(runtime.cache).some((snapshot) => snapshot === null)) {
    throw new ProofBlockedError(`Fixture ${definition.name} has incomplete cache evidence`, "report");
  }
  return {
    name: definition.name,
    composeProjectName: definition.composeProjectName,
    postgresPort: definition.postgresPort,
    serverPort: definition.serverPort,
    clientPort: definition.clientPort,
    databaseName: definition.databaseName,
    volumeName: definition.volumeName,
    timings: runtime.timings,
    commands: runtime.commands,
    changedFiles: runtime.changedFiles,
    sentinels: runtime.sentinels,
    migrationNoop: runtime.migrationNoop,
    warmCompleted: runtime.warmCompleted,
    warmMigrationNoop: runtime.warmMigrationNoop,
    mutationSettled: runtime.activeMutation === null && runtime.currentTrain === "target",
    cache: runtime.cache,
    recovery: runtime.recovery,
    recoveryHistory: runtime.recoveryHistory,
  };
}

function completeFixtureReports(harness) {
  return Object.values(harness.runtime.fixtures)
    .filter((runtime) => harness.hasStep(runtime.definition.name, "stopped-final") && runtime.recovery)
    .map((runtime) => fixtureReport(harness, runtime.definition));
}

function orderedFaultMatrix(harness, fillMissing) {
  const byId = new Map(harness.runtime.faultMatrix.map((fault) => [fault.id, fault]));
  return REQUIRED_FAULT_IDS.flatMap((id) => {
    const value = byId.get(id);
    if (value) return [value];
    return fillMissing ? [{ id, passed: false, detail: "Fault path was not exercised." }] : [];
  });
}

function commonReport(harness) {
  return {
    schemaVersion: PROOF_SCHEMA_VERSION,
    runId: harness.state.runId,
    startedAt: harness.state.startedAt,
    finishedAt: nowIso(),
    nodeVersion: process.version,
    platform: `${os.platform()}-${os.arch()}`,
    cacheMode: "mixed",
    baseRef: harness.state.baseRef,
    targetRef: harness.state.targetRef,
    ...(harness.runtime.baseCommit ? { baseCommit: harness.runtime.baseCommit } : {}),
    ...(harness.runtime.targetCommit ? { targetCommit: harness.runtime.targetCommit } : {}),
    sourceArtifacts: harness.runtime.sourceArtifacts,
    targetArtifacts: harness.runtime.targetArtifacts,
    commands: harness.runtime.commands,
    fixtures: completeFixtureReports(harness),
  };
}

export function buildTerminalReport(harness) {
  const candidate = {
    ...commonReport(harness),
    status: "PASS",
    pass: true,
    faultMatrix: orderedFaultMatrix(harness, true),
  };
  if (computeProofPass(candidate)) return parseProofReport(candidate);
  return parseProofReport({
    ...commonReport(harness),
    status: "FAIL",
    pass: false,
    faultMatrix: orderedFaultMatrix(harness, true),
    stoppedAtStep: "proof-verdict",
    error: "Evidence is incomplete or inconsistent; computeProofPass refused PASS.",
  });
}

export function buildStoppedReport(harness, error, blocked) {
  return parseProofReport({
    ...commonReport(harness),
    status: blocked ? "BLOCKED" : "FAIL",
    pass: false,
    faultMatrix: orderedFaultMatrix(harness, false),
    stoppedAtStep: error?.step ?? error?.result?.id ?? "unhandled-error",
    error: error instanceof Error ? error.message : String(error),
  });
}

export function buildEmergencyReport(options, error) {
  const timestamp = nowIso();
  return parseProofReport({
    schemaVersion: PROOF_SCHEMA_VERSION,
    runId: `unavailable-${Date.now()}`,
    startedAt: timestamp,
    finishedAt: timestamp,
    nodeVersion: process.version,
    platform: `${os.platform()}-${os.arch()}`,
    cacheMode: "mixed",
    baseRef: options.baselineRef,
    targetRef: options.targetRef,
    sourceArtifacts: [],
    targetArtifacts: [],
    commands: [],
    fixtures: [],
    faultMatrix: [],
    status: "BLOCKED",
    pass: false,
    stoppedAtStep: error?.step ?? "initialize",
    error: error instanceof Error ? error.message : String(error),
  });
}

function tableValue(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function renderCommands(lines, title, commands) {
  lines.push(title, "", "| # | ID | Début | Fin | ms | Code | Requis | Essai | Commande | Log |", "|---:|---|---|---|---:|---:|---:|---:|---|---|");
  commands.forEach((command, index) => {
    lines.push(`| ${index + 1} | \`${tableValue(command.id)}\` | ${command.startedAt} | ${command.finishedAt} | ${command.durationMs} | ${command.exitCode} | ${command.required} | ${command.attempt} | \`${tableValue(command.command)}\` | \`${tableValue(command.logPath)}\` |`);
  });
  if (commands.length === 0) lines.push("| - | - | - | - | - | - | - | - | - | - |");
  lines.push("");
}

export function renderProofMarkdown(report) {
  const lines = [
    "# Storm Stack Phase C proof",
    "",
    `- Schéma : ${report.schemaVersion}`,
    `- Verdict : **${report.status}**`,
    `- Calcul PASS : **${report.pass}**`,
    `- Run : \`${report.runId}\``,
    `- Période : ${report.startedAt} → ${report.finishedAt}`,
    `- Baseline : \`${report.baseRef}\`${report.baseCommit ? ` (\`${report.baseCommit}\`)` : ""}`,
    `- Target : \`${report.targetRef}\`${report.targetCommit ? ` (\`${report.targetCommit}\`)` : ""}`,
    `- Runtime : ${report.nodeVersion} sur ${report.platform}`,
    `- Cache : ${report.cacheMode}`,
    "- Preuve machine : [proof-report.json](./proof-report.json)",
    "",
  ];
  if (report.error) lines.push(`> Étape \`${report.stoppedAtStep}\` : ${report.error}`, "");

  lines.push("## Artefacts", "", "| Train | Package | Version | Workspace | Fichier | Commit | SHA-256 attendu | SHA-256 réel | Tarball |", "|---|---|---|---|---|---|---|---|---|");
  for (const [train, artifacts] of [["baseline", report.sourceArtifacts], ["target", report.targetArtifacts]]) {
    for (const artifact of artifacts) {
      lines.push(`| ${train} | \`${artifact.name}\` | ${artifact.version} | \`${artifact.workspace}\` | \`${artifact.filename}\` | \`${artifact.commit}\` | \`${artifact.expectedSha256}\` | \`${artifact.actualSha256}\` | \`${tableValue(artifact.tarballPath)}\` |`);
    }
  }
  if (report.sourceArtifacts.length + report.targetArtifacts.length === 0) lines.push("| - | - | - | - | - | - | - | - | - |");
  lines.push("");
  renderCommands(lines, "## Commandes globales ordonnées", report.commands);

  lines.push("## Fixtures", "");
  if (report.fixtures.length === 0) lines.push("Aucune fixture n’a atteint un cycle complet vérifié.", "");
  for (const fixture of report.fixtures) {
    lines.push(
      `### ${fixture.name}`,
      "",
      `- Compose : \`${fixture.composeProjectName}\``,
      `- Base/volume : \`${fixture.databaseName}\` / \`${fixture.volumeName}\``,
      `- Ports : PostgreSQL ${fixture.postgresPort}, serveur ${fixture.serverPort}, client ${fixture.clientPort}`,
      `- No-op migration cold/warm : ${fixture.migrationNoop} / ${fixture.warmMigrationNoop}`,
      `- Warm complet : ${fixture.warmCompleted}`,
      `- Mutation soldée : ${fixture.mutationSettled}`,
      `- Recovery initial : attempted=${fixture.recovery.attempted}, appRestarted=${fixture.recovery.appRestarted}`,
      "",
      "#### Chronos",
      "",
      "| Mesure | ms |",
      "|---|---:|",
    );
    for (const [name, duration] of Object.entries(fixture.timings)) lines.push(`| ${name} | ${duration} |`);
    lines.push("", "#### Cache npm", "", "| Phase | Chemin | Existe | Fichiers | SHA-256 |", "|---|---|---:|---:|---|");
    for (const [phase, snapshot] of Object.entries(fixture.cache)) {
      lines.push(`| ${phase} | \`${tableValue(snapshot.path)}\` | ${snapshot.exists} | ${snapshot.fileCount} | \`${snapshot.hash ?? ""}\` |`);
    }
    lines.push("", "#### Fichiers", "", `- Autorisés (${fixture.changedFiles.allowed.length}) : ${fixture.changedFiles.allowed.map((file) => `\`${file}\``).join(", ") || "aucun"}`, `- Interdits (${fixture.changedFiles.forbidden.length}) : ${fixture.changedFiles.forbidden.map((file) => `\`${file}\``).join(", ") || "aucun"}`, "");
    lines.push("#### Sentinelles", "", "| Sentinelle | Résultat |", "|---|---:|");
    for (const [name, passed] of Object.entries(fixture.sentinels)) lines.push(`| \`${name}\` | ${passed} |`);
    lines.push("", "#### Fingerprints de recovery", "", "| Fingerprint | Avant | Après | Identique |", "|---|---|---|---:|");
    for (const key of Object.keys(fixture.recovery.before)) {
      const before = fixture.recovery.before[key];
      const after = fixture.recovery.after[key];
      lines.push(`| ${key} | \`${before}\` | \`${after}\` | ${before === after} |`);
    }
    lines.push("", "#### Historique des recoveries", "", "| Epoch | Phase | Essai | Suffixe | Exact | Fin |", "|---:|---|---:|---|---:|---|");
    for (const recovery of fixture.recoveryHistory) {
      lines.push(`| ${recovery.epoch} | ${tableValue(recovery.phase)} | ${recovery.attempt} | \`${recovery.suffix}\` | ${recovery.exact} | ${recovery.finishedAt} |`);
    }
    if (fixture.recoveryHistory.length === 0) lines.push("| - | - | - | - | - | - |");
    lines.push("");
    renderCommands(lines, `#### Commandes ${fixture.name} ordonnées`, fixture.commands);
  }

  lines.push("## Matrice de fautes", "", "| Faute | Fixture | Résultat | Détail |", "|---|---|---:|---|");
  for (const fault of report.faultMatrix) {
    lines.push(`| \`${fault.id}\` | ${fault.fixture ?? "-"} | ${fault.passed ? "PASS" : "FAIL"} | ${tableValue(fault.detail)} |`);
  }
  if (report.faultMatrix.length === 0) lines.push("| - | - | - | - |");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function writeProofReport(harness, report) {
  const validated = parseProofReport(report);
  atomicWriteJson(harness.paths.reportJson, validated);
  atomicWriteText(harness.paths.reportMarkdown, renderProofMarkdown(validated));
  return validated;
}

export async function cleanupHarness(harness) {
  const cleanupLines = [];
  let ok = true;
  const definitions = fixtureDefinitions(harness.state.runId, harness.state.portBase);
  for (const definition of definitions) {
    const runtime = harness.runtime.fixtures[definition.name];
    const processRecord = harness.processes.get(definition.name);
    if (processRecord) {
      const stopped = await terminateProcessRecord(processRecord, definition);
      const stoppedCleanly = stopped.portsReleased;
      ok = ok && stoppedCleanly;
      cleanupLines.push(`${definition.name}: managed process cleanup portsReleased=${stopped.portsReleased} forced=${stopped.forced}`);
      harness.processes.delete(definition.name);
    }
    const appDir = assertPathWithin(harness.options.workDir, fixtureAppDir(harness, definition));
    const persisted = await terminatePersistedProcessGroups(runtime.managedProcesses, definition, appDir);
    ok = ok && persisted.ok;
    cleanupLines.push(`${definition.name}: persisted process cleanup ${persisted.detail}`);
    if (existsSync(path.join(appDir, "docker-compose.yml"))) {
      const down = spawnSync(
        "docker",
        dockerArgs(definition, ["down", "--volumes", "--remove-orphans", "--timeout", "10"]),
        {
          cwd: appDir,
          env: commandEnvironment(dockerEnv(definition)),
          encoding: "utf8",
          timeout: 60_000,
        },
      );
      const status = exitCode(down);
      const portsReleased = status === 0
        ? await waitForFixturePortsReleased(definition, true)
        : false;
      ok = ok && status === 0 && portsReleased;
      cleanupLines.push(`${definition.name}: docker down exit=${status} portsReleased=${portsReleased} ${(down.stderr ?? "").trim()}`);
    }
  }

  if (!harness.options.keepWorkDir) {
    for (const label of ["baseline", "target"]) {
      const worktree = path.join(harness.paths.worktrees, label);
      if (!existsSync(worktree)) continue;
      assertPathWithin(harness.options.workDir, worktree);
      const removed = spawnSync("git", ["worktree", "remove", "--force", worktree], {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
        timeout: 60_000,
      });
      const status = exitCode(removed);
      ok = ok && status === 0;
      cleanupLines.push(`${label}: git worktree remove exit=${status} ${(removed.stderr ?? "").trim()}`);
    }
    const pruned = spawnSync("git", ["worktree", "prune"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      timeout: 30_000,
    });
    const status = exitCode(pruned);
    ok = ok && status === 0;
    cleanupLines.push(`git worktree prune exit=${status} ${(pruned.stderr ?? "").trim()}`);
  }
  atomicWriteText(path.join(harness.options.workDir, "cleanup.log"), `${cleanupLines.join("\n")}\n`);
  harness.persist();
  return { ok, detail: cleanupLines.join("; ") || "No cleanup action was necessary." };
}

export async function cleanupAbandonedProof(options) {
  const cleanupLines = [];
  let ok = true;
  let state;
  let runtime;
  try {
    const statePath = assertPathWithin(options.workDir, path.join(options.workDir, "proof-state.json"));
    const runtimePath = assertPathWithin(options.workDir, path.join(options.workDir, "proof-runtime.json"));
    state = parseProofState(readJson(statePath));
    runtime = parseProofRuntime(
      readJson(runtimePath),
      state.runId,
      state.portBase,
    );
  } catch (error) {
    cleanupLines.push(`checkpoint identity unavailable: ${error instanceof Error ? error.message : String(error)}`);
    ok = false;
  }
  const definitions = state ? fixtureDefinitions(state.runId, state.portBase) : [];
  for (const definition of definitions) {
    const appDir = assertPathWithin(
      options.workDir,
      path.join(options.workDir, "fixtures", definition.name),
    );
    if (runtime) {
      const persisted = await terminatePersistedProcessGroups(
        runtime.fixtures[definition.name].managedProcesses,
        definition,
        appDir,
      );
      ok = ok && persisted.ok;
      cleanupLines.push(`${definition.name}: abandoned process cleanup ${persisted.detail}`);
    }
    if (!existsSync(path.join(appDir, "docker-compose.yml"))) continue;
    const down = spawnSync("docker", dockerArgs(definition, ["down", "--volumes", "--remove-orphans", "--timeout", "10"]), {
      cwd: appDir,
      env: commandEnvironment(dockerEnv(definition)),
      encoding: "utf8",
      timeout: 60_000,
    });
    const status = exitCode(down);
    const portsReleased = status === 0
      ? await waitForFixturePortsReleased(definition, true)
      : false;
    ok = ok && status === 0 && portsReleased;
    cleanupLines.push(`${definition.name}: abandoned docker down exit=${status} portsReleased=${portsReleased} ${(down.stderr ?? "").trim()}`);
  }
  if (runtime) {
    const runtimePath = assertPathWithin(options.workDir, path.join(options.workDir, "proof-runtime.json"));
    atomicWriteJson(runtimePath, runtime);
  }
  if (!options.keepWorkDir) {
    for (const label of ["baseline", "target"]) {
      const worktree = path.join(options.workDir, "source-worktrees", label);
      if (!existsSync(worktree)) continue;
      assertPathWithin(options.workDir, worktree);
      const removed = spawnSync("git", ["worktree", "remove", "--force", worktree], {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
        timeout: 60_000,
      });
      const status = exitCode(removed);
      ok = ok && status === 0;
      cleanupLines.push(`${label}: abandoned worktree remove exit=${status} ${(removed.stderr ?? "").trim()}`);
    }
  }
  atomicWriteText(path.join(options.workDir, "cleanup.log"), `${cleanupLines.join("\n")}\n`);
  return { ok, detail: cleanupLines.join("; ") || "No abandoned resource was found." };
}
