import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  injectPageErrorInitScript,
  verifyFixtureUi,
} from "./proof-two-client-update-browser.mjs";

import {
  MUTATION_METHODS,
  ProofBlockedError,
  assertArtifactHashes,
  assertPathWithin,
  atomicWriteJson,
  boundedOutput,
  commandEnvironment,
  exitCode,
  fileManifest,
  hashFileManifest,
  hashTree,
  nowIso,
  patchStormDependencies,
  readJson,
  renderCommand,
  replaceOnce,
  sanitizeId,
  sha256Buffer,
  sha256File,
} from "./proof-two-client-update-helpers.mjs";
import {
  assertFixturePortsAvailable,
  fixtureAppDir,
  fixtureEnv,
  startFixtureProcesses,
  stopFixtureProcesses,
  writeFixtureEnv,
} from "./proof-two-client-update-processes.mjs";

export {
  fixtureAppDir,
  fixtureEnv,
  startFixtureProcesses,
  stopFixtureProcesses,
  writeFixtureEnv,
} from "./proof-two-client-update-processes.mjs";

export function customizeConsentPolicySource(source, policyVersion) {
  const startMarker = "/* storm:root-auth @stormeoio/consent:start */";
  const endMarker = "/* storm:root-auth @stormeoio/consent:end */";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || source.indexOf(startMarker, start + 1) >= 0) {
    throw new ProofBlockedError("Consent root auth marker missing or ambiguous", "customize");
  }
  const blockEnd = end + endMarker.length;
  const block = source.slice(start, blockEnd);
  const customized = replaceOnce(
    block,
    "<ConsentBanner />",
    `<ConsentBanner policyVersion="${policyVersion}" />`,
    "authenticated ConsentBanner",
  );
  return `${source.slice(0, start)}${customized}${source.slice(blockEnd)}`;
}

export function customizeFixture(appDir, definition) {
  const appPath = path.join(appDir, "client/src/App.tsx");
  let app = readFileSync(appPath, "utf8");
  app = replaceOnce(
    app,
    `import { DashboardPage } from "./pages/DashboardPage";`,
    `import { DashboardPage } from "./pages/DashboardPage";\nimport { ${definition.page} } from "./pages/${definition.page}";`,
    "DashboardPage import",
  );
  app = replaceOnce(
    app,
    `appName="${definition.projectName}"`,
    `appName="${definition.displayName}"`,
    "generated application name",
  );
  app = replaceOnce(
    app,
    `prepend: [{ id: "dashboard", label: "Dashboard", icon: "LayoutDashboard", path: "/" }],`,
    `prepend: [\n            { id: "dashboard", label: "Dashboard", icon: "LayoutDashboard", path: "/" },\n            { id: "business", label: "${definition.hasCrm ? "Documents" : "Projets"}", icon: "Folder", path: "${definition.route}" },\n          ],`,
    "navigation prepend",
  );
  app = replaceOnce(
    app,
    `          <Route path="/" component={DashboardPage} />`,
    `          <Route path="/" component={DashboardPage} />\n          <Route path="${definition.route}" component={${definition.page}} />`,
    "dashboard route",
  );
  app = customizeConsentPolicySource(app, definition.policyVersion);
  writeFileSync(appPath, app, "utf8");

  const indexPath = path.join(appDir, "client/index.html");
  const instrumentedIndex = injectPageErrorInitScript(readFileSync(indexPath, "utf8"));
  writeFileSync(indexPath, instrumentedIndex, "utf8");

  const page = `export function ${definition.page}() {
  return (
    <main className="proof-business-page p-6" data-proof-sentinel="${definition.sentinelText}">
      <h1 className="text-xl font-semibold">${definition.hasCrm ? "Documents clients" : "Projets actifs"}</h1>
      <p>${definition.sentinelText}</p>
    </main>
  );
}
`;
  writeFileSync(path.join(appDir, `client/src/pages/${definition.page}.tsx`), page, "utf8");

  const cssPath = path.join(appDir, "client/src/index.css");
  const theme = definition.hasCrm
    ? "\n/* BETA_PORTAL_THEME */\n.proof-business-page { border-left: 4px solid #155e75; }\n"
    : "\n/* ALPHA_OPS_THEME */\n.proof-business-page { border-left: 4px solid #475569; }\n";
  writeFileSync(cssPath, `${readFileSync(cssPath, "utf8")}${theme}`, "utf8");

  const schema = `import { serial, text, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";

export const proofBusinessRecords = pgTable("proof_business_records", {
  id: serial("id").primaryKey(),
  recordKey: text("record_key").notNull().unique(),
  payload: text("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
`;
  writeFileSync(path.join(appDir, "server/proof-schema.ts"), schema, "utf8");

  const drizzlePath = path.join(appDir, "drizzle.config.ts");
  let drizzle = readFileSync(drizzlePath, "utf8");
  drizzle = replaceOnce(drizzle, "schema: [", `schema: ["./server/proof-schema.ts", `, "Drizzle schema array");
  writeFileSync(drizzlePath, drizzle, "utf8");

  mkdirSync(path.join(appDir, "proof"), { recursive: true });
  const businessConfig = `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./server/proof-schema.ts"],
  out: "./drizzle",
  dbCredentials: { url: process.env["DATABASE_URL"]! },
});
`;
  writeFileSync(path.join(appDir, "proof/drizzle-business.config.ts"), businessConfig, "utf8");
  const sentinelTest = `import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const index = readFileSync(new URL("../client/index.html", import.meta.url), "utf8");
const page = readFileSync(new URL("../client/src/pages/${definition.page}.tsx", import.meta.url), "utf8");
const config = JSON.parse(readFileSync(new URL("../storm-config.json", import.meta.url), "utf8"));
assert.match(app, /${definition.displayName}/);
assert.match(app, /${definition.route.replace("/", "\\/")}/);
assert.match(index, /data-storm-proof-page-errors/);
assert.ok(index.indexOf("data-storm-proof-page-errors") < index.indexOf('type="module"'));
assert.match(page, /${definition.sentinelText}/);
assert.equal(config["@stormeoio/consent"].policyVersion, "${definition.policyVersion}");
`;
  writeFileSync(path.join(appDir, "proof/customization.test.mjs"), sentinelTest, "utf8");

  atomicWriteJson(path.join(appDir, "storm-config.json"), {
    "@stormeoio/consent": { policyVersion: definition.policyVersion },
  });
}

export function patchPackageFile(appDir, artifacts) {
  assertArtifactHashes(artifacts);
  const packagePath = path.join(appDir, "package.json");
  const patched = patchStormDependencies(readJson(packagePath), artifacts);
  atomicWriteJson(packagePath, patched.packageJson);
  return patched.installed;
}

export function backupPath(harness, definition) {
  return assertPathWithin(
    harness.options.workDir,
    path.join(harness.options.workDir, "backups", definition.name),
  );
}

export function backupClientFiles(appDir) {
  return fileManifest(appDir);
}

function packageTreeSnapshot(appDir) {
  const manifest = {};
  for (const relative of ["package.json", "package-lock.json"]) {
    manifest[relative] = sha256File(path.join(appDir, relative));
  }
  const packageRoot = path.join(appDir, "node_modules", "@stormeoio");
  if (existsSync(packageRoot)) {
    manifest["node_modules/@stormeoio"] = hashTree(packageRoot, { ignores: [] });
  }
  return hashFileManifest(manifest);
}

function drizzleTreeSnapshot(appDir) {
  const drizzleDir = path.join(appDir, "drizzle");
  if (!existsSync(drizzleDir)) {
    throw new ProofBlockedError(`Missing versioned Drizzle directory in ${appDir}`, "snapshot");
  }
  return hashTree(drizzleDir, { ignores: [] });
}

export function dockerArgs(definition, args) {
  return ["compose", "-p", definition.composeProjectName, ...args];
}

export function dockerEnv(definition) {
  return fixtureEnv(definition);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function startPostgres(harness, definition) {
  const appDir = fixtureAppDir(harness, definition);
  const journal = harness.runtime.fixtures[definition.name].commands;
  if (!journal.some(({ id }) => id === `${definition.name}:postgres-up`)) {
    await assertFixturePortsAvailable(definition);
    harness.runCommand({
      id: `${definition.name}:postgres-up`,
      fixture: definition.name,
      command: "docker",
      args: dockerArgs(definition, ["up", "-d", "postgres"]),
      cwd: appDir,
      env: dockerEnv(definition),
      required: false,
    });
  } else {
    const resumed = spawnSync("docker", dockerArgs(definition, ["up", "-d", "postgres"]), {
      cwd: appDir,
      env: commandEnvironment(dockerEnv(definition)),
      encoding: "utf8",
      timeout: 60_000,
    });
    if (exitCode(resumed) !== 0) {
      throw new ProofBlockedError(`Unable to restore PostgreSQL lifecycle for ${definition.name}`, "resume");
    }
  }
  const started = Date.now();
  const attempts = [];
  let status = 1;
  while (Date.now() - started < 30_000) {
    const probe = spawnSync(
      "docker",
      dockerArgs(definition, ["exec", "-T", "postgres", "pg_isready", "-U", "postgres", "-d", definition.databaseName]),
      {
        cwd: appDir,
        env: commandEnvironment(dockerEnv(definition)),
        encoding: "utf8",
        timeout: 5_000,
      },
    );
    attempts.push(`${nowIso()} exit=${exitCode(probe)} ${(probe.stdout ?? "").trim()}`);
    if (exitCode(probe) === 0) {
      status = 0;
      break;
    }
    await wait(500);
  }
  if (!journal.some(({ id }) => id === `${definition.name}:postgres-ready`)) {
    harness.recordSyntheticCommand({
      id: `${definition.name}:postgres-ready`,
      fixture: definition.name,
      command: "docker compose exec -T postgres pg_isready",
      startedAt: new Date(started).toISOString(),
      startedMs: started,
      exitCode: status,
      required: false,
      detail: `${attempts.join("\n")}\n`,
    });
  }
  if (status !== 0) throw new ProofBlockedError(`PostgreSQL did not become ready for ${definition.name}`, "postgres");
}

function postgresCommand(harness, definition, id, sql, options = {}) {
  return harness.runCommand({
    id,
    fixture: definition.name,
    command: "docker",
    args: dockerArgs(definition, [
      "exec",
      "-T",
      "postgres",
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      definition.databaseName,
      "-At",
      "-c",
      sql,
    ]),
    cwd: fixtureAppDir(harness, definition),
    env: dockerEnv(definition),
    required: options.required ?? false,
    allowFailure: options.allowFailure ?? false,
  });
}

function postgresOutputRaw(harness, definition, args) {
  const result = spawnSync("docker", dockerArgs(definition, ["exec", "-T", "postgres", ...args]), {
    cwd: fixtureAppDir(harness, definition),
    env: commandEnvironment(dockerEnv(definition)),
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  if (exitCode(result) !== 0) {
    throw new Error((result.stderr ?? Buffer.alloc(0)).toString("utf8"));
  }
  return result.stdout ?? Buffer.alloc(0);
}

export function normalizePgDump(value) {
  const normalized = value.toString("utf8")
    .split("\n")
    .filter((line) => !/^\\(?:un)?restrict\s+[A-Za-z0-9]+\s*$/.test(line))
    .join("\n");
  return Buffer.from(normalized, "utf8");
}

export function databaseFingerprints(harness, definition) {
  const common = ["-U", "postgres", "-d", definition.databaseName, "--no-owner", "--no-privileges"];
  const schema = postgresOutputRaw(harness, definition, ["pg_dump", ...common, "--schema-only"]);
  const data = postgresOutputRaw(harness, definition, [
    "pg_dump",
    ...common,
    "--data-only",
    "--column-inserts",
    "--rows-per-insert=1",
  ]);
  const sequences = postgresOutputRaw(harness, definition, [
    "psql",
    "-X",
    "-U",
    "postgres",
    "-d",
    definition.databaseName,
    "-At",
    "-c",
    "SELECT coalesce(json_agg(row_to_json(s) ORDER BY s.schemaname, s.sequencename)::text, '[]') FROM (SELECT schemaname, sequencename, start_value, min_value, max_value, increment_by, cycle, cache_size, last_value FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog', 'information_schema')) s;",
  ]);
  return {
    schemaFingerprint: sha256Buffer(normalizePgDump(schema)),
    dataFingerprint: sha256Buffer(normalizePgDump(data)),
    sequencesFingerprint: sha256Buffer(sequences),
  };
}

export function recoverySnapshot(harness, definition) {
  const appDir = fixtureAppDir(harness, definition);
  return {
    packageTree: packageTreeSnapshot(appDir),
    drizzleTree: drizzleTreeSnapshot(appDir),
    ...databaseFingerprints(harness, definition),
  };
}

export function backupFixture(harness, definition) {
  const appDir = fixtureAppDir(harness, definition);
  const destination = backupPath(harness, definition);
  if (existsSync(destination)) {
    throw new ProofBlockedError(`Backup already exists for ${definition.name}`, "backup");
  }
  mkdirSync(destination, { recursive: true });
  for (const relative of ["package.json", "package-lock.json"]) {
    copyFileSync(path.join(appDir, relative), path.join(destination, relative));
  }
  cpSync(path.join(appDir, "drizzle"), path.join(destination, "drizzle"), {
    recursive: true,
    errorOnExist: true,
  });
  const dumpPath = path.join(destination, "database.dump");
  harness.runBinaryOutput({
    id: `${definition.name}:backup`,
    fixture: definition.name,
    command: "docker",
    args: dockerArgs(definition, [
      "exec",
      "-T",
      "postgres",
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      definition.databaseName,
      "-Fc",
      "--no-owner",
      "--no-privileges",
    ]),
    cwd: appDir,
    env: dockerEnv(definition),
    outputPath: dumpPath,
  });
  const snapshot = recoverySnapshot(harness, definition);
  atomicWriteJson(path.join(destination, "snapshot.json"), snapshot);
  atomicWriteJson(path.join(destination, "backup-manifest.json"), {
    schemaVersion: 1,
    createdAt: nowIso(),
    packageJson: sha256File(path.join(destination, "package.json")),
    packageLock: sha256File(path.join(destination, "package-lock.json")),
    drizzleTree: hashTree(path.join(destination, "drizzle"), { ignores: [] }),
    databaseDump: sha256File(dumpPath),
    snapshot,
  });
  return snapshot;
}

function restoreDatabase(harness, definition, dumpPath, idSuffix = "") {
  const appDir = fixtureAppDir(harness, definition);
  harness.runCommand({
    id: `${definition.name}:database-drop${idSuffix}`,
    fixture: definition.name,
    command: "docker",
    args: dockerArgs(definition, [
      "exec", "-T", "postgres", "dropdb", "-U", "postgres", "--if-exists", definition.databaseName,
    ]),
    cwd: appDir,
    env: dockerEnv(definition),
    required: false,
  });
  harness.runCommand({
    id: `${definition.name}:database-create${idSuffix}`,
    fixture: definition.name,
    command: "docker",
    args: dockerArgs(definition, [
      "exec", "-T", "postgres", "createdb", "-U", "postgres", definition.databaseName,
    ]),
    cwd: appDir,
    env: dockerEnv(definition),
    required: false,
  });
  harness.runCommand({
    id: `${definition.name}:database-restore${idSuffix}`,
    fixture: definition.name,
    command: "docker",
    args: dockerArgs(definition, [
      "exec", "-T", "postgres", "pg_restore", "-U", "postgres", "-d", definition.databaseName,
      "--no-owner", "--no-privileges", "--exit-on-error",
    ]),
    cwd: appDir,
    env: dockerEnv(definition),
    input: readFileSync(dumpPath),
    required: false,
  });
}

export async function rollbackFixture(harness, definition, options = {}) {
  const runtime = harness.runtime.fixtures[definition.name];
  const idSuffix = options.idSuffix ?? "";
  const appDir = fixtureAppDir(harness, definition);
  const source = backupPath(harness, definition);
  if (!existsSync(path.join(source, "backup-manifest.json"))) {
    throw new ProofBlockedError(`Cannot rollback ${definition.name}: backup manifest missing`, "rollback");
  }
  const manifest = readJson(path.join(source, "backup-manifest.json"));
  if (
    sha256File(path.join(source, "package.json")) !== manifest.packageJson
    || sha256File(path.join(source, "package-lock.json")) !== manifest.packageLock
    || hashTree(path.join(source, "drizzle"), { ignores: [] }) !== manifest.drizzleTree
    || sha256File(path.join(source, "database.dump")) !== manifest.databaseDump
  ) {
    throw new ProofBlockedError(`Backup hash mismatch for ${definition.name}`, "rollback");
  }

  const startedAt = nowIso();
  const startedMs = Date.now();
  await stopFixtureIfRunning(harness, definition, `${definition.name}:stop-before-rollback${idSuffix}`);
  for (const relative of ["package.json", "package-lock.json"]) {
    copyFileSync(path.join(source, relative), path.join(appDir, relative));
  }
  const drizzleDir = assertPathWithin(appDir, path.join(appDir, "drizzle"));
  rmSync(drizzleDir, { recursive: true, force: true });
  cpSync(path.join(source, "drizzle"), drizzleDir, { recursive: true, errorOnExist: true });
  restoreDatabase(harness, definition, path.join(source, "database.dump"), idSuffix);
  harness.runCommand({
    id: `${definition.name}:rollback-install-baseline${idSuffix}`,
    fixture: definition.name,
    command: "npm",
    args: ["ci", "--no-audit", "--no-fund"],
    cwd: appDir,
    env: fixtureEnv(definition),
    required: false,
  });
  harness.recordSyntheticCommand({
    id: `${definition.name}:rollback${idSuffix}`,
    fixture: definition.name,
    command: "restore package files + lock + drizzle + drop/create/pg_restore",
    startedAt,
    startedMs,
    exitCode: 0,
    required: true,
    detail: "Baseline files and database restored from verified backup.\n",
  });
  await startFixtureProcesses(harness, definition, `${definition.name}:start-rollback${idSuffix}`);
  const sentinels = await verifyFixtureApi(harness, definition, "rollback");
  const after = recoverySnapshot(harness, definition);
  const before = manifest.snapshot;
  const exact = Object.keys(before).every((key) => before[key] === after[key]);
  harness.recordSyntheticCommand({
    id: `${definition.name}:verify-rollback${idSuffix}`,
    fixture: definition.name,
    command: "compare DB/packages/drizzle fingerprints and read-only sentinels",
    startedAt: nowIso(),
    startedMs: Date.now(),
    exitCode: exact && Object.values(sentinels).every(Boolean) ? 0 : 1,
    required: true,
    detail: `${JSON.stringify({ before, after, sentinels }, null, 2)}\n`,
  });
  const uiCommandId = idSuffix === ""
    ? `${definition.name}:verify-ui-rollback`
    : idSuffix === "-before-warm"
      ? `${definition.name}:verify-ui-rollback-before-warm`
      : `${definition.name}:verify-ui-rollback${idSuffix}`;
  await verifyFixtureUi(harness, definition, "rollback", uiCommandId);
  await stopFixtureProcesses(harness, definition, `${definition.name}:stop-rollback${idSuffix}`);
  if (options.recordRecovery !== false) {
    runtime.recovery = { attempted: true, before, after, appRestarted: true };
  }
  harness.persist();
  return exact;
}

export async function stopFixtureIfRunning(harness, definition, commandId) {
  if (!harness.processes.has(definition.name)) return;
  await stopFixtureProcesses(harness, definition, commandId, false);
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  update(response) {
    const headers = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
    for (const header of headers) {
      for (const cookie of header.split(/,(?=[^;,]+=)/)) {
        const pair = cookie.split(";", 1)[0];
        const separator = pair.indexOf("=");
        if (separator <= 0) continue;
        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        if (value) this.cookies.set(name, value);
        else this.cookies.delete(name);
      }
    }
  }

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

async function jsonRequest(url, init, jar) {
  const headers = new Headers(init.headers ?? {});
  if (jar.header()) headers.set("Cookie", jar.header());
  const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(10_000) });
  jar.update(response);
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function createApiSession(definition) {
  const jar = new CookieJar();
  const origin = `http://127.0.0.1:${definition.clientPort}`;
  const base = `http://127.0.0.1:${definition.serverPort}/api`;
  const bootstrap = await jsonRequest(`${base}/storm/csrf`, { method: "GET" }, jar);
  if (!bootstrap.response.ok || typeof bootstrap.body?.csrfToken !== "string") {
    throw new Error(`CSRF bootstrap failed (${bootstrap.response.status})`);
  }
  return { jar, origin, base, csrfToken: bootstrap.body.csrfToken };
}

async function mutation(session, pathName, method, body) {
  if (!MUTATION_METHODS.has(method)) throw new Error(`Not an unsafe method: ${method}`);
  return jsonRequest(`${session.base}${pathName}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: session.origin,
      "X-Storm-CSRF": session.csrfToken,
    },
    body: JSON.stringify(body),
  }, session.jar);
}

async function authenticateFixture(definition, phase) {
  const session = await createApiSession(definition);
  const credentials = {
    email: `proof-${definition.name}@example.test`,
    password: "Proof-password-2026!",
    name: `${definition.displayName} Proof`,
  };
  const endpoint = phase === "baseline" ? "/auth/register" : "/auth/login";
  const payload = phase === "baseline"
    ? credentials
    : { email: credentials.email, password: credentials.password };
  const auth = await mutation(session, endpoint, "POST", payload);
  if (!auth.response.ok) {
    throw new Error(`${phase} auth failed (${auth.response.status}): ${JSON.stringify(auth.body)}`);
  }
  const me = await jsonRequest(`${session.base}/auth/me`, { method: "GET" }, session.jar);
  if (!me.response.ok || me.body?.user?.email !== credentials.email) {
    throw new Error(`Auth read sentinel failed for ${definition.name}`);
  }
  return session;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function seedBusinessData(harness, definition) {
  const payload = definition.hasCrm ? "beta-client-migration-data-v1" : "alpha-project-data-v1";
  postgresCommand(
    harness,
    definition,
    `${definition.name}:seed-business`,
    `INSERT INTO proof_business_records (record_key, payload) VALUES (${sqlLiteral(`${definition.name}-record`)}, ${sqlLiteral(payload)}) ON CONFLICT (record_key) DO UPDATE SET payload = EXCLUDED.payload;`,
  );
  if (definition.hasCrm) {
    postgresCommand(
      harness,
      definition,
      `${definition.name}:seed-crm`,
      `INSERT INTO crm_contacts (id, tenant_id, first_name, last_name, email, status) VALUES ('proof-beta-contact', 'proof-beta-tenant', 'Beta', 'Client', 'beta-client@example.test', 'client') ON CONFLICT (id) DO NOTHING;`,
    );
  }
}

function verifyBusinessData(harness, definition) {
  const expected = definition.hasCrm ? "beta-client-migration-data-v1" : "alpha-project-data-v1";
  const business = postgresOutputRaw(harness, definition, [
    "psql", "-X", "-U", "postgres", "-d", definition.databaseName, "-At", "-c",
    `SELECT record_key || ':' || payload FROM proof_business_records WHERE record_key = ${sqlLiteral(`${definition.name}-record`)};`,
  ]).toString("utf8").trim();
  if (business !== `${definition.name}-record:${expected}`) return false;
  if (!definition.hasCrm) return true;
  const crm = postgresOutputRaw(harness, definition, [
    "psql", "-X", "-U", "postgres", "-d", definition.databaseName, "-At", "-c",
    "SELECT id || ':' || first_name || ':' || last_name FROM crm_contacts WHERE id = 'proof-beta-contact';",
  ]).toString("utf8").trim();
  return crm === "proof-beta-contact:Beta:Client";
}

async function verifyFixtureApi(harness, definition, phase) {
  const appDir = fixtureAppDir(harness, definition);
  const session = await authenticateFixture(definition, phase === "baseline" ? "baseline" : "existing");
  const auth = true;
  const consentBeforeCsrf = await jsonRequest(`${session.base}/consent/state`, { method: "GET" }, session.jar);
  if (!consentBeforeCsrf.response.ok) throw new Error("Consent state unavailable before CSRF negative proof");
  const rejected = await jsonRequest(`${session.base}/consent/preferences`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      necessary: true,
      analytics: !definition.hasCrm,
      marketing: true,
      policyVersion: definition.policyVersion,
    }),
  }, session.jar);
  const consentAfterCsrf = await jsonRequest(`${session.base}/consent/state`, { method: "GET" }, session.jar);
  const csrfNegative = rejected.response.status === 403
    && consentAfterCsrf.response.ok
    && JSON.stringify(consentAfterCsrf.body) === JSON.stringify(consentBeforeCsrf.body);
  if (!csrfNegative) {
    throw new Error(`CSRF negative proof failed: status=${rejected.response.status}, stateChanged=${JSON.stringify(consentAfterCsrf.body) !== JSON.stringify(consentBeforeCsrf.body)}`);
  }
  let consentBaseline = false;
  let consentWithdrawn = phase === "target" ? false : undefined;

  if (phase === "baseline") {
    const preferences = await mutation(session, "/consent/preferences", "PUT", {
      necessary: true,
      analytics: definition.hasCrm,
      marketing: false,
      policyVersion: definition.policyVersion,
    });
    if (!preferences.response.ok) {
      throw new Error(`Consent baseline mutation failed: ${JSON.stringify(preferences.body)}`);
    }
    seedBusinessData(harness, definition);
  } else if (phase === "target" || phase === "target-warm") {
    const withdrawn = await mutation(session, "/consent/withdraw", "POST", {});
    if (!withdrawn.response.ok) {
      throw new Error(`Consent withdrawal failed: ${JSON.stringify(withdrawn.body)}`);
    }
  }

  const state = await jsonRequest(`${session.base}/consent/state`, { method: "GET" }, session.jar);
  if (!state.response.ok || !state.body?.consent) {
    throw new Error(`Consent state read failed: ${JSON.stringify(state.body)}`);
  }
  consentBaseline = state.body.consent.policyVersion === definition.policyVersion;
  if (phase === "target" || phase === "target-warm") {
    consentWithdrawn = typeof state.body.consent.withdrawnAt === "string";
  }
  const businessCustomization = verifyBusinessData(harness, definition);

  const sourceTest = spawnSync(process.execPath, ["proof/customization.test.mjs"], {
    cwd: appDir,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (exitCode(sourceTest) !== 0) {
    throw new Error(`Customization source sentinel failed: ${sourceTest.stderr}`);
  }
  const result = {
    auth,
    csrfNegative,
    consentBaseline,
    ...(consentWithdrawn === undefined ? {} : { consentWithdrawn }),
    businessCustomization,
  };
  if (!Object.values(result).every(Boolean)) {
    throw new Error(`Sentinel failure for ${definition.name}/${phase}: ${JSON.stringify(result)}`);
  }
  return result;
}

export async function journalVerification(harness, definition, phase, commandId) {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const logPath = path.join(harness.paths.logs, `${sanitizeId(commandId)}.log`);
  assertPathWithin(harness.options.workDir, logPath);
  let sentinels;
  try {
    sentinels = await verifyFixtureApi(harness, definition, phase);
    writeFileSync(logPath, `${JSON.stringify(sentinels, null, 2)}\n`, "utf8");
  } catch (error) {
    harness.recordSyntheticCommand({
      id: commandId,
      fixture: definition.name,
      command: `HTTP + PostgreSQL + source sentinels (${phase})`,
      startedAt,
      startedMs,
      exitCode: 1,
      required: true,
      detail: `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    });
    throw error;
  }
  harness.recordSyntheticCommand({
    id: commandId,
    fixture: definition.name,
    command: `HTTP + PostgreSQL + source sentinels (${phase})`,
    startedAt,
    startedMs,
    exitCode: 0,
    required: true,
    detail: `${JSON.stringify(sentinels, null, 2)}\n`,
  });
  await verifyFixtureUi(
    harness,
    definition,
    phase,
    `${definition.name}:verify-ui-${phase}`,
  );
  return sentinels;
}

function concurrentDatabaseIdentity(harness, definition) {
  const rows = postgresOutputRaw(harness, definition, [
    "psql", "-X", "-U", "postgres", "-d", definition.databaseName, "-At", "-c",
    "SELECT coalesce(string_agg(record_key || ':' || payload, ',' ORDER BY record_key), '') FROM proof_business_records;",
  ]).toString("utf8").trim();
  const expectedRows = definition.hasCrm
    ? `${definition.name}-record:beta-client-migration-data-v1`
    : `${definition.name}-record:alpha-project-data-v1`;
  return {
    fixture: definition.name,
    databaseName: definition.databaseName,
    rows,
    expectedRows,
    isolated: rows === expectedRows,
  };
}

export async function verifyConcurrentFixtures(harness, definitions, dependencies = {}) {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const probes = definitions.flatMap((definition) => [
    {
      fixture: definition.name,
      kind: "server",
      endpoint: `http://127.0.0.1:${definition.serverPort}/api/health`,
      expectedIdentity: '"ok":true',
    },
    {
      fixture: definition.name,
      kind: "client",
      endpoint: `http://127.0.0.1:${definition.clientPort}/`,
      expectedIdentity: `<title>${definition.projectName}</title>`,
    },
  ]);
  const databaseProbe = dependencies.databaseProbe ?? ((definition) => (
    concurrentDatabaseIdentity(harness, definition)
  ));
  let detail;
  let status = 0;
  try {
    const http = await Promise.all(probes.map(async (probe) => {
      const response = await fetch(probe.endpoint, { signal: AbortSignal.timeout(5_000) });
      const body = await response.text();
      return {
        ...probe,
        status: response.status,
        ok: response.ok,
        identityMatched: body.includes(probe.expectedIdentity),
      };
    }));
    const databases = definitions.map(databaseProbe);
    status = http.every(({ ok, identityMatched }) => ok && identityMatched)
      && databases.every(({ isolated }) => isolated)
      ? 0
      : 1;
    detail = `${JSON.stringify({ http, databases }, null, 2)}\n`;
  } catch (error) {
    status = 1;
    detail = `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`;
  }
  harness.recordSyntheticCommand({
    id: "verify-concurrent-isolation",
    command: "prove distinct Alpha/Beta HTTP identities and isolated business rows while both are running",
    startedAt,
    startedMs,
    exitCode: status,
    required: true,
    detail,
  });
}
