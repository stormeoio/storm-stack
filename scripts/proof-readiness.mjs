#!/usr/bin/env node

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canConnect,
  createCommandExecutor,
  createReadinessResourceNames,
  gitResolveArguments,
  isSupportedNodeVersion,
  normalizeResolvedCommit,
  parseNpmPackFilename,
  parseReadinessArguments,
  readinessRootDir,
  requireSuccess,
  reserveFreePort,
  safeCleanupDirectory,
  startManagedProcess,
  waitForHealth,
  waitForPortClosed,
  waitForPostgres,
  worktreeAddArguments,
} from "./proof-readiness-lib.mjs";
import {
  cleanupComposeProject,
  cleanupGitWorktree,
} from "./proof-readiness-cleanup.mjs";

export * from "./proof-readiness-lib.mjs";

const scriptPath = fileURLToPath(import.meta.url);

function patchGeneratedApp(appDir, tarballs, databasePort, applicationPort) {
  const packagePath = join(appDir, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [packageName, tarballPath] of tarballs) {
      if (packageJson[section]?.[packageName]) {
        packageJson[section][packageName] = `file:${tarballPath}`;
      }
    }
  }
  packageJson.scripts["db:migrate"] = "drizzle-kit migrate";
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  const composePath = join(appDir, "docker-compose.yml");
  const compose = readFileSync(composePath, "utf8");
  if (!compose.includes('      - "5432:5432"')) {
    throw new Error("Generated Docker Compose file does not expose the expected PostgreSQL port.");
  }
  writeFileSync(
    composePath,
    compose.replace('      - "5432:5432"', `      - "127.0.0.1:${databasePort}:5432"`),
    "utf8",
  );

  writeFileSync(
    join(appDir, ".env"),
    [
      `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${databasePort}/stormapp`,
      "NODE_ENV=test",
      `PORT=${applicationPort}`,
      "SESSION_SECRET=readiness-only-secret-with-more-than-32-characters",
      "",
    ].join("\n"),
    "utf8",
  );
}

const SCHEMA_FINGERPRINT_SQL = `with objects as (
  select 'column|' || table_schema || '|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '') as definition
  from information_schema.columns
  where table_schema not in ('pg_catalog', 'information_schema')
  union all
  select 'constraint|' || n.nspname || '|' || c.relname || '|' || con.conname || '|' || pg_get_constraintdef(con.oid, true)
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
  union all
  select 'index|' || schemaname || '|' || tablename || '|' || indexname || '|' || indexdef
  from pg_indexes
  where schemaname not in ('pg_catalog', 'information_schema')
)
select md5(coalesce(string_agg(definition, E'\\n' order by definition), '')) from objects;`;

async function postgresScalar(execute, composeArgs, id, sql) {
  const result = requireSuccess(
    await execute(
      "docker",
      composeArgs("exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "stormapp", "-v", "ON_ERROR_STOP=1", "-Atc", sql),
      { id, timeoutMs: 30_000 },
    ),
  );
  return result.stdout.trim();
}

async function packWorkspace(execute, gateWorktree, packDir, workspace, id) {
  const result = requireSuccess(
    await execute(
      "npm",
      ["pack", "--json", "--pack-destination", packDir, "--workspace", workspace],
      { cwd: gateWorktree, id, timeoutMs: 120_000 },
    ),
  );
  return join(packDir, parseNpmPackFilename(result.stdout));
}

function appendFailure(existing, next) {
  return existing ? `${existing}\n${next}` : next;
}

export async function runReadiness(options) {
  const startedAtMs = Date.now();
  const deadlineAt = startedAtMs + options.budgetMs;
  const commands = [];
  const record = (result) => commands.push(result);
  const names = createReadinessResourceNames();
  const temporaryDirectory = mkdtempSync(join(tmpdir(), names.directoryPrefix));
  const gateWorktree = join(temporaryDirectory, "gate");
  const appDir = join(temporaryDirectory, "external-app");
  const packDir = join(temporaryDirectory, "packs");
  let worktreeAdded = false;
  let worktreeCleaned = true;
  let composeTouched = false;
  let composeCleaned = true;
  let temporaryDirectoryCleaned = false;
  let immutableWorktreeVerified = false;
  let managedApplication = null;
  let applicationPort = null;
  let databasePort = null;
  let resolvedBaseRef = null;
  let failure = null;
  let recoveryVerified = false;
  let migrationNoopVerified = false;

  const execute = createCommandExecutor({
    defaultCwd: readinessRootDir,
    deadlineAt,
    defaultTimeoutMs: options.commandTimeoutMs,
    record,
  });
  const composeArgs = (...args) => [
    "compose",
    "--file",
    join(appDir, "docker-compose.yml"),
    "--project-name",
    names.composeProject,
    ...args,
  ];

  try {
    if (!isSupportedNodeVersion(process.versions.node)) {
      throw new Error(`Node ${process.versions.node} is unsupported; expected >=20.19.0.`);
    }

    const repositoryResult = requireSuccess(
      await execute("git", ["rev-parse", "--show-toplevel"], { id: "resolve-repository" }),
    );
    const repositoryRoot = realpathSync(repositoryResult.stdout.trim());
    if (repositoryRoot !== realpathSync(readinessRootDir)) {
      throw new Error(`Readiness script root ${readinessRootDir} is not repository root ${repositoryRoot}.`);
    }

    const resolveResult = requireSuccess(
      await execute("git", gitResolveArguments(options.baseRef), { id: "resolve-gate-base-ref" }),
    );
    resolvedBaseRef = normalizeResolvedCommit(resolveResult.stdout);

    requireSuccess(
      await execute("git", worktreeAddArguments(gateWorktree, resolvedBaseRef), {
        id: "create-gate-worktree",
        timeoutMs: 60_000,
      }),
    );
    worktreeAdded = true;
    worktreeCleaned = false;

    const checkedOut = requireSuccess(
      await execute("git", ["rev-parse", "HEAD"], { cwd: gateWorktree, id: "verify-gate-head" }),
    );
    if (normalizeResolvedCommit(checkedOut.stdout) !== resolvedBaseRef) {
      throw new Error("Temporary gate worktree checked out the wrong commit.");
    }
    immutableWorktreeVerified = true;
    const clean = requireSuccess(
      await execute("git", ["status", "--porcelain"], { cwd: gateWorktree, id: "verify-gate-clean" }),
    );
    if (clean.stdout) throw new Error("Temporary gate worktree is unexpectedly dirty.");

    requireSuccess(await execute("docker", ["info"], { id: "docker-info", timeoutMs: 30_000 }));
    requireSuccess(
      await execute("docker", ["compose", "version"], { id: "docker-compose-version", timeoutMs: 30_000 }),
    );
    requireSuccess(
      await execute("npm", ["ci", "--no-audit", "--no-fund"], {
        cwd: gateWorktree,
        id: "gate-install",
      }),
    );
    requireSuccess(await execute("npm", ["run", "build"], { cwd: gateWorktree, id: "gate-build" }));
    requireSuccess(
      await execute("npm", ["run", "typecheck"], { cwd: gateWorktree, id: "gate-typecheck" }),
    );
    requireSuccess(await execute("npm", ["test"], { cwd: gateWorktree, id: "gate-tests" }));
    requireSuccess(
      await execute("npm", ["run", "smoke:create-app"], {
        cwd: gateWorktree,
        id: "gate-existing-generator-smoke",
      }),
    );

    mkdirSync(packDir, { recursive: true });
    const tarballs = new Map([
      [
        "@stormstack/core",
        await packWorkspace(execute, gateWorktree, packDir, "packages/core", "pack-core"),
      ],
      [
        "@stormstack/auth",
        await packWorkspace(execute, gateWorktree, packDir, "packages/plugin-auth", "pack-auth"),
      ],
      [
        "@stormstack/cli",
        await packWorkspace(execute, gateWorktree, packDir, "packages/cli", "pack-cli"),
      ],
    ]);

    const scaffoldPath = join(gateWorktree, "packages/create-storm-app/dist/scaffold.js");
    const scaffoldCode = [
      "const { scaffold } = require(process.argv[1]);",
      "const options = JSON.parse(process.argv[3]);",
      "scaffold(options, process.argv[2]);",
    ].join(" ");
    requireSuccess(
      await execute(
        process.execPath,
        [
          "-e",
          scaffoldCode,
          scaffoldPath,
          appDir,
          JSON.stringify({
            projectName: "readiness-external-app",
            plugins: ["@stormstack/auth"],
            packageManager: "npm",
            withClient: false,
          }),
        ],
        { cwd: temporaryDirectory, id: "generate-external-app", timeoutMs: 30_000 },
      ),
    );

    databasePort = await reserveFreePort(deadlineAt);
    do {
      applicationPort = await reserveFreePort(deadlineAt);
    } while (applicationPort === databasePort);
    patchGeneratedApp(appDir, tarballs, databasePort, applicationPort);

    const appEnv = {
      DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${databasePort}/stormapp`,
      NODE_ENV: "test",
      PORT: String(applicationPort),
      SESSION_SECRET: "readiness-only-secret-with-more-than-32-characters",
    };

    requireSuccess(
      await execute("npm", ["install", "--no-audit", "--no-fund"], {
        cwd: appDir,
        env: appEnv,
        id: "external-tarball-install",
      }),
    );
    requireSuccess(
      await execute("npm", ["ls", "@stormstack/core", "@stormstack/auth", "@stormstack/cli", "--all"], {
        cwd: appDir,
        env: appEnv,
        id: "verify-external-tarball-install",
        timeoutMs: 60_000,
      }),
    );
    requireSuccess(
      await execute("npm", ["run", "typecheck"], {
        cwd: appDir,
        env: appEnv,
        id: "external-app-typecheck",
      }),
    );
    requireSuccess(
      await execute("npm", ["run", "build"], {
        cwd: appDir,
        env: appEnv,
        id: "external-app-build",
      }),
    );

    const composeImages = requireSuccess(
      await execute("docker", composeArgs("config", "--images"), {
        cwd: appDir,
        id: "compose-image-check",
        timeoutMs: 30_000,
      }),
    );
    if (composeImages.stdout.trim() !== "postgres:16-alpine") {
      throw new Error(`Readiness requires postgres:16-alpine, got ${composeImages.stdout.trim()}.`);
    }
    composeTouched = true;
    composeCleaned = false;
    requireSuccess(
      await execute("docker", composeArgs("up", "-d", "postgres"), {
        cwd: appDir,
        id: "compose-postgres-up",
        timeoutMs: 120_000,
      }),
    );
    await waitForPostgres(execute, composeArgs, deadlineAt);

    requireSuccess(
      await execute("npm", ["run", "db:generate"], {
        cwd: appDir,
        env: appEnv,
        id: "migration-generate",
        timeoutMs: 120_000,
      }),
    );
    requireSuccess(
      await execute("npm", ["run", "db:migrate"], {
        cwd: appDir,
        env: appEnv,
        id: "migration-first-pass",
        timeoutMs: 120_000,
      }),
    );
    const firstFingerprint = await postgresScalar(
      execute,
      composeArgs,
      "migration-first-fingerprint",
      SCHEMA_FINGERPRINT_SQL,
    );
    const firstLedgerCount = await postgresScalar(
      execute,
      composeArgs,
      "migration-first-ledger-count",
      "select count(*) from drizzle.__drizzle_migrations;",
    );
    requireSuccess(
      await execute("npm", ["run", "db:migrate"], {
        cwd: appDir,
        env: appEnv,
        id: "migration-second-pass",
        timeoutMs: 120_000,
      }),
    );
    const secondFingerprint = await postgresScalar(
      execute,
      composeArgs,
      "migration-second-fingerprint",
      SCHEMA_FINGERPRINT_SQL,
    );
    const secondLedgerCount = await postgresScalar(
      execute,
      composeArgs,
      "migration-second-ledger-count",
      "select count(*) from drizzle.__drizzle_migrations;",
    );
    if (firstFingerprint !== secondFingerprint || firstLedgerCount !== secondLedgerCount) {
      throw new Error(
        `Second migration was not a no-op (schema ${firstFingerprint}/${secondFingerprint}, ledger ${firstLedgerCount}/${secondLedgerCount}).`,
      );
    }
    migrationNoopVerified = true;

    managedApplication = startManagedProcess({
      command: process.execPath,
      args: ["dist/server/index.js"],
      cwd: appDir,
      env: appEnv,
      id: "external-app-first-start",
      deadlineAt,
      record,
    });
    await waitForHealth(
      `http://127.0.0.1:${applicationPort}/api/health`,
      managedApplication,
      deadlineAt,
      record,
      "external-app-first-health",
    );
    await managedApplication.stop();
    managedApplication = null;
    await waitForPortClosed(applicationPort, deadlineAt);

    await postgresScalar(
      execute,
      composeArgs,
      "recovery-seed",
      "create table readiness_recovery(id integer primary key, value text not null); insert into readiness_recovery values (1, 'READY_OK'); select value from readiness_recovery where id = 1;",
    );
    const recoveryFingerprintBefore = await postgresScalar(
      execute,
      composeArgs,
      "recovery-fingerprint-before",
      SCHEMA_FINGERPRINT_SQL,
    );
    const recoveryLedgerBefore = await postgresScalar(
      execute,
      composeArgs,
      "recovery-ledger-before",
      "select count(*) from drizzle.__drizzle_migrations;",
    );
    const recoveryCommands = [
      [
        "recovery-dump",
        composeArgs("exec", "-T", "postgres", "pg_dump", "-U", "postgres", "-d", "stormapp", "-Fc", "-f", "/tmp/readiness.dump"),
      ],
      [
        "recovery-drop",
        composeArgs("exec", "-T", "postgres", "dropdb", "-U", "postgres", "stormapp"),
      ],
      [
        "recovery-create",
        composeArgs("exec", "-T", "postgres", "createdb", "-U", "postgres", "stormapp"),
      ],
      [
        "recovery-restore",
        composeArgs("exec", "-T", "postgres", "pg_restore", "-U", "postgres", "-d", "stormapp", "--exit-on-error", "/tmp/readiness.dump"),
      ],
    ];
    for (const [id, args] of recoveryCommands) {
      requireSuccess(await execute("docker", args, { cwd: appDir, id, timeoutMs: 120_000 }));
    }
    const recoveryValue = await postgresScalar(
      execute,
      composeArgs,
      "recovery-data-verify",
      "select value from readiness_recovery where id = 1;",
    );
    const recoveryFingerprintAfter = await postgresScalar(
      execute,
      composeArgs,
      "recovery-fingerprint-after",
      SCHEMA_FINGERPRINT_SQL,
    );
    const recoveryLedgerAfter = await postgresScalar(
      execute,
      composeArgs,
      "recovery-ledger-after",
      "select count(*) from drizzle.__drizzle_migrations;",
    );
    if (
      recoveryValue !== "READY_OK" ||
      recoveryFingerprintBefore !== recoveryFingerprintAfter ||
      recoveryLedgerBefore !== recoveryLedgerAfter
    ) {
      throw new Error("PostgreSQL 16 recovery did not preserve data, schema, and migration ledger.");
    }
    recoveryVerified = true;

    managedApplication = startManagedProcess({
      command: process.execPath,
      args: ["dist/server/index.js"],
      cwd: appDir,
      env: appEnv,
      id: "external-app-restored-start",
      deadlineAt,
      record,
    });
    await waitForHealth(
      `http://127.0.0.1:${applicationPort}/api/health`,
      managedApplication,
      deadlineAt,
      record,
      "external-app-restored-health",
    );
    await managedApplication.stop();
    managedApplication = null;
    await waitForPortClosed(applicationPort, deadlineAt);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    if (managedApplication) {
      try {
        await managedApplication.stop();
      } catch (error) {
        failure = appendFailure(failure, `Application cleanup failed: ${error instanceof Error ? error.message : error}`);
      }
      managedApplication = null;
    }

    const cleanupDeadline = Date.now() + 90_000;
    const cleanupExecute = createCommandExecutor({
      defaultCwd: readinessRootDir,
      deadlineAt: cleanupDeadline,
      defaultTimeoutMs: 60_000,
      record,
    });
    if (composeTouched) {
      const cleanup = await cleanupComposeProject({
        execute: cleanupExecute,
        composeArgs,
        cwd: appDir,
        composeProject: names.composeProject,
      });
      composeCleaned = cleanup.cleaned;
      if (!cleanup.cleaned) {
        failure = appendFailure(failure, `Docker Compose cleanup failed: ${cleanup.detail}`);
      }
      if (databasePort !== null) {
        try {
          await waitForPortClosed(databasePort, cleanupDeadline);
        } catch (error) {
          failure = appendFailure(failure, error instanceof Error ? error.message : String(error));
        }
      }
    }

    if (worktreeAdded) {
      const cleanup = await cleanupGitWorktree({
        execute: cleanupExecute,
        repositoryRoot: readinessRootDir,
        worktreePath: gateWorktree,
      });
      worktreeCleaned = cleanup.cleaned;
      if (!cleanup.cleaned) failure = appendFailure(failure, `Git worktree cleanup failed: ${cleanup.detail}`);
    }
    if (composeCleaned && worktreeCleaned) {
      try {
        safeCleanupDirectory(temporaryDirectory);
        temporaryDirectoryCleaned = true;
      } catch (error) {
        failure = appendFailure(failure, `Temporary directory cleanup failed: ${error instanceof Error ? error.message : error}`);
      }
    } else {
      failure = appendFailure(
        failure,
        `Temporary directory preserved for recoverable cleanup: ${temporaryDirectory}`,
      );
    }
  }

  const applicationPortReleased =
    applicationPort !== null && !(await canConnect(applicationPort, 250));
  const databasePortReleased = databasePort !== null && !(await canConnect(databasePort, 250));
  const allResourcesCleaned = temporaryDirectoryCleaned && worktreeCleaned && composeCleaned;
  if (!failure && (!applicationPortReleased || !databasePortReleased)) {
    failure = "Readiness completed but one or more reserved ports remain occupied.";
  }
  if (!failure && !allResourcesCleaned) {
    failure = "Readiness completed but one or more named resources were not cleaned.";
  }
  if (Date.now() > deadlineAt && !failure) {
    failure = `Readiness exceeded its hard ${options.budgetMs}ms workload budget.`;
  }
  const report = {
    schemaVersion: 2,
    status: failure ? "BLOCKED" : "READY",
    pass: !failure,
    baseRef: options.baseRef,
    resolvedBaseRef,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    budgetMs: options.budgetMs,
    commandTimeoutMs: options.commandTimeoutMs,
    nodeVersion: process.versions.node,
    checks: {
      immutableWorktree: immutableWorktreeVerified,
      postgresImage: "postgres:16-alpine",
      migrationNoopVerified,
      recoveryVerified,
      applicationPortReleased,
      databasePortReleased,
    },
    resources: {
      composeProject: names.composeProject,
      temporaryDirectory,
      cleaned: allResourcesCleaned,
    },
    commands,
    failure,
  };
  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main() {
  const options = parseReadinessArguments(process.argv.slice(2), process.env, readinessRootDir);
  if (options.help) {
    console.log(
      "Usage: npm run proof:readiness -- [--base-ref <ref>] [--output <path>] [--budget-ms <ms>] [--command-timeout-ms <ms>]",
    );
    return;
  }
  const report = await runReadiness(options);
  console.log(`Phase C readiness: ${report.status} (${report.durationMs}ms)`);
  console.log(options.output);
  if (!report.pass) {
    console.error(report.failure);
    process.exit(1);
  }
}

if (resolve(process.argv[1] ?? "") === resolve(scriptPath)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
