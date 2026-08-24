import { resolve } from "node:path";

const COMPOSE_PROJECT_PATTERN = /^stormstack-readiness-[a-z0-9_-]+$/;

function splitIds(output) {
  return output.trim().split(/\s+/).filter(Boolean);
}

function resourceListArguments(resource, composeProject) {
  const label = `label=com.docker.compose.project=${composeProject}`;
  if (resource === "container") return ["ps", "--all", "--quiet", "--filter", label];
  return [resource, "ls", "--quiet", "--filter", label];
}

async function listComposeResources(execute, composeProject, resource, suffix) {
  const result = await execute(
    "docker",
    resourceListArguments(resource, composeProject),
    { id: `compose-cleanup-list-${resource}-${suffix}`, timeoutMs: 30_000, allowFailure: true },
  );
  return {
    ids: result.exitCode === 0 ? splitIds(result.stdout) : [],
    error: result.exitCode === 0 ? null : (result.stderr || result.stdout || `exit ${result.exitCode}`),
  };
}

/** Cleans every Docker resource carrying the exact Compose project label, then verifies absence. */
export async function cleanupComposeProject({
  execute,
  composeArgs,
  cwd,
  composeProject,
}) {
  if (!COMPOSE_PROJECT_PATTERN.test(composeProject)) {
    throw new Error(`Refusing to clean unexpected Compose project: ${composeProject}`);
  }

  await execute(
    "docker",
    composeArgs("down", "--volumes", "--remove-orphans", "--timeout", "5"),
    { cwd, id: "compose-cleanup-down", timeoutMs: 60_000, allowFailure: true },
  );

  const removals = [
    ["container", ["rm", "--force"]],
    ["volume", ["volume", "rm", "--force"]],
    ["network", ["network", "rm"]],
  ];
  const errors = [];
  for (const [resource, removeArgs] of removals) {
    const listed = await listComposeResources(execute, composeProject, resource, "before");
    if (listed.error) {
      errors.push(`${resource} list failed: ${listed.error}`);
      continue;
    }
    if (listed.ids.length === 0) continue;
    const removed = await execute(
      "docker",
      [...removeArgs, ...listed.ids],
      { id: `compose-cleanup-remove-${resource}`, timeoutMs: 30_000, allowFailure: true },
    );
    if (removed.exitCode !== 0) {
      errors.push(`${resource} removal failed: ${removed.stderr || removed.stdout || `exit ${removed.exitCode}`}`);
    }
  }

  for (const resource of ["container", "volume", "network"]) {
    const listed = await listComposeResources(execute, composeProject, resource, "after");
    if (listed.error) errors.push(`${resource} verification failed: ${listed.error}`);
    if (listed.ids.length > 0) errors.push(`${resource} resources remain: ${listed.ids.join(", ")}`);
  }
  return { cleaned: errors.length === 0, detail: errors.join("; ") };
}

function worktreeIsRegistered(output, worktreePath) {
  const expected = resolve(worktreePath);
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .some((line) => resolve(line.slice("worktree ".length)) === expected);
}

/** Removes a detached worktree, retries after unlock, prunes, and verifies Git metadata. */
export async function cleanupGitWorktree({ execute, repositoryRoot, worktreePath }) {
  let removed = await execute(
    "git",
    ["worktree", "remove", "--force", worktreePath],
    { cwd: repositoryRoot, id: "gate-worktree-cleanup", timeoutMs: 60_000, allowFailure: true },
  );
  if (removed.exitCode !== 0) {
    await execute(
      "git",
      ["worktree", "unlock", worktreePath],
      { cwd: repositoryRoot, id: "gate-worktree-unlock", timeoutMs: 15_000, allowFailure: true },
    );
    removed = await execute(
      "git",
      ["worktree", "remove", "--force", worktreePath],
      { cwd: repositoryRoot, id: "gate-worktree-cleanup-retry", timeoutMs: 60_000, allowFailure: true },
    );
  }

  const pruned = await execute(
    "git",
    ["worktree", "prune"],
    { cwd: repositoryRoot, id: "gate-worktree-prune", timeoutMs: 30_000, allowFailure: true },
  );
  const listed = await execute(
    "git",
    ["worktree", "list", "--porcelain"],
    { cwd: repositoryRoot, id: "gate-worktree-verify-cleanup", timeoutMs: 30_000, allowFailure: true },
  );
  const errors = [];
  if (removed.exitCode !== 0) errors.push(removed.stderr || removed.stdout || "worktree remove failed");
  if (pruned.exitCode !== 0) errors.push(pruned.stderr || pruned.stdout || "worktree prune failed");
  if (listed.exitCode !== 0) errors.push(listed.stderr || listed.stdout || "worktree list failed");
  if (listed.exitCode === 0 && worktreeIsRegistered(listed.stdout, worktreePath)) {
    errors.push("worktree remains registered");
  }
  return { cleaned: errors.length === 0, detail: errors.join("; ") };
}
