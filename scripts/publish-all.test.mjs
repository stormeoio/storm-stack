// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import yaml from "js-yaml";

import {
  assertPublishedPackageMatches,
  isNpmNotFound,
  lookupPublishedPackage,
  normalizeRepositoryUrl,
  parsePublishArguments,
} from "./publish-all.mjs";

const temporaryDirectories = [];
const headCommit = "a".repeat(40);
const currentVersion = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
const currentTagRef = `refs/tags/v${currentVersion}`;
const trustedWorkflowRef = `stormeoio/storm-stack/.github/workflows/publish.yml@${currentTagRef}`;
const packageInfo = {
  dir: "packages/core",
  name: "@stormeoio/core",
  repository: {
    type: "git",
    url: "git+https://github.com/stormeoio/storm-stack.git",
    directory: "packages/core",
  },
  version: currentVersion,
};

function createTemporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function writeExecutable(path, content) {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

function createCommandShims() {
  const directory = createTemporaryDirectory("stormstack-publish-shims-");
  const logPath = join(directory, "commands.log");
  writeFileSync(logPath, "", "utf8");

  writeExecutable(
    join(directory, "git"),
    `#!/bin/sh
printf 'git %s\\n' "$*" >> "$SHIM_LOG"
case "$1" in
  status)
    if [ "\${SHIM_DIRTY:-}" = "1" ]; then
      printf ' M packages/core/package.json\n'
    fi
    exit 0
    ;;
  fetch) exit 0 ;;
  merge-base)
    if [ "\${SHIM_ANCESTRY_FAIL:-}" = "1" ]; then
      exit 1
    fi
    exit 0
    ;;
  remote)
    printf 'git@github.com:stormeoio/storm-stack.git\n'
    exit 0
    ;;
  branch)
    printf 'main\n'
    exit 0
    ;;
  rev-parse)
    case "$*" in
      *refs/tags/*) printf '%s\\n' "$SHIM_TAG_COMMIT" ;;
      *) printf '%s\\n' "$SHIM_HEAD_COMMIT" ;;
    esac
    exit 0
    ;;
esac
printf 'unexpected git command: %s\\n' "$*" >&2
exit 2
`,
  );

  writeExecutable(
    join(directory, "npm"),
    `#!/bin/sh
printf 'npm %s\\n' "$*" >> "$SHIM_LOG"
case "$1" in
  --version)
    printf '10.8.2\\n'
    exit 0
    ;;
  whoami)
    if [ "\${SHIM_WHOAMI_FAIL:-}" = "1" ]; then
      printf 'npm error code ENEEDAUTH\\n' >&2
      exit 1
    fi
    printf 'stormeo\\n'
    exit 0
    ;;
  view)
    if [ "\${SHIM_VIEW_MODE:-}" = "mismatch" ] && [ "$2" = "@stormeoio/core@${currentVersion}" ]; then
      printf '%s\\n' '{"name":"@stormeoio/core","version":"${currentVersion}","gitHead":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","repository":{"type":"git","url":"git+https://github.com/stormeoio/storm-stack.git","directory":"packages/core"}}'
      exit 0
    fi
    printf 'npm error code E404\\n' >&2
    exit 1
    ;;
  publish)
    exit 0
    ;;
esac
printf 'unexpected npm command: %s\\n' "$*" >&2
exit 2
`,
  );

  writeExecutable(
    join(directory, "gh"),
    `#!/bin/sh
printf 'gh %s\\n' "$*" >> "$SHIM_LOG"
exit 0
`,
  );

  return { directory, logPath };
}

function liveEnvironment(shims, overrides = {}) {
  return {
    ...process.env,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-request-token",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example.test/oidc",
    GITHUB_ACTIONS: "true",
    GITHUB_REF: currentTagRef,
    GITHUB_REPOSITORY: "stormeoio/storm-stack",
    GITHUB_WORKFLOW_REF: trustedWorkflowRef,
    NODE_AUTH_TOKEN: "",
    PATH: `${shims.directory}:${process.env.PATH}`,
    SHIM_HEAD_COMMIT: headCommit,
    SHIM_LOG: shims.logPath,
    SHIM_TAG_COMMIT: headCommit,
    ...overrides,
  };
}

function runPublishScript(env) {
  return spawnSync(
    process.execPath,
    [resolve("scripts/publish-all.mjs"), "--live", "--provenance"],
    { encoding: "utf8", env },
  );
}

function runPublishWorkflowValidation(shims, overrides = {}) {
  const workflow = yaml.load(readFileSync(resolve(".github/workflows/publish.yml"), "utf8"));
  const validationScript = workflow.jobs.validate.steps.find(
    (step) => step.id === "release",
  ).run;
  const githubOutput = join(shims.directory, "github-output");
  const result = spawnSync("bash", ["-c", validationScript], {
    cwd: resolve("."),
    encoding: "utf8",
    env: liveEnvironment(shims, {
      EXPECTED_VERSION: "",
      GITHUB_OUTPUT: githubOutput,
      RELEASE_EVENT: "workflow_dispatch",
      RELEASE_REF: "refs/heads/main",
      REQUESTED_DRY_RUN: "false",
      ...overrides,
    }),
  });
  return { githubOutput, result, workflow };
}

function runReleaseWorkflowDispatch(shims, overrides = {}) {
  const workflow = yaml.load(readFileSync(resolve(".github/workflows/release.yml"), "utf8"));
  const dispatchScript = workflow.jobs.release.steps.find(
    (step) => step.name === "Dispatch npm publication",
  ).run;
  return {
    result: spawnSync("bash", ["-c", dispatchScript], {
      cwd: resolve("."),
      encoding: "utf8",
      env: liveEnvironment(shims, {
        GH_TOKEN: "github-actions-token",
        RELEASE_REPOSITORY: "stormeoio/storm-stack",
        RELEASE_VERSION: currentVersion,
        ...overrides,
      }),
    }),
    workflow,
  };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe("publish argument and metadata guards", () => {
  it("requires provenance for live publication", () => {
    expect(() => parsePublishArguments(["--live"])).toThrow("explicit --provenance");
    expect(() => parsePublishArguments(["--live", "--no-provenance"])).toThrow();
    expect(parsePublishArguments(["--live", "--provenance"]).provenance).toBe(true);
  });

  it("normalizes equivalent GitHub repository URLs", () => {
    expect(normalizeRepositoryUrl("git@github.com:stormeoio/storm-stack.git")).toBe(
      "https://github.com/stormeoio/storm-stack",
    );
    expect(normalizeRepositoryUrl("git+https://github.com/stormeoio/storm-stack.git")).toBe(
      "https://github.com/stormeoio/storm-stack",
    );
  });

  it("only accepts an existing package from the exact release commit and manifest repository", () => {
    const metadata = {
      gitHead: headCommit,
      name: packageInfo.name,
      repository: packageInfo.repository,
      version: packageInfo.version,
    };
    expect(() => assertPublishedPackageMatches(packageInfo, metadata, headCommit)).not.toThrow();
    expect(() =>
      assertPublishedPackageMatches(packageInfo, { ...metadata, gitHead: "b".repeat(40) }, headCommit),
    ).toThrow("already exists with gitHead");
    expect(() =>
      assertPublishedPackageMatches(
        packageInfo,
        {
          ...metadata,
          repository: { ...metadata.repository, directory: "packages/other" },
        },
        headCommit,
      ),
    ).toThrow("repository directory");
  });

  it("distinguishes npm E404 from authentication and network failures", () => {
    expect(isNpmNotFound({ status: 1, stderr: "npm error code E404", stdout: "" })).toBe(true);
    expect(isNpmNotFound({ status: 1, stderr: "npm error code ENEEDAUTH", stdout: "" })).toBe(false);
  });

  it("refuses to skip an existing matching package without npm provenance", async () => {
    const metadata = {
      gitHead: headCommit,
      name: packageInfo.name,
      repository: packageInfo.repository,
      version: packageInfo.version,
      "dist.integrity": `sha512-${Buffer.alloc(64).toString("base64")}`,
    };
    const run = () => ({ status: 0, stderr: "", stdout: JSON.stringify(metadata) });

    await expect(
      lookupPublishedPackage(
        packageInfo,
        {
          headCommit,
          workflowRef: trustedWorkflowRef,
        },
        { run },
      ),
    ).rejects.toThrow("exists without an npm provenance attestation");
  });
});

describe("live publication process guards", () => {
  it("rejects a local live invocation before executing git or npm", () => {
    const shims = createCommandShims();
    const result = runPublishScript(liveEnvironment(shims, { GITHUB_ACTIONS: "" }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("restricted to the GitHub Actions publish workflow");
    expect(readFileSync(shims.logPath, "utf8")).toBe("");
  });

  it("rejects live publication outside the trusted repository workflow", () => {
    const shims = createCommandShims();
    const result = runPublishScript(
      liveEnvironment(shims, {
        GITHUB_WORKFLOW_REF: "stormeoio/storm-stack/.github/workflows/release.yml@refs/heads/main",
      }),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("trusted stormeoio/storm-stack publish workflow");
    expect(readFileSync(shims.logPath, "utf8")).toBe("");
  });

  it("rejects a trusted publish workflow running from main before executing git or npm", () => {
    const shims = createCommandShims();
    const result = runPublishScript(
      liveEnvironment(shims, {
        GITHUB_REF: "refs/heads/main",
        GITHUB_WORKFLOW_REF:
          "stormeoio/storm-stack/.github/workflows/publish.yml@refs/heads/main",
      }),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("requires the exact release tag Git ref");
    expect(readFileSync(shims.logPath, "utf8")).toBe("");
  });

  it("publishes through GitHub OIDC without npm whoami", () => {
    const shims = createCommandShims();
    const result = runPublishScript(liveEnvironment(shims, { SHIM_WHOAMI_FAIL: "1" }));
    const log = readFileSync(shims.logPath, "utf8");

    expect(result.status).toBe(0);
    expect(log).not.toContain("npm whoami");
    expect(log).toContain("npm view");
    expect(log).toContain("npm publish");
  });

  it("rejects an exposed legacy npm token before registry lookup or publish", () => {
    const shims = createCommandShims();
    const result = runPublishScript(
      liveEnvironment(shims, { NODE_AUTH_TOKEN: "legacy-automation-token" }),
    );
    const log = readFileSync(shims.logPath, "utf8");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("without an exposed npm token");
    expect(log).not.toContain("npm whoami");
    expect(log).not.toContain("npm view");
    expect(log).not.toContain("npm publish");
  });

  it("rejects a dirty worktree before resolving a tag or authenticating", () => {
    const shims = createCommandShims();
    const result = runPublishScript(liveEnvironment(shims, { SHIM_DIRTY: "1" }));
    const log = readFileSync(shims.logPath, "utf8");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dirty Git working tree");
    expect(log).not.toContain("git rev-parse");
    expect(log).not.toContain("npm whoami");
  });

  it("requires the exact version tag to point to HEAD before authentication", () => {
    const shims = createCommandShims();
    const result = runPublishScript(
      liveEnvironment(shims, { SHIM_TAG_COMMIT: "b".repeat(40) }),
    );
    const log = readFileSync(shims.logPath, "utf8");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not point to HEAD");
    expect(log).not.toContain("npm whoami");
    expect(log).not.toContain("npm publish");
  });

  it("fails the existing-package preflight before the first npm publish", () => {
    const shims = createCommandShims();
    const result = runPublishScript(liveEnvironment(shims, { SHIM_VIEW_MODE: "mismatch" }));
    const log = readFileSync(shims.logPath, "utf8");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already exists with gitHead");
    expect(log).toContain(`npm view @stormeoio/core@${currentVersion}`);
    expect(log).not.toContain("npm publish");
  });

  it("preflights every package before the first npm publish", () => {
    const shims = createCommandShims();
    const result = runPublishScript(liveEnvironment(shims));
    const commands = readFileSync(shims.logPath, "utf8").trim().split("\n");
    const lastRegistryLookup = commands.findLastIndex((command) => command.startsWith("npm view "));
    const firstPublish = commands.findIndex((command) => command.startsWith("npm publish "));

    expect(result.status).toBe(0);
    expect(lastRegistryLookup).toBeGreaterThan(-1);
    expect(firstPublish).toBeGreaterThan(lastRegistryLookup);
  });
});

describe("manual live workflow authorization", () => {
  it("uses an OIDC-capable runtime without exposing an npm token", () => {
    const workflow = yaml.load(readFileSync(resolve(".github/workflows/publish.yml"), "utf8"));
    const publishJob = workflow.jobs.publish;
    const setupNode = publishJob.steps.find((step) => step.uses === "actions/setup-node@v6");
    const installNpm = publishJob.steps.find(
      (step) => step.name === "Install OIDC-compatible npm",
    );
    const publishStep = publishJob.steps.find((step) => step.name === "Publish (LIVE)");

    expect(publishJob.permissions).toEqual({ contents: "read", "id-token": "write" });
    expect(setupNode.with).toMatchObject({
      "node-version": "22.14.0",
      "package-manager-cache": false,
      "registry-url": "https://registry.npmjs.org",
    });
    expect(installNpm.run).toBe("npm install --global npm@11.5.1");
    expect(publishStep.env).toBeUndefined();
    expect(publishStep.run).toBe("node scripts/publish-all.mjs --live --provenance");
  });

  it("rejects main even when the exact package version tag points to HEAD", () => {
    const shims = createCommandShims();
    const { result, workflow } = runPublishWorkflowValidation(shims);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("requires the exact release tag");
    expect(readFileSync(shims.logPath, "utf8")).not.toContain("git rev-parse");
    expect(workflow.jobs.publish.if).not.toContain("refs/heads/main");
  });

  it("authorizes manual live mode only after validating the exact tagged HEAD", () => {
    const shims = createCommandShims();
    const { githubOutput, result, workflow } = runPublishWorkflowValidation(shims, {
      RELEASE_REF: currentTagRef,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(githubOutput, "utf8")).toBe(`mode=live\nversion=${currentVersion}\n`);
    expect(workflow.jobs.publish.if).toContain(
      "github.ref == format('refs/tags/v{0}', needs.validate.outputs.version)",
    );
  });
});

describe("release workflow publication dispatch", () => {
  it("uses only Actions and contents write permissions", () => {
    const shims = createCommandShims();
    const { workflow } = runReleaseWorkflowDispatch(shims);
    const stepNames = workflow.jobs.release.steps.map((step) => step.name).filter(Boolean);
    const dispatchStep = workflow.jobs.release.steps.find(
      (step) => step.name === "Dispatch npm publication",
    );

    expect(workflow.permissions).toEqual({});
    expect(workflow.jobs.release.permissions).toEqual({
      actions: "write",
      contents: "write",
    });
    expect(stepNames.indexOf("Dispatch npm publication")).toBeGreaterThan(
      stepNames.indexOf("Commit and tag"),
    );
    expect(dispatchStep.env.GH_TOKEN).toBe("${{ secrets.GITHUB_TOKEN }}");
  });

  it("explicitly dispatches live publication at the immutable version tag", () => {
    const shims = createCommandShims();
    const { result } = runReleaseWorkflowDispatch(shims);
    const log = readFileSync(shims.logPath, "utf8");

    expect(result.status).toBe(0);
    expect(log).toContain(
      `gh workflow run publish.yml --repo stormeoio/storm-stack --ref v${currentVersion} --field dry_run=false --field version=${currentVersion}`,
    );
  });
});

describe("release doctor npm trusted publishing", () => {
  it("passes without local npm credentials or npm whoami", () => {
    const shims = createCommandShims();
    const result = spawnSync(process.execPath, [resolve("scripts/release-doctor.mjs")], {
      encoding: "utf8",
      env: liveEnvironment(shims, {
        NPM_TOKEN: "",
        NODE_AUTH_TOKEN: "",
      }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[ok] npm trusted publishing");
    expect(readFileSync(shims.logPath, "utf8")).not.toContain("npm whoami");
  });

  it("warns about a legacy credential without exposing it", () => {
    const shims = createCommandShims();
    const token = "not-a-real-secret-token";
    const result = spawnSync(process.execPath, [resolve("scripts/release-doctor.mjs")], {
      encoding: "utf8",
      env: liveEnvironment(shims, {
        NPM_TOKEN: token,
        NODE_AUTH_TOKEN: "",
        SHIM_WHOAMI_FAIL: "1",
      }),
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toContain("[warn] Legacy npm credential");
    expect(output).not.toContain(token);
  });
});
