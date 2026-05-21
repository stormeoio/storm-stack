import * as p from "@clack/prompts";
import pc from "picocolors";
import path from "path";
import { findProjectRoot, readConfig, writeConfig } from "../config";
import { resolvePlugin, PLUGINS, type PluginMeta } from "../registry";
import { removePluginRegistration, removeDrizzleSchema } from "../injector";
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
    const pm = detectPackageManager(root);

    // Remove from server entry
    const serverEntryPath = path.join(root, config.serverEntry);
    removePluginRegistration(serverEntryPath, plugin);

    // Remove from drizzle config
    const drizzlePath = path.join(root, config.drizzleConfig);
    removeDrizzleSchema(drizzlePath, plugin);

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

    spinner.stop(`${pc.green("✓")} ${pc.cyan(plugin.shortName)} retiré`);
  } catch (err) {
    spinner.stop(`${pc.red("✗")} Erreur`);
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
