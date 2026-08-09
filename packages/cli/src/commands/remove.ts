import * as p from "@clack/prompts";
import pc from "picocolors";
import path from "path";
import fs from "fs";
import { findProjectRoot, readConfig, writeConfig } from "../config";
import { resolvePlugin, PLUGINS, type PluginMeta } from "../registry";
import {
  removePluginRegistration,
  removeDrizzleSchema,
  removeClientComponents,
  removeRootComponent,
  removeStripeWebhookRawBody,
  updateProjectClaudeMd,
} from "../injector";
import { detectPackageManager, runUninstall, removeDir } from "../utils";

export async function removeCommand(pluginArg: string | undefined): Promise<void> {
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

  let plugin: PluginMeta | undefined;

  if (pluginArg) {
    plugin = resolvePlugin(pluginArg);
  } else {
    const selected = await p.select({
      message: "Quel plugin retirer ?",
      options: config.installed.map((id) => {
        const meta = PLUGINS.find((pl) => pl.id === id);
        return { value: id, label: meta?.shortName ?? id, hint: meta?.description };
      }),
    });
    if (p.isCancel(selected)) { p.cancel("Annulé."); return; }
    plugin = resolvePlugin(selected as string);
  }

  if (!plugin) {
    p.log.error(`Plugin "${pluginArg}" introuvable.`);
    process.exit(1);
  }

  if (!config.installed.includes(plugin.id)) {
    p.log.warn(`${pc.cyan(plugin.shortName)} n'est pas installé.`);
    return;
  }

  // Check if other installed plugins depend on this one
  const dependents = config.installed.filter((id) => {
    const meta = PLUGINS.find((pl) => pl.id === id);
    return meta?.requires.includes(plugin!.id);
  });

  if (dependents.length > 0) {
    const names = dependents.map((d) => pc.yellow(d.replace("@stormstack/", ""))).join(", ");
    p.log.error(`Impossible de retirer ${pc.cyan(plugin.shortName)} — requis par : ${names}`);
    p.log.info("Retirez d'abord les plugins dépendants.");
    process.exit(1);
  }

  const confirm = await p.confirm({
    message: `Retirer ${pc.cyan(plugin.shortName)} ? Les fichiers source seront supprimés.`,
    initialValue: false,
  });
  if (p.isCancel(confirm) || !confirm) { p.cancel("Annulé."); return; }

  const spinner = p.spinner();
  spinner.start(`Suppression de ${pc.cyan(plugin.shortName)}…`);

  try {
    const rootResult = removeRootComponent(root, plugin);
    if (rootResult.blocked) {
      throw new Error(`${rootResult.reason}. Réparez les marqueurs dans client/src/App.tsx avant de réessayer.`);
    }

    // Run onUninstall lifecycle hook if the plugin exports one
    await runUninstallHook(root, plugin);

    const pm = detectPackageManager(root);

    // Remove from server entry
    const serverEntryPath = path.join(root, config.serverEntry);
    removePluginRegistration(serverEntryPath, plugin);
    if (plugin.id === "@stormstack/stripe") {
      const rawBodyResult = removeStripeWebhookRawBody(serverEntryPath);
      if (rawBodyResult.modified) {
        spinner.message(`${pc.cyan(plugin.shortName)} — restauration du parser JSON…`);
      }
    }

    // Remove from drizzle config
    const drizzlePath = path.join(root, config.drizzleConfig);
    removeDrizzleSchema(drizzlePath, plugin);

    // Remove from client storm-components.ts
    removeClientComponents(root, plugin);

    // Remove local plugin files if they exist
    const localDir = path.join(root, config.pluginsDir, plugin.shortName);
    removeDir(localDir);

    // Uninstall npm package
    try {
      runUninstall(root, pm, [plugin.id]);
    } catch {
      // Package might not be installed as npm dep (copy mode)
    }

    // Uninstall plugin-specific deps (only if no other plugin uses them)
    const otherDeps = new Set<string>();
    for (const id of config.installed) {
      if (id === plugin.id) continue;
      const meta = PLUGINS.find((pl) => pl.id === id);
      if (meta) {
        for (const dep of Object.keys(meta.dependencies)) otherDeps.add(dep);
      }
    }
    const exclusiveDeps = Object.keys(plugin.dependencies).filter((d) => !otherDeps.has(d));
    const exclusiveDevDeps = Object.keys(plugin.devDependencies).filter((d) => !otherDeps.has(d));
    if (exclusiveDeps.length > 0 || exclusiveDevDeps.length > 0) {
      try {
        runUninstall(root, pm, [...exclusiveDeps, ...exclusiveDevDeps]);
      } catch {
        // ignore
      }
    }

    // Update config
    config.installed = config.installed.filter((id) => id !== plugin!.id);
    writeConfig(root, config);

    // Update project CLAUDE.md
    const installedMetas = config.installed.map((id) => PLUGINS.find((pl) => pl.id === id)).filter(Boolean) as PluginMeta[];
    updateProjectClaudeMd(root, installedMetas);

    // Remove from lifecycle state
    removeFromLifecycleState(root, plugin.id);

    spinner.stop(`${pc.green("✓")} ${pc.cyan(plugin.shortName)} retiré`);
  } catch (err) {
    spinner.stop(`${pc.red("✗")} Erreur`);
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function runUninstallHook(root: string, plugin: PluginMeta): Promise<void> {
  const localEntry = path.join(root, "plugins", plugin.shortName, "server", "index.ts");
  const localEntryJs = path.join(root, "plugins", plugin.shortName, "server", "index.js");
  let entryPath: string | undefined;

  if (fs.existsSync(localEntry)) entryPath = localEntry;
  else if (fs.existsSync(localEntryJs)) entryPath = localEntryJs;

  if (!entryPath) {
    try {
      const resolved = require.resolve(plugin.id);
      if (resolved) entryPath = resolved;
    } catch {
      // npm package not installed — nothing to call
    }
  }

  if (!entryPath) return;

  try {
    const mod = await import(entryPath);
    const pluginDef = mod.default ?? mod[plugin.shortName + "Plugin"];
    if (pluginDef?.lifecycle?.onUninstall) {
      const minimalCtx = { db: null, env: process.env, logger: console, events: null };
      await pluginDef.lifecycle.onUninstall(minimalCtx);
      p.log.info(`${pc.dim("↪")} Hook onUninstall exécuté`);
    }
  } catch (err) {
    p.log.warn(`Hook onUninstall a échoué : ${err instanceof Error ? err.message : String(err)}`);
  }
}

function removeFromLifecycleState(root: string, pluginId: string): void {
  const lifecyclePath = path.join(root, "storm-lifecycle.json");
  if (!fs.existsSync(lifecyclePath)) return;
  try {
    const state = JSON.parse(fs.readFileSync(lifecyclePath, "utf8"));
    state.installed = (state.installed ?? []).filter((id: string) => id !== pluginId);
    fs.writeFileSync(lifecyclePath, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // best-effort
  }
}
