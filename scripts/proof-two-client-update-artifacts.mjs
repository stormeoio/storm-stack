import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";

import {
  ProofBlockedError,
  assertArtifactHashes,
  assertPathWithin,
  convertPackManifest,
  exitCode,
  nowIso,
  readJson,
} from "./proof-two-client-update-helpers.mjs";

function gitValue(worktree, args, step) {
  const result = spawnSync("git", args, {
    cwd: worktree,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (exitCode(result) !== 0) {
    throw new ProofBlockedError(
      `git ${args.join(" ")} failed in checkpoint worktree: ${result.stderr ?? ""}`,
      step,
    );
  }
  return String(result.stdout).trim();
}

export function assertCheckpointWorktree(worktree, expectedCommit, expectedVersion, label) {
  if (!existsSync(worktree)) {
    throw new ProofBlockedError(
      `${label} checkpoint worktree is missing; canonical pack commands cannot be replayed`,
      `revalidate-artifacts-${label}`,
    );
  }
  const actualCommit = gitValue(worktree, ["rev-parse", "HEAD"], `revalidate-artifacts-${label}`);
  const dirty = gitValue(
    worktree,
    ["status", "--porcelain", "--untracked-files=all"],
    `revalidate-artifacts-${label}`,
  );
  const rootManifest = readJson(assertPathWithin(worktree, path.join(worktree, "package.json")));
  if (actualCommit !== expectedCommit || dirty || rootManifest.version !== expectedVersion) {
    throw new ProofBlockedError(
      `${label} checkpoint worktree no longer matches ${expectedCommit}@${expectedVersion}`,
      `revalidate-artifacts-${label}`,
    );
  }
  return { actualCommit, version: rootManifest.version };
}

function assertRequiredEvidence(harness, commandIds, label) {
  for (const commandId of commandIds) {
    const command = harness.runtime.commands.find(({ id }) => id === commandId);
    if (!command || !command.required || command.exitCode !== 0) {
      throw new ProofBlockedError(
        `${label} checkpoint lacks successful required evidence ${commandId}`,
        `revalidate-artifacts-${label}`,
      );
    }
  }
}

function comparableArtifacts(artifacts) {
  return artifacts.map((artifact) => ({
    name: artifact.name,
    version: artifact.version,
    workspace: artifact.workspace,
    filename: artifact.filename,
    commit: artifact.commit,
    expectedSha256: artifact.expectedSha256,
    actualSha256: artifact.actualSha256,
  }));
}

function nextRevalidation(harness, label) {
  const canonicalId = `revalidate-artifacts-${label}`;
  const attempts = harness.runtime.commands.filter(({ id }) => (
    id === canonicalId
      || (id.startsWith(`${canonicalId}-resume-`) && !id.includes(":"))
  )).length + 1;
  return {
    attempt: attempts,
    commandId: attempts === 1 ? canonicalId : `${canonicalId}-resume-${attempts}`,
  };
}

export function compareRebuiltArtifacts(existing, rebuilt) {
  return isDeepStrictEqual(comparableArtifacts(existing), comparableArtifacts(rebuilt));
}

export function revalidateCheckpointArtifacts(harness, options) {
  const {
    label,
    worktree,
    commit,
    version,
    existing,
    requiredCommandIds,
  } = options;
  assertCheckpointWorktree(worktree, commit, version, label);
  assertRequiredEvidence(harness, requiredCommandIds, label);
  assertArtifactHashes(existing);

  const { attempt, commandId } = nextRevalidation(harness, label);
  const destination = assertPathWithin(
    harness.options.workDir,
    path.join(harness.paths.artifactRevalidation, `${label}-resume-${attempt}`),
  );
  if (existsSync(destination)) {
    throw new ProofBlockedError(
      `${label} artifact revalidation destination already exists: ${destination}`,
      commandId,
    );
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  harness.runCommand({
    id: `${commandId}:rebuild`,
    command: process.execPath,
    args: [
      path.join(worktree, "scripts/pack-tarballs.mjs"),
      "--destination",
      destination,
      "--ref",
      commit,
    ],
    cwd: worktree,
    required: false,
  });
  assertCheckpointWorktree(worktree, commit, version, label);
  const rebuilt = convertPackManifest(
    readJson(path.join(destination, "tarballs-manifest.json")),
    destination,
    commit,
    version,
  );
  const matches = compareRebuiltArtifacts(existing, rebuilt);
  harness.recordSyntheticCommand({
    id: commandId,
    command: `compare checkpointed ${label} tarballs with a fresh immutable rebuild`,
    startedAt: nowIso(),
    startedMs: Date.now(),
    exitCode: matches ? 0 : 1,
    required: true,
    detail: `${JSON.stringify({
      commit,
      version,
      destination,
      checkpointed: comparableArtifacts(existing),
      rebuilt: comparableArtifacts(rebuilt),
      matches,
    }, null, 2)}\n`,
  });
  if (!matches) {
    throw new ProofBlockedError(
      `${label} checkpointed artifacts differ from the immutable rebuild`,
      commandId,
    );
  }
  return rebuilt;
}
