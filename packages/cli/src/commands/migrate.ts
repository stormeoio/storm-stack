import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { findProjectRoot, readConfig } from "../config";
import { PLUGINS, resolvePlugin } from "../registry";

type MigrateAction = "generate" | "run" | "rollback" | "status" | "reset";

interface MigrateOptions {
  yes?: boolean;
}

const MIGRATIONS_DIR = "drizzle";
const JOURNAL_FILE = "storm-migrations.json";

interface MigrationEntry {
  id: string;
  plugin: string;
  name: string;
  timestamp: number;
  applied: boolean;
  appliedAt?: number;
  hash: string;
  sql: string;
}

interface MigrationJournal {
  version: 1;
  entries: MigrationEntry[];
}

export async function migrateCommand(action?: string, pluginArg?: string, opts: MigrateOptions = {}): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("Aucun projet Storm Stack trouvé. Lancez " + pc.cyan("storm init") + " d'abord.");
    process.exit(1);
  }

  const config = readConfig(root);
  if (!config) {
    p.log.error("Fichier " + pc.dim("storm.json") + " introuvable.");
    process.exit(1);
  }

  const migrationsDir = path.join(root, MIGRATIONS_DIR);
  fs.mkdirSync(migrationsDir, { recursive: true });

  const resolvedAction = (action ?? "status") as MigrateAction;

  switch (resolvedAction) {
    case "generate":
      await generateMigrations(root, config.installed, migrationsDir, pluginArg);
      break;
    case "run":
      await runMigrations(root, migrationsDir, opts);
      break;
    case "rollback":
      await rollbackMigration(root, migrationsDir, opts);
      break;
    case "status":
      showStatus(root, migrationsDir, config.installed);
      break;
    case "reset":
      await resetMigrations(root, migrationsDir, opts);
      break;
    default:
      p.log.error(`Action inconnue : ${pc.red(resolvedAction)}`);
      p.log.info("Actions disponibles : " + ["generate", "run", "rollback", "status", "reset"].map(a => pc.cyan(a)).join(", "));
      process.exit(1);
  }
}

// ── Generate ────────────────────────────────────────────────────────────────

async function generateMigrations(root: string, installed: string[], migrationsDir: string, pluginArg?: string): Promise<void> {
  const plugins = pluginArg
    ? [resolvePlugin(pluginArg)].filter(Boolean)
    : installed.map((id) => PLUGINS.find((pl) => pl.id === id)).filter(Boolean);

  if (plugins.length === 0) {
    p.log.info("Aucun plugin installé avec un schéma.");
    return;
  }

  const journal = readJournal(root, migrationsDir);
  const spinner = p.spinner();
  let generated = 0;

  for (const plugin of plugins) {
    if (!plugin) continue;
    if (!plugin.files.includes("schema.ts")) continue;

    spinner.start(`Génération pour ${pc.cyan(plugin.shortName)}…`);

    const timestamp = Date.now();
    const migrationName = `${formatTimestamp(timestamp)}_${plugin.shortName}`;
    const sqlContent = generatePluginSQL(root, plugin.shortName, plugin.id);

    if (!sqlContent.trim()) {
      spinner.stop(`${pc.dim("○")} ${pc.dim(plugin.shortName)} — aucun changement`);
      continue;
    }

    const sqlBody = sqlContent.replace(/^-- .*$/gm, "").trim();
    const hash = simpleHash(sqlBody);
    const lastForPlugin = journal.entries.filter((e) => e.plugin === plugin.id).pop();
    if (lastForPlugin && lastForPlugin.hash === hash) {
      spinner.stop(`${pc.dim("○")} ${pc.dim(plugin.shortName)} — pas de diff`);
      continue;
    }

    const migrationFile = path.join(migrationsDir, `${migrationName}.sql`);
    fs.writeFileSync(migrationFile, sqlContent, "utf8");

    const rollbackContent = generateRollbackSQL(sqlContent, plugin.shortName);
    const rollbackFile = path.join(migrationsDir, `${migrationName}_rollback.sql`);
    fs.writeFileSync(rollbackFile, rollbackContent, "utf8");

    journal.entries.push({
      id: migrationName,
      plugin: plugin.id,
      name: `${plugin.shortName} schema update`,
      timestamp,
      applied: false,
      hash,
      sql: migrationName + ".sql",
    });

    generated++;
    spinner.stop(`${pc.green("✓")} ${pc.cyan(plugin.shortName)} — ${migrationFile.replace(root + "/", "")}`);
  }

  writeJournal(root, migrationsDir, journal);

  if (generated === 0) {
    p.log.info(pc.dim("Aucune migration générée — les schémas sont à jour."));
  } else {
    p.log.info(`\n${pc.green(String(generated))} migration(s) générée(s) dans ${pc.dim(MIGRATIONS_DIR + "/")}`);
    p.log.info(`Exécutez ${pc.cyan("storm migrate run")} pour les appliquer.`);
  }
}

function generatePluginSQL(root: string, shortName: string, pluginId: string): string {
  const schemaFiles = [
    path.join(root, "plugins", shortName, "schema.ts"),
    path.join(root, `node_modules/${pluginId}/dist/schema.js`),
  ];

  const schemaFile = schemaFiles.find((f) => fs.existsSync(f));
  if (!schemaFile) return "";

  const content = fs.readFileSync(schemaFile, "utf8");
  const statements: string[] = [];

  const tableMatches = content.matchAll(/pgTable\(\s*["']([^"']+)["']/g);
  for (const match of tableMatches) {
    const tableName = match[1]!;
    statements.push(generateCreateTableFromSchema(content, tableName));
  }

  const enumMatches = content.matchAll(/pgEnum\(\s*["']([^"']+)["']\s*,\s*\[([^\]]+)\]/g);
  for (const match of enumMatches) {
    const enumName = match[1]!;
    const values = match[2]!.replace(/["']/g, "").split(",").map((v) => v.trim()).filter(Boolean);
    statements.push(`DO $$ BEGIN\n  CREATE TYPE "${enumName}" AS ENUM (${values.map((v) => `'${v}'`).join(", ")});\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND $$;`);
  }

  if (statements.length === 0) return "";

  return `-- Migration: ${pluginId}\n-- Generated: ${new Date().toISOString()}\n\n${statements.join("\n\n")}\n`;
}

function generateCreateTableFromSchema(content: string, tableName: string): string {
  const columns: string[] = [];

  const tableRegion = extractTableRegion(content, tableName);
  if (!tableRegion) return `-- Could not parse table "${tableName}"`;

  const colPatterns: [RegExp, (name: string, colName: string) => string][] = [
    [/uuid\(["']([^"']+)["']\)\.defaultRandom\(\)\.primaryKey\(\)/g, (_, col) => `  "${col}" UUID DEFAULT gen_random_uuid() PRIMARY KEY`],
    [/uuid\(["']([^"']+)["']\)/g, (_, col) => `  "${col}" UUID`],
    [/text\(["']([^"']+)["']\)/g, (_, col) => `  "${col}" TEXT`],
    [/varchar\(["']([^"']+)["']\s*,\s*\{\s*length:\s*(\d+)\s*\}\)/g, (_, col) => `  "${col}" VARCHAR`],
    [/integer\(["']([^"']+)["']\)/g, (_, col) => `  "${col}" INTEGER`],
    [/boolean\(["']([^"']+)["']\)/g, (_, col) => `  "${col}" BOOLEAN`],
    [/timestamp\(["']([^"']+)["']\)/g, (_, col) => `  "${col}" TIMESTAMP`],
    [/jsonb\(["']([^"']+)["']\)/g, (_, col) => `  "${col}" JSONB`],
    [/serial\(["']([^"']+)["']\)/g, (_, col) => `  "${col}" SERIAL`],
    [/numeric\(["']([^"']+)["']\)/g, (_, col) => `  "${col}" NUMERIC`],
  ];

  const seen = new Set<string>();
  for (const [pattern, formatter] of colPatterns) {
    for (const match of tableRegion.matchAll(pattern)) {
      const colName = match[1]!;
      if (seen.has(colName)) continue;
      seen.add(colName);
      let def = formatter("", colName);
      const lineContext = getLineContext(tableRegion, match.index!);
      if (lineContext.includes(".notNull()")) def += " NOT NULL";
      if (lineContext.includes(".defaultNow()")) def += " DEFAULT NOW()";
      if (lineContext.includes(".default(true)")) def += " DEFAULT TRUE";
      if (lineContext.includes(".default(false)")) def += " DEFAULT FALSE";
      columns.push(def);
    }
  }

  if (columns.length === 0) return `-- Could not parse columns for "${tableName}"`;

  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n${columns.join(",\n")}\n);`;
}

function extractTableRegion(content: string, tableName: string): string | null {
  const start = content.indexOf(`pgTable("${tableName}"`);
  if (start === -1) return null;
  let depth = 0;
  let i = content.indexOf("{", start);
  if (i === -1) return null;
  const begin = i;
  for (; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) return content.slice(begin, i + 1);
    }
  }
  return null;
}

function getLineContext(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end);
}

function generateRollbackSQL(sql: string, shortName: string): string {
  const lines: string[] = [`-- Rollback: ${shortName}`, `-- Generated: ${new Date().toISOString()}`, ""];

  const tableMatches = sql.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g);
  for (const match of tableMatches) {
    lines.push(`DROP TABLE IF EXISTS "${match[1]}" CASCADE;`);
  }

  const enumMatches = sql.matchAll(/CREATE TYPE "([^"]+)"/g);
  for (const match of enumMatches) {
    lines.push(`DROP TYPE IF EXISTS "${match[1]}" CASCADE;`);
  }

  if (lines.length <= 3) {
    lines.push("-- No rollback statements generated");
  }

  return lines.join("\n") + "\n";
}

// ── Run ─────────────────────────────────────────────────────────────────────

async function runMigrations(root: string, migrationsDir: string, opts: MigrateOptions): Promise<void> {
  const journal = readJournal(root, migrationsDir);
  const pending = journal.entries.filter((e) => !e.applied);

  if (pending.length === 0) {
    p.log.info(pc.dim("Toutes les migrations sont appliquées."));
    return;
  }

  p.log.info(`${pc.yellow(String(pending.length))} migration(s) en attente :\n`);
  for (const entry of pending) {
    const plugin = entry.plugin.replace("@stormstack/", "");
    p.log.info(`  ${pc.dim("○")} ${entry.id} ${pc.dim(`(${plugin})`)}`);
  }
  p.log.info("");

  if (!opts.yes) {
    const confirmed = await p.confirm({
      message: `Appliquer ${pending.length} migration(s) ?`,
      initialValue: true,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Annulé.");
      return;
    }
  }

  const spinner = p.spinner();
  let applied = 0;
  let failed = 0;

  for (const entry of pending) {
    const sqlFile = path.join(migrationsDir, entry.sql);
    if (!fs.existsSync(sqlFile)) {
      p.log.error(`Fichier introuvable : ${pc.dim(entry.sql)}`);
      failed++;
      continue;
    }

    spinner.start(`Applying ${entry.id}…`);

    try {
      const sql = fs.readFileSync(sqlFile, "utf8");
      executeSQLVia(root, sql);
      entry.applied = true;
      entry.appliedAt = Date.now();
      applied++;
      spinner.stop(`${pc.green("✓")} ${entry.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.stop(`${pc.red("✗")} ${entry.id} — ${msg}`);
      failed++;
      break;
    }
  }

  writeJournal(root, migrationsDir, journal);

  p.log.info("");
  if (failed > 0) {
    p.log.error(`${applied} appliquée(s), ${failed} échouée(s). Corrigez et relancez ${pc.cyan("storm migrate run")}.`);
  } else {
    p.log.info(`${pc.green(String(applied))} migration(s) appliquée(s).`);
  }
}

// ── Rollback ────────────────────────────────────────────────────────────────

async function rollbackMigration(root: string, migrationsDir: string, opts: MigrateOptions): Promise<void> {
  const journal = readJournal(root, migrationsDir);
  const applied = journal.entries.filter((e) => e.applied);

  if (applied.length === 0) {
    p.log.info(pc.dim("Aucune migration à annuler."));
    return;
  }

  const last = applied[applied.length - 1]!;
  const plugin = last.plugin.replace("@stormstack/", "");

  p.log.info(`Dernière migration : ${pc.cyan(last.id)} ${pc.dim(`(${plugin})`)}`);

  if (!opts.yes) {
    const confirmed = await p.confirm({
      message: `Annuler ${last.id} ?`,
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Annulé.");
      return;
    }
  }

  const rollbackFile = path.join(migrationsDir, last.sql.replace(".sql", "_rollback.sql"));
  if (!fs.existsSync(rollbackFile)) {
    p.log.error(`Fichier rollback introuvable : ${pc.dim(rollbackFile)}`);
    process.exit(1);
  }

  const spinner = p.spinner();
  spinner.start(`Rollback ${last.id}…`);

  try {
    const sql = fs.readFileSync(rollbackFile, "utf8");
    executeSQLVia(root, sql);
    last.applied = false;
    delete last.appliedAt;
    writeJournal(root, migrationsDir, journal);
    spinner.stop(`${pc.green("✓")} Rollback ${last.id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.stop(`${pc.red("✗")} Rollback échoué — ${msg}`);
    process.exit(1);
  }
}

// ── Status ──────────────────────────────────────────────────────────────────

function showStatus(root: string, migrationsDir: string, installed: string[]): void {
  const journal = readJournal(root, migrationsDir);

  if (journal.entries.length === 0) {
    p.log.info(pc.dim("Aucune migration enregistrée."));
    p.log.info(`Exécutez ${pc.cyan("storm migrate generate")} pour générer des migrations.`);
    return;
  }

  const applied = journal.entries.filter((e) => e.applied);
  const pending = journal.entries.filter((e) => !e.applied);

  p.log.info(pc.bold("Migrations Storm Stack"));
  p.log.info("");

  if (applied.length > 0) {
    p.log.info(pc.green(`Appliquées (${applied.length}) :`));
    for (const entry of applied) {
      const plugin = entry.plugin.replace("@stormstack/", "");
      const date = entry.appliedAt ? new Date(entry.appliedAt).toLocaleString("fr-FR") : "?";
      p.log.info(`  ${pc.green("✓")} ${entry.id} ${pc.dim(`(${plugin})`)} ${pc.dim(date)}`);
    }
    p.log.info("");
  }

  if (pending.length > 0) {
    p.log.info(pc.yellow(`En attente (${pending.length}) :`));
    for (const entry of pending) {
      const plugin = entry.plugin.replace("@stormstack/", "");
      p.log.info(`  ${pc.dim("○")} ${entry.id} ${pc.dim(`(${plugin})`)}`);
    }
    p.log.info("");
    p.log.info(`Exécutez ${pc.cyan("storm migrate run")} pour les appliquer.`);
  }

  // Plugins without migrations
  const pluginsWithMigrations = new Set(journal.entries.map((e) => e.plugin));
  const pluginsWithoutMigrations = installed.filter(
    (id) => !pluginsWithMigrations.has(id) && PLUGINS.find((pl) => pl.id === id && pl.files.includes("schema.ts")),
  );

  if (pluginsWithoutMigrations.length > 0) {
    p.log.info(pc.dim(`Plugins sans migration : ${pluginsWithoutMigrations.map((id) => id.replace("@stormstack/", "")).join(", ")}`));
    p.log.info(`Exécutez ${pc.cyan("storm migrate generate")} pour les créer.`);
  }
}

// ── Reset ───────────────────────────────────────────────────────────────────

async function resetMigrations(root: string, migrationsDir: string, opts: MigrateOptions): Promise<void> {
  const journal = readJournal(root, migrationsDir);
  const applied = journal.entries.filter((e) => e.applied);

  if (applied.length === 0) {
    p.log.info(pc.dim("Aucune migration appliquée."));
    return;
  }

  p.log.warn(`${pc.red("ATTENTION")} : ceci va annuler ${applied.length} migration(s) dans l'ordre inverse.`);

  if (!opts.yes) {
    const confirmed = await p.confirm({
      message: `Annuler TOUTES les ${applied.length} migration(s) ?`,
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Annulé.");
      return;
    }
  }

  const reversed = [...applied].reverse();
  const spinner = p.spinner();
  let rolled = 0;

  for (const entry of reversed) {
    const rollbackFile = path.join(migrationsDir, entry.sql.replace(".sql", "_rollback.sql"));
    if (!fs.existsSync(rollbackFile)) {
      p.log.error(`Fichier rollback introuvable : ${pc.dim(rollbackFile)} — arrêt.`);
      break;
    }

    spinner.start(`Rollback ${entry.id}…`);
    try {
      const sql = fs.readFileSync(rollbackFile, "utf8");
      executeSQLVia(root, sql);
      entry.applied = false;
      delete entry.appliedAt;
      rolled++;
      spinner.stop(`${pc.green("✓")} Rollback ${entry.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.stop(`${pc.red("✗")} ${entry.id} — ${msg}`);
      break;
    }
  }

  writeJournal(root, migrationsDir, journal);
  p.log.info(`\n${pc.green(String(rolled))} migration(s) annulée(s).`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function readJournal(root: string, migrationsDir: string): MigrationJournal {
  const file = path.join(migrationsDir, JOURNAL_FILE);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return { version: 1, entries: [] };
}

function writeJournal(root: string, migrationsDir: string, journal: MigrationJournal): void {
  const file = path.join(migrationsDir, JOURNAL_FILE);
  fs.writeFileSync(file, JSON.stringify(journal, null, 2) + "\n", "utf8");
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function executeSQLVia(root: string, sql: string): void {
  const envFile = path.join(root, ".env");
  let databaseUrl = process.env["DATABASE_URL"] ?? "";

  if (!databaseUrl && fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, "utf8");
    const match = envContent.match(/^DATABASE_URL=["']?([^\n"']+)["']?/m);
    if (match) databaseUrl = match[1]!;
  }

  if (!databaseUrl) {
    throw new Error("DATABASE_URL non définie. Ajoutez-la dans .env ou en variable d'environnement.");
  }

  const tmpFile = path.join(root, ".storm-migrate-tmp.sql");
  try {
    fs.writeFileSync(tmpFile, sql, "utf8");
    execSync(`psql "${databaseUrl}" -f "${tmpFile}" --no-psqlrc -q`, {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}
