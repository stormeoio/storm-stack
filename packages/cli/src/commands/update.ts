import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "fs";
import path from "path";
import { findProjectRoot, readConfig } from "../config";
import { resolvePlugin, type PluginMeta } from "../registry";
import { detectPackageManager, runInstall, writeFile } from "../utils";
import { VERSION } from "../version";
import {
  loadRemotePluginCopySources,
  rewriteCopiedPluginImports,
} from "../copy-source-files";
import {
  ensureDatabaseAdminGuardWiring,
  hasBootstrapAdminGuard,
} from "../injector";

interface UpdateOptions {
  yes?: boolean;
  dryRun?: boolean;
  all?: boolean;
}

interface UpdateCandidate {
  plugin: PluginMeta;
  currentVersion: string;
  latestVersion: string;
  mode: "npm" | "copy";
  changedFiles: string[];
  needsAdminGuardMigration: boolean;
  copySnapshot?: Map<string, string>;
}

interface CopyDetectionResult {
  changedFiles: string[];
  upstreamFiles: Map<string, string>;
}

export interface UpdateFailure {
  pluginId: string;
  message: string;
}

export type UpdateCommandResult =
  | {
      status: "success";
      updatedPluginIds: string[];
      failures: [];
    }
  | {
      status: "failed";
      updatedPluginIds: string[];
      failures: UpdateFailure[];
    };

export async function updateCommand(
  pluginArg: string | undefined,
  opts: UpdateOptions = {},
): Promise<UpdateCommandResult> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("Aucun projet détecté.");
    process.exit(1);
  }

  const config = readConfig(root);
  if (!config) {
    p.log.error(`Pas de ${pc.cyan("storm.json")} — lancez ${pc.cyan("storm init")} d'abord.`);
    process.exit(1);
  }

  if (config.installed.length === 0) {
    p.log.info("Aucun plugin installé.");
    return successfulResult();
  }

  const pluginsToCheck = pluginArg
    ? [pluginArg]
    : opts.all
      ? config.installed
      : config.installed;

  const spinner = p.spinner();
  spinner.start("Vérification des mises à jour…");

  const candidates: UpdateCandidate[] = [];
  const detectionFailures: UpdateFailure[] = [];

  for (const idOrName of pluginsToCheck) {
    const plugin = resolvePlugin(idOrName);
    if (!plugin) continue;
    if (!config.installed.includes(plugin.id)) continue;

    const backupDir = copyRecoveryBackupDirectory(root, config.pluginsDir, plugin);
    try {
      if (pathEntryExists(backupDir)) {
        throw copyRecoveryBackupExistsError(plugin, backupDir);
      }
    } catch (error) {
      detectionFailures.push({
        pluginId: plugin.id,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const mode = detectPluginMode(root, config.pluginsDir, plugin);
    const currentVersion = detectCurrentVersion(root, config.pluginsDir, plugin, mode);
    const latestVersion = plugin.status === "available" ? resolveLatestVersion(plugin) : currentVersion;
    const needsAdminGuardMigration = plugin.id === "@stormstack/auth"
      && !hasBootstrapAdminGuard(path.join(root, config.serverEntry));

    if (mode === "copy") {
      let detection: CopyDetectionResult;
      try {
        detection = await detectCopyChanges(root, config.pluginsDir, plugin);
      } catch (error) {
        detectionFailures.push({
          pluginId: plugin.id,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const { changedFiles, upstreamFiles } = detection;
      if (changedFiles.length > 0 || currentVersion !== latestVersion || needsAdminGuardMigration) {
        candidates.push({
          plugin,
          currentVersion,
          latestVersion,
          mode,
          changedFiles,
          needsAdminGuardMigration,
          copySnapshot: upstreamFiles,
        });
      }
    } else {
      if (currentVersion !== latestVersion || needsAdminGuardMigration) {
        candidates.push({
          plugin,
          currentVersion,
          latestVersion,
          mode,
          changedFiles: [],
          needsAdminGuardMigration,
        });
      }
    }
  }

  if (detectionFailures.length > 0) {
    spinner.stop(`${pc.red("✗")} Vérification des copies impossible`);
    for (const failure of detectionFailures) {
      p.log.error(failure.message);
    }
    p.log.warn(
      `${pc.red("✗")} ${detectionFailures.length} plugin(s) non vérifié(s) — aucune mise à jour appliquée`,
    );
    return {
      status: "failed",
      updatedPluginIds: [],
      failures: detectionFailures,
    };
  }

  spinner.stop(
    candidates.length > 0
      ? `${pc.cyan(String(candidates.length))} mise(s) à jour disponible(s)`
      : `${pc.green("✓")} Tous les plugins sont à jour`,
  );

  if (candidates.length === 0) return successfulResult();

  // Display update table
  p.log.info("");
  p.log.info(pc.bold("Mises à jour disponibles :"));
  for (const c of candidates) {
    const versionStr = c.currentVersion === c.latestVersion
      ? pc.dim(c.currentVersion)
      : `${pc.red(c.currentVersion)} → ${pc.green(c.latestVersion)}`;
    const fileStr = c.changedFiles.length > 0
      ? pc.dim(` (${c.changedFiles.length} fichier(s) modifié(s))`)
      : "";
    const modeStr = pc.dim(`[${c.mode}]`);
    const guardStr = c.needsAdminGuardMigration
      ? pc.dim(" (migration requireAdmin)")
      : "";
    p.log.info(`  ${pc.cyan(c.plugin.shortName)} ${versionStr} ${modeStr}${fileStr}${guardStr}`);
  }

  if (opts.dryRun) {
    p.log.info("");
    p.log.info(pc.dim("(dry-run — aucune modification appliquée)"));

    for (const c of candidates) {
      if (c.changedFiles.length > 0) {
        p.log.info("");
        p.log.info(`${pc.bold(c.plugin.shortName)} — fichiers modifiés :`);
        for (const f of c.changedFiles) {
          p.log.info(`  ${pc.dim("•")} ${f}`);
        }
      }
    }
    return successfulResult();
  }

  // Confirm
  if (!opts.yes) {
    const confirmed = await p.confirm({
      message: `Mettre à jour ${candidates.length} plugin(s) ?`,
      initialValue: true,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Annulé.");
      return successfulResult();
    }
  }

  // Apply updates
  const pm = detectPackageManager(root);
  const successfulUpdates: UpdateCandidate[] = [];
  const failures: UpdateFailure[] = [];

  for (const candidate of candidates) {
    const updateSpinner = p.spinner();
    updateSpinner.start(`Mise à jour de ${pc.cyan(candidate.plugin.shortName)}…`);
    const serverEntryPath = path.join(root, config.serverEntry);
    const originalServerEntry = candidate.needsAdminGuardMigration && fs.existsSync(serverEntryPath)
      ? fs.readFileSync(serverEntryPath, "utf8")
      : null;
    let serverEntryModified = false;

    try {
      if (candidate.needsAdminGuardMigration) {
        const guardResult = ensureDatabaseAdminGuardWiring(serverEntryPath);
        if (!guardResult.configured) {
          throw new Error(
            guardResult.reason ?? "Impossible de migrer requireAdmin vers le garde base de données",
          );
        }
        serverEntryModified = guardResult.modified;
        if (serverEntryModified) {
          updateSpinner.message(`${pc.cyan(candidate.plugin.shortName)} — migration requireAdmin…`);
        }
      }

      if (candidate.mode === "npm") {
        if (candidate.currentVersion !== candidate.latestVersion) {
          runInstall(root, pm, [`${candidate.plugin.id}@^${candidate.latestVersion}`]);
        }
      } else if (candidate.changedFiles.length > 0) {
        await updateCopyPlugin(root, config.pluginsDir, candidate);
      }

      // Check if migration generation is needed
      if (candidate.plugin.files.includes("schema.ts")) {
        const schemaChanged = candidate.changedFiles.includes("schema.ts");
        if (schemaChanged) {
          updateSpinner.message(`${pc.cyan(candidate.plugin.shortName)} — schéma modifié, migration recommandée`);
        }
      }

      updateSpinner.stop(`${pc.green("✓")} ${pc.cyan(candidate.plugin.shortName)} mis à jour`);
      successfulUpdates.push(candidate);
    } catch (err) {
      if (serverEntryModified && originalServerEntry !== null) {
        fs.writeFileSync(serverEntryPath, originalServerEntry, "utf8");
      }
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ pluginId: candidate.plugin.id, message });
      updateSpinner.stop(`${pc.red("✗")} ${candidate.plugin.shortName}`);
      p.log.error(message);
    }
  }

  // Post-update summary
  const schemaUpdates = successfulUpdates.filter(
    (c) => c.changedFiles.includes("schema.ts"),
  );

  p.log.info("");
  if (schemaUpdates.length > 0) {
    p.log.warn(pc.bold("Action requise — migrations :"));
    p.log.info(
      `  ${pc.cyan("storm migrate generate")} — générer les migrations pour : ${schemaUpdates.map((c) => pc.cyan(c.plugin.shortName)).join(", ")}`,
    );
    p.log.info(`  ${pc.cyan("storm migrate run")}      — appliquer les migrations`);
    p.log.info("");
  }

  if (successfulUpdates.length > 0) {
    p.log.info(`${pc.green("✓")} ${successfulUpdates.length} plugin(s) mis à jour`);
  }
  if (failures.length > 0) {
    p.log.warn(
      `${pc.red("✗")} ${failures.length} plugin(s) non mis à jour — la commande se termine en échec`,
    );
    return {
      status: "failed",
      updatedPluginIds: successfulUpdates.map((candidate) => candidate.plugin.id),
      failures,
    };
  }

  return successfulResult(successfulUpdates.map((candidate) => candidate.plugin.id));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function detectPluginMode(
  root: string,
  pluginsDir: string,
  plugin: PluginMeta,
): "npm" | "copy" {
  const localDir = path.join(root, pluginsDir, plugin.shortName);
  return fs.existsSync(localDir) ? "copy" : "npm";
}

function detectCurrentVersion(
  root: string,
  pluginsDir: string,
  plugin: PluginMeta,
  mode: "npm" | "copy",
): string {
  if (mode === "npm") {
    try {
      const pkgPath = path.join(root, "node_modules", ...plugin.id.split("/"), "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      return pkg.version;
    } catch {
      return "0.0.0";
    }
  }

  // Copy mode — generated sources expose the package version in version.ts.
  try {
    const versionPath = path.join(root, pluginsDir, plugin.shortName, "version.ts");
    const content = fs.readFileSync(versionPath, "utf8");
    const match = content.match(/\bPACKAGE_VERSION\s*=\s*["']([^"']+)["']/);
    if (match) return match[1]!;
  } catch {
    // Legacy copies did not include version.ts; fall back to their inline version.
  }

  // Legacy copy mode — the plugin definition contained an inline version.
  try {
    const indexPath = path.join(root, pluginsDir, plugin.shortName, "index.ts");
    const content = fs.readFileSync(indexPath, "utf8");
    const match = content.match(/version:\s*["']([^"']+)["']/);
    if (match) return match[1]!;
  } catch {
    // ignore
  }

  return "0.0.0";
}

export function resolveLatestVersion(_plugin: PluginMeta): string {
  // In monorepo context, latest is what the registry knows
  // In a real marketplace this would be an HTTP call
  return VERSION;
}

async function detectCopyChanges(
  root: string,
  pluginsDir: string,
  plugin: PluginMeta,
): Promise<CopyDetectionResult> {
  const changed = new Set<string>();
  const upstreamFiles = new Map<string, string>();
  const localDir = path.join(root, pluginsDir, plugin.shortName);

  if (!fs.existsSync(localDir)) return { changedFiles: [], upstreamFiles };

  let remoteSources: Awaited<ReturnType<typeof loadRemotePluginCopySources>>;
  try {
    remoteSources = await loadRemotePluginCopySources(plugin);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Impossible de vérifier la copie ${plugin.shortName} : ${detail}`);
  }

  for (const { file, content } of remoteSources) {
    const localPath = path.join(localDir, file);
    const copiedContent = rewriteCopiedPluginImports(content, plugin, file);
    upstreamFiles.set(file, copiedContent);

    if (!fs.existsSync(localPath)) {
      changed.add(file);
      continue;
    }

    const localContent = fs.readFileSync(localPath, "utf8");
    if (simpleHash(localContent) !== simpleHash(copiedContent)) {
      changed.add(file);
    }
  }

  if (plugin.id === "@stormstack/auth") {
    for (const file of missingDatabaseGuardCopyFiles(localDir)) {
      changed.add(file);
    }
  }

  return {
    changedFiles: remoteSources.map(({ file }) => file).filter((file) => changed.has(file)),
    upstreamFiles,
  };
}

function missingDatabaseGuardCopyFiles(localDir: string): string[] {
  const requiredMarkers = new Map<string, RegExp>([
    [
      "index.ts",
      /export\s*\{[^}]*\bcreateDatabaseRoleGuard\b[^}]*\}\s*from\s*["']\.\/middleware["']/s,
    ],
    ["middleware.ts", /export\s+function\s+createDatabaseRoleGuard\s*\(/],
  ]);

  return [...requiredMarkers].flatMap(([file, marker]) => {
    const localPath = path.join(localDir, file);
    if (!fs.existsSync(localPath)) return [file];
    return marker.test(fs.readFileSync(localPath, "utf8")) ? [] : [file];
  });
}

async function updateCopyPlugin(
  root: string,
  pluginsDir: string,
  candidate: UpdateCandidate,
): Promise<void> {
  const targetDir = path.join(root, pluginsDir, candidate.plugin.shortName);
  const backupDir = copyRecoveryBackupDirectory(root, pluginsDir, candidate.plugin);
  let backupCreated = false;

  // Reserve the recovery path atomically. This prevents a backup left by an
  // interrupted update from ever being merged into or silently removed.
  if (fs.existsSync(targetDir)) {
    const targetMode = fs.statSync(targetDir).mode;
    try {
      fs.mkdirSync(backupDir, { mode: targetMode });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw copyRecoveryBackupExistsError(candidate.plugin, backupDir);
      }
      throw error;
    }

    try {
      fs.cpSync(targetDir, backupDir, { recursive: true });
      fs.chmodSync(backupDir, targetMode);
      backupCreated = true;
    } catch (error) {
      fs.rmSync(backupDir, { recursive: true, force: true });
      throw error;
    }
  }

  try {
    for (const file of candidate.changedFiles) {
      const content = candidate.copySnapshot?.get(file);
      if (content === undefined) {
        throw new Error(
          `Snapshot amont incomplet pour ${candidate.plugin.shortName}/${file}`,
        );
      }
      writeFile(path.join(targetDir, file), content);
    }

    if (candidate.plugin.id === "@stormstack/auth") {
      const missingGuardFiles = missingDatabaseGuardCopyFiles(targetDir);
      if (missingGuardFiles.length > 0) {
        throw new Error(
          `La mise à jour auth copy n'expose pas createDatabaseRoleGuard dans : ${missingGuardFiles.join(", ")}`,
        );
      }
    }

    // Clean up backup on success
    if (backupCreated) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  } catch (err) {
    // Restore from backup
    if (backupCreated && pathEntryExists(backupDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.renameSync(backupDir, targetDir);
    }
    throw err;
  }
}

function copyRecoveryBackupDirectory(
  root: string,
  pluginsDir: string,
  plugin: PluginMeta,
): string {
  return path.join(root, pluginsDir, `.${plugin.shortName}.backup`);
}

function pathEntryExists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function copyRecoveryBackupExistsError(plugin: PluginMeta, backupDir: string): Error {
  return new Error(
    `Backup de récupération existant pour ${plugin.shortName}: ${backupDir}. `
      + "Restaurez-le ou déplacez-le manuellement avant de relancer; aucun fichier n'a été modifié.",
  );
}

function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

function successfulResult(updatedPluginIds: string[] = []): UpdateCommandResult {
  return { status: "success", updatedPluginIds, failures: [] };
}
