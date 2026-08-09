import { existsSync } from "node:fs";
import path from "node:path";

import {
  ProofBlockedError,
  fileManifest,
  hashFileManifest,
  nowIso,
} from "./proof-two-client-update-helpers.mjs";

export function cacheSnapshot(cachePath) {
  const resolved = path.resolve(cachePath);
  if (!existsSync(resolved)) {
    return { path: resolved, exists: false, fileCount: 0 };
  }
  const manifest = fileManifest(resolved, { ignores: [] });
  return {
    path: resolved,
    exists: true,
    fileCount: Object.keys(manifest).length,
    hash: hashFileManifest(manifest),
  };
}

function journalCache(harness, definition, slot, id, snapshot, passed, expectation) {
  harness.runtime.fixtures[definition.name].cache[slot] = snapshot;
  harness.recordSyntheticCommand({
    id,
    fixture: definition.name,
    command: `fingerprint npm cache (${slot})`,
    startedAt: nowIso(),
    startedMs: Date.now(),
    exitCode: passed ? 0 : 1,
    required: true,
    detail: `${JSON.stringify({ expectation, snapshot }, null, 2)}\n`,
  });
  return snapshot;
}

export function journalColdCacheBefore(harness, definition, cachePath) {
  const snapshot = cacheSnapshot(cachePath);
  return journalCache(
    harness,
    definition,
    "coldBefore",
    `${definition.name}:cold-cache-before`,
    snapshot,
    !snapshot.exists && snapshot.fileCount === 0,
    "cache path is absent",
  );
}

export function journalColdCacheAfter(harness, definition, cachePath) {
  const snapshot = cacheSnapshot(cachePath);
  return journalCache(
    harness,
    definition,
    "coldAfter",
    `${definition.name}:cold-cache-after`,
    snapshot,
    snapshot.exists && snapshot.fileCount > 0,
    "cache exists and contains files after the cold install",
  );
}

export function journalWarmCacheBefore(harness, definition, cachePath) {
  const runtime = harness.runtime.fixtures[definition.name];
  const snapshot = cacheSnapshot(cachePath);
  const coldAfter = runtime.cache.coldAfter;
  return journalCache(
    harness,
    definition,
    "warmBefore",
    `${definition.name}:warm-cache-before`,
    snapshot,
    Boolean(coldAfter?.hash) && snapshot.hash === coldAfter.hash,
    "warm cache exactly matches the post-cold cache fingerprint",
  );
}

export function journalWarmCacheAfter(harness, definition, cachePath) {
  const snapshot = cacheSnapshot(cachePath);
  return journalCache(
    harness,
    definition,
    "warmAfter",
    `${definition.name}:warm-cache-after`,
    snapshot,
    snapshot.exists && snapshot.fileCount > 0,
    "cache remains populated after the warm install",
  );
}

export function beginMutationEpoch(harness, definition, phase) {
  const runtime = harness.runtime.fixtures[definition.name];
  if (runtime.activeMutation) {
    throw new ProofBlockedError(
      `Mutation epoch ${runtime.activeMutation.epoch} (${runtime.activeMutation.phase}) is still active for ${definition.name}`,
      "mutation-epoch",
    );
  }
  runtime.mutationEpoch += 1;
  runtime.activeMutation = {
    epoch: runtime.mutationEpoch,
    phase,
    startedAt: nowIso(),
  };
  runtime.currentTrain = "unknown";
  harness.persist();
  return runtime.activeMutation;
}

export function completeMutationEpoch(harness, definition, train) {
  const runtime = harness.runtime.fixtures[definition.name];
  if (!runtime.activeMutation) {
    throw new ProofBlockedError(`No active mutation epoch for ${definition.name}`, "mutation-epoch");
  }
  runtime.activeMutation = null;
  runtime.currentTrain = train;
  harness.persist();
}

export function setCurrentTrain(harness, definition, train) {
  const runtime = harness.runtime.fixtures[definition.name];
  runtime.currentTrain = train;
  runtime.activeMutation = null;
  harness.persist();
}

export function nextRecoveryAttempt(harness, definition, fallbackPhase = "outer-failure", suffixOverride) {
  const runtime = harness.runtime.fixtures[definition.name];
  if (!runtime.activeMutation) {
    runtime.mutationEpoch += 1;
    runtime.activeMutation = {
      epoch: runtime.mutationEpoch,
      phase: fallbackPhase,
      startedAt: nowIso(),
    };
  }
  runtime.recoveryAttempts += 1;
  const descriptor = {
    epoch: runtime.activeMutation.epoch,
    phase: runtime.activeMutation.phase,
    attempt: runtime.recoveryAttempts,
    suffix: suffixOverride ?? `-recovery-e${runtime.activeMutation.epoch}-a${runtime.recoveryAttempts}`,
  };
  harness.persist();
  return descriptor;
}

export function recordRecoveryEpoch(harness, definition, descriptor, exact) {
  const runtime = harness.runtime.fixtures[definition.name];
  runtime.recoveryHistory.push({
    ...descriptor,
    exact,
    finishedAt: nowIso(),
  });
  runtime.activeMutation = null;
  runtime.currentTrain = exact ? "baseline" : "unknown";
  harness.persist();
}

export function needsRecovery(runtime) {
  return Boolean(runtime.activeMutation) || runtime.currentTrain !== "baseline";
}
