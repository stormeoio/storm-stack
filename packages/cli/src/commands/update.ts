import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "fs";
import path from "path";
import { findProjectRoot, readConfig } from "../config";
import { resolvePlugin, pluginSourceUrl, type PluginMeta } from "../registry";
import { detectPackageManager, runInstall, fetchFile, writeFile } from "../utils";

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
}

export async function updateCommand(
  pluginArg: string | undefined,
  opts: UpdateOptions = {},
): Promise<void> {
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
    return;
  }

  const pluginsToCheck = pluginArg
    ? [pluginArg]
    : opts.all
      ? config.installed
      : config.installed;

  const spinner = p.spinner();
  spinner.start("Vérification des mises à jour…");

  const candidates: UpdateCandidate[] = [];

  for (const idOrName of pluginsToCheck) {
    const plugin = resolvePlugin(idOrName);
    if (!plugin) continue;
    if (!config.installed.includes(plugin.id)) continue;

    const mode = detectPluginMode(root, config.pluginsDir, plugin);
    const currentVersion = detectCurrentVersion(root, config.pluginsDir, plugin, mode);
    const latestVersion = plugin.status === "available" ? resolveLatestVersion(plugin) : currentVersion;

    if (mode === "copy") {
      const changedFiles = await detectCopyChanges(root, config.pluginsDir, plugin);
      if (changedFiles.length > 0 || currentVersion !== latestVersion) {
        candidates.push({ plugin, currentVersion, latestVersion, mode, changedFiles });
      }
    } else {
      if (currentVersion !== latestVersion) {
        candidates.push({ plugin, currentVersion, latestVersion, mode, changedFiles: [] });
      }
    }
  }

  spinner.stop(
    candidates.length > 0
      ? `${pc.cyan(String(candidates.length))} mise(s) à jour disponible(s)`
      : `${pc.green("✓")} Tous les plugins sont à jour`,
  );

  if (candidates.length === 0) return;

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
    p.log.info(`  ${pc.cyan(c.plugin.shortName)} ${versionStr} ${modeStr}${fileStr}`);
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
    return;
  }

  // Confirm
  if (!opts.yes) {
    const confirmed = await p.confirm({
      message: `Mettre à jour ${candidates.length} plugin(s) ?`,
      initialValue: true,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Annulé.");
      return;
    }
  }

  // Apply updates
  const pm = detectPackageManager(root);

  for (const candidate of candidates) {
    const updateSpinner = p.spinner();
    updateSpinner.start(`Mise à jour de ${pc.cyan(candidate.plugin.shortName)}…`);

    try {
      if (candidate.mode === "npm") {
        runInstall(root, pm, [`${candidate.plugin.id}@^${candidate.latestVersion}`]);
      } else {
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
    } catch (err) {
      updateSpinner.stop(`${pc.red("✗")} ${candidate.plugin.shortName}`);
      p.log.error(err instanceof Error ? err.message : String(err));
    }
  }

  // Post-update summary
  const schemaUpdates = candidates.filter(
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

  p.log.info(`${pc.green("✓")} ${candidates.length} plugin(s) mis à jour`);
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

  // Copy mode — check if plugin's index has a version comment or read from plugin definition
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

function resolveLatestVersion(plugin: PluginMeta): string {
  // In monorepo context, latest is what the registry knows
  // In a real marketplace this would be an HTTP call
  return "0.1.0";
}

async function detectCopyChanges(
  root: string,
  pluginsDir: string,
  plugin: PluginMeta,
): Promise<string[]> {
  const changed: string[] = [];
  const localDir = path.join(root, pluginsDir, plugin.shortName);

  if (!fs.existsSync(localDir)) return [];

  for (const file of plugin.files) {
    const localPath = path.join(localDir, file);
    if (!fs.existsSync(localPath)) {
      changed.push(file);
      continue;
    }

    const localContent = fs.readFileSync(localPath, "utf8");
    const localHash = simpleHash(localContent);

    // Try to get upstream content for comparison
    try {
      const upstreamContent = await fetchFile(pluginSourceUrl(plugin, file));
      const upstreamHash = simpleHash(upstreamContent);
      if (localHash !== upstreamHash) {
        changed.push(file);
      }
    } catch {
      // Can't fetch upstream — skip this file
    }
  }

  return changed;
}

async function updateCopyPlugin(
  root: string,
  pluginsDir: string,
  candidate: UpdateCandidate,
): Promise<void> {
  const targetDir = path.join(root, pluginsDir, candidate.plugin.shortName);

  // Create backup
  const backupDir = path.join(root, pluginsDir, `.${candidate.plugin.shortName}.backup`);
  if (fs.existsSync(targetDir)) {
    fs.cpSync(targetDir, backupDir, { recursive: true });
  }

  try {
    for (const file of candidate.changedFiles) {
      const url = pluginSourceUrl(candidate.plugin, file);
      const content = await fetchFile(url);
      const rewritten = rewritePluginImports(content);
      writeFile(path.join(targetDir, file), rewritten);
    }

    // Clean up backup on success
    fs.rmSync(backupDir, { recursive: true, force: true });
  } catch (err) {
    // Restore from backup
    if (fs.existsSync(backupDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.renameSync(backupDir, targetDir);
    }
    throw err;
  }
}

function rewritePluginImports(content: string): string {
  return content.replace(
    /from\s+["']@stormstack\/(?!core)([^"']+)["']/g,
    (_match, name) => `from "../${name}"`,
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
