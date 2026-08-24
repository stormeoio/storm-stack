// @vitest-environment node
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  ReadinessBudgetError,
  computeCommandTimeout,
  computeLoopDeadline,
  computeLoopDelay,
  createCommandExecutor,
  createReadinessResourceNames,
  gitResolveArguments,
  isOwnedReadinessDirectory,
  isSupportedNodeVersion,
  normalizeResolvedCommit,
  parseNpmPackFilename,
  parseReadinessArguments,
  worktreeAddArguments,
} from "./proof-readiness.mjs";
import {
  cleanupComposeProject,
  cleanupGitWorktree,
} from "./proof-readiness-cleanup.mjs";

describe("parseReadinessArguments", () => {
  it("parses explicit ref, output, budget, and per-command timeout", () => {
    const result = parseReadinessArguments(
      [
        "--base-ref",
        "dc03cbb",
        "--output",
        "artifacts/readiness.json",
        "--budget-ms",
        "1000",
        "--command-timeout-ms",
        "250",
      ],
      {},
      "/repo",
    );
    expect(result.baseRef).toBe("dc03cbb");
    expect(result.output).toBe("/repo/artifacts/readiness.json");
    expect(result.budgetMs).toBe(1000);
    expect(result.commandTimeoutMs).toBe(250);
  });

  it("accepts environment defaults", () => {
    const result = parseReadinessArguments(
      [],
      {
        GATE_BASE_REF: "refs/tags/gate",
        READINESS_BUDGET_MS: "5000",
        READINESS_COMMAND_TIMEOUT_MS: "900",
      },
      "/repo",
    );
    expect(result.baseRef).toBe("refs/tags/gate");
    expect(result.budgetMs).toBe(5000);
    expect(result.commandTimeoutMs).toBe(900);
  });

  it("rejects unknown arguments, missing values, and invalid budgets", () => {
    expect(() => parseReadinessArguments(["--wat"], {}, "/repo")).toThrow("Unknown argument");
    expect(() => parseReadinessArguments(["--base-ref"], {}, "/repo")).toThrow("requires a value");
    expect(() => parseReadinessArguments(["--budget-ms", "0"], {}, "/repo")).toThrow("positive number");
    expect(() => parseReadinessArguments(["--command-timeout-ms", "NaN"], {}, "/repo")).toThrow(
      "positive number",
    );
  });
});

describe("budget helpers", () => {
  it("caps a command timeout to the remaining global budget", () => {
    expect(computeCommandTimeout({ nowMs: 100, deadlineMs: 1100, requestedMs: 250 })).toBe(250);
    expect(computeCommandTimeout({ nowMs: 100, deadlineMs: 1100, requestedMs: 5000 })).toBe(1000);
  });

  it("rejects a command once the global budget is exhausted", () => {
    expect(() => computeCommandTimeout({ nowMs: 1100, deadlineMs: 1100, requestedMs: 1 })).toThrow(
      ReadinessBudgetError,
    );
  });

  it("caps asynchronous loops and sleeps to their deadlines", () => {
    expect(computeLoopDeadline(100, 1000, 250)).toBe(350);
    expect(computeLoopDeadline(100, 200, 250)).toBe(200);
    expect(computeLoopDelay(100, 350, 500)).toBe(250);
    expect(computeLoopDelay(350, 350, 500)).toBe(0);
  });

  it("actually terminates a command at its injected timeout", async () => {
    const records = [];
    const execute = createCommandExecutor({
      defaultCwd: process.cwd(),
      deadlineAt: Date.now() + 2000,
      defaultTimeoutMs: 50,
      record: (result) => records.push(result),
    });
    const result = await execute(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], {
      id: "timeout-probe",
      timeoutMs: 50,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(records).toHaveLength(1);
  });
});

describe("immutable git ref and worktree helpers", () => {
  const sha = "dc03cbb8fc11c33a64b6c6c2eb33774b90736bb3";

  it("resolves a ref as a commit after the end-of-options marker", () => {
    expect(gitResolveArguments("refs/tags/proof-v0.1.0")).toEqual([
      "rev-parse",
      "--verify",
      "--end-of-options",
      "refs/tags/proof-v0.1.0^{commit}",
    ]);
  });

  it("normalizes exactly one full commit id", () => {
    expect(normalizeResolvedCommit(`${sha.toUpperCase()}\n`)).toBe(sha);
    expect(() => normalizeResolvedCommit("dc03cbb\n")).toThrow("exactly one commit");
    expect(() => normalizeResolvedCommit(`${sha}\n${sha}\n`)).toThrow("exactly one commit");
  });

  it("builds a detached worktree command from the resolved immutable commit", () => {
    expect(worktreeAddArguments("/tmp/gate", sha)).toEqual([
      "worktree",
      "add",
      "--detach",
      "/tmp/gate",
      sha,
    ]);
  });
});

describe("owned resource helpers", () => {
  it("uses safe, bounded Docker Compose and temporary directory names", () => {
    const names = createReadinessResourceNames("PID 42/unsafe");
    expect(names.directoryPrefix).toMatch(/^stormstack-readiness-[a-z0-9_-]+-$/);
    expect(names.composeProject).toMatch(/^stormstack-readiness-[a-z0-9_-]+$/);
    expect(names.composeProject.length).toBeLessThanOrEqual(63);
  });

  it("only accepts a directly-owned readiness directory under the OS temp root", () => {
    expect(isOwnedReadinessDirectory(join(tmpdir(), "stormstack-readiness-123-abcd"))).toBe(true);
    expect(isOwnedReadinessDirectory(join(tmpdir(), "unrelated-123"))).toBe(false);
    expect(isOwnedReadinessDirectory(join(tmpdir(), "nested", "stormstack-readiness-123"))).toBe(false);
    expect(isOwnedReadinessDirectory("/", tmpdir())).toBe(false);
  });

  it("falls back to exact Compose labels and verifies every resource is gone", async () => {
    const calls = [];
    const resources = { container: ["container-1"], volume: ["volume-1"], network: ["network-1"] };
    const execute = async (command, args, options) => {
      calls.push({ command, args, id: options.id });
      if (options.id === "compose-cleanup-down") return { exitCode: 1, stdout: "", stderr: "down failed" };
      const listMatch = options.id.match(/^compose-cleanup-list-(container|volume|network)-(before|after)$/);
      if (listMatch) {
        const resource = listMatch[1];
        return { exitCode: 0, stdout: resources[resource].join("\n"), stderr: "" };
      }
      const removeMatch = options.id.match(/^compose-cleanup-remove-(container|volume|network)$/);
      if (removeMatch) {
        resources[removeMatch[1]] = [];
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    };

    const result = await cleanupComposeProject({
      execute,
      composeArgs: (...args) => ["compose", "--project-name", "stormstack-readiness-test", ...args],
      cwd: "/tmp/readiness",
      composeProject: "stormstack-readiness-test",
    });

    expect(result).toEqual({ cleaned: true, detail: "" });
    expect(calls.filter(({ id }) => id.startsWith("compose-cleanup-remove-"))).toHaveLength(3);
    expect(calls.every(({ args }) => !args.includes("stormstack-readiness-other"))).toBe(true);
  });

  it("unlocks, retries, prunes and verifies a failed worktree removal", async () => {
    const calls = [];
    let removeAttempts = 0;
    const execute = async (_command, _args, options) => {
      calls.push(options.id);
      if (options.id === "gate-worktree-cleanup") {
        removeAttempts += 1;
        return { exitCode: 1, stdout: "", stderr: "locked" };
      }
      if (options.id === "gate-worktree-cleanup-retry") {
        removeAttempts += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const result = await cleanupGitWorktree({
      execute,
      repositoryRoot: "/repo",
      worktreePath: "/tmp/stormstack-readiness-test/gate",
    });

    expect(result).toEqual({ cleaned: true, detail: "" });
    expect(removeAttempts).toBe(2);
    expect(calls).toEqual([
      "gate-worktree-cleanup",
      "gate-worktree-unlock",
      "gate-worktree-cleanup-retry",
      "gate-worktree-prune",
      "gate-worktree-verify-cleanup",
    ]);
  });
});

describe("npm pack parsing", () => {
  it("accepts npm's JSON array and rejects unsafe filenames", () => {
    expect(parseNpmPackFilename('[{"filename":"stormeoio-core-0.1.0.tgz"}]')).toBe(
      "stormeoio-core-0.1.0.tgz",
    );
    expect(() => parseNpmPackFilename('[{"filename":"../escape.tgz"}]')).toThrow("safe tarball");
    expect(() => parseNpmPackFilename("not-json")).toThrow("valid JSON");
  });
});

describe("isSupportedNodeVersion", () => {
  it.each([
    ["20.19.0", true],
    ["20.20.2", true],
    ["22.0.0", true],
    ["20.18.9", false],
    ["18.20.0", false],
  ])("evaluates %s", (version, expected) => {
    expect(isSupportedNodeVersion(version)).toBe(expected);
  });
});
