import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "fs";
import path from "path";
import { findProjectRoot, readConfig, writeConfig } from "../config";
import { resolvePlugin, pluginSourceUrl, PLUGINS, type PluginMeta } from "../registry";
import { injectPluginRegistration, injectDrizzleSchema, injectClientComponents, updateProjectClaudeMd } from "../injector";
import { detectPackageManager, runInstall, fetchFile, writeFile } from "../utils";

interface AddOptions {
  copy?: boolean;
  local?: string;
  yes?: boolean;
}

export async function addCommand(pluginArg: string | undefined, opts: AddOptions): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("Aucun projet détecté. Lancez d'abord " + pc.cyan("storm init") + ".");
    process.exit(1);
  }

  let config = readConfig(root);
  if (!config) {
    p.log.warn(`Pas de ${pc.cyan("storm.json")} — création automatique.`);
    const { initCommand } = await import("./init");
    await initCommand();
    config = readConfig(root);
    if (!config) process.exit(1);
  }

  // Resolve plugin name
  let plugin: PluginMeta | undefined;

  if (pluginArg) {
    plugin = resolvePlugin(pluginArg);
  } else {
    const available = PLUGINS.filter(
      (pl) => pl.status === "available" && !config!.installed.includes(pl.id),
    );
    if (available.length === 0) {
      p.log.success("Tous les plugins disponibles sont déjà installés !");
      return;
    }

    const selected = await p.select({
      message: "Quel plugin ajouter ?",
      options: available.map((pl) => ({
        value: pl.id,
        label: pl.shortName,
        hint: pl.description,
      })),
    });

    if (p.isCancel(selected)) { p.cancel("Annulé."); return; }
    plugin = resolvePlugin(selected as string);
  }

  if (!plugin) {
    p.log.error(`Plugin "${pluginArg}" introuvable. Lancez ${pc.cyan("storm list")} pour voir les plugins disponibles.`);
    process.exit(1);
  }

  if (plugin.status === "coming-soon") {
    p.log.warn(`${pc.cyan(plugin.shortName)} n'est pas encore disponible — bientôt !`);
    return;
  }

  if (config.installed.includes(plugin.id)) {
    p.log.warn(`${pc.cyan(plugin.shortName)} est déjà installé.`);
    return;
  }

  // Check dependencies
  const missingDeps = plugin.requires.filter((dep) => !config!.installed.includes(dep));
  if (missingDeps.length > 0) {
    p.log.info(`${pc.cyan(plugin.shortName)} requiert : ${missingDeps.map((d) => pc.yellow(d.replace("@stormstack/", ""))).join(", ")}`);
    if (!opts.yes) {
      const installDeps = await p.confirm({
        message: `Installer les dépendances manquantes d'abord ?`,
        initialValue: true,
      });
      if (p.isCancel(installDeps) || !installDeps) { p.cancel("Annulé."); return; }
    }
    for (const dep of missingDeps) {
      const depPlugin = resolvePlugin(dep);
      if (depPlugin) {
        await addSinglePlugin(root, config, depPlugin, opts);
      }
    }
    config = readConfig(root)!;
  }

  await addSinglePlugin(root, config, plugin, opts);
}

async function addSinglePlugin(
  root: string,
  config: ReturnType<typeof readConfig> & {},
  plugin: PluginMeta,
  opts: AddOptions,
): Promise<void> {
  const mode = opts.copy ? "copy" : "npm";
  const pm = detectPackageManager(root);

  const spinner = p.spinner();
  spinner.start(`Installation de ${pc.cyan(plugin.shortName)}…`);

  try {
    if (mode === "copy") {
      await copyPluginSource(root, config!.pluginsDir, plugin, opts.local);
    } else {
      await installNpmPlugin(root, pm, plugin);
    }

    // Wire up server entry
    const serverEntryPath = path.join(root, config!.serverEntry);
    const injResult = injectPluginRegistration(serverEntryPath, plugin, mode, path.join(root, config!.pluginsDir));
    if (injResult.modified) {
      spinner.message(`${pc.cyan(plugin.shortName)} — wiring server entry…`);
    }

    // Wire up drizzle config
    if (plugin.files.includes("schema.ts")) {
      const drizzlePath = path.join(root, config!.drizzleConfig);
      injectDrizzleSchema(drizzlePath, plugin, mode, config!.pluginsDir);
    }

    // Wire up client components (storm-components.ts)
    if (plugin.clientComponents && plugin.clientComponents.length > 0) {
      const clientResult = injectClientComponents(root, plugin, mode, config!.pluginsDir);
      if (clientResult.modified) {
        spinner.message(`${pc.cyan(plugin.shortName)} — wiring client components…`);
      }
    }

    // Install plugin-specific npm dependencies
    const deps = Object.entries(plugin.dependencies);
    const devDeps = Object.entries(plugin.devDependencies);
    if (deps.length > 0) {
      spinner.message(`${pc.cyan(plugin.shortName)} — installing dependencies…`);
      runInstall(root, pm, deps.map(([name, ver]) => `${name}@${ver}`));
    }
    if (devDeps.length > 0) {
      runInstall(root, pm, devDeps.map(([name, ver]) => `${name}@${ver}`), true);
    }

    // Update config
    config!.installed.push(plugin.id);
    writeConfig(root, config!);

    // Update project CLAUDE.md
    const installedMetas = config!.installed.map((id) => PLUGINS.find((pl) => pl.id === id)).filter(Boolean) as PluginMeta[];
    updateProjectClaudeMd(root, installedMetas);

    spinner.stop(`${pc.green("✓")} ${pc.cyan(plugin.shortName)} installé`);

    // Show env vars to configure
    if (plugin.envVars) {
      const vars = Object.entries(plugin.envVars);
      const required = vars.filter(([, meta]) => meta.required);
      if (required.length > 0) {
        p.log.warn("Variables d'environnement requises :");
        for (const [key, meta] of required) {
          console.log(`  ${pc.yellow(key)} — ${meta.description}${meta.example ? pc.dim(` (ex: ${meta.example})`) : ""}`);
        }
      }
      const optional = vars.filter(([, meta]) => !meta.required);
      if (optional.length > 0) {
        p.log.info(pc.dim("Variables optionnelles :"));
        for (const [key, meta] of optional) {
          console.log(`  ${pc.dim(key)} — ${meta.description}`);
        }
      }
    }

    // Remind to push schema
    if (plugin.files.includes("schema.ts")) {
      p.log.info(`Lancez ${pc.cyan(`${pm === "npm" ? "npm run" : pm} db:push`)} pour appliquer le schéma.`);
    }
  } catch (err) {
    spinner.stop(`${pc.red("✗")} Erreur lors de l'installation de ${plugin.shortName}`);
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function copyPluginSource(
  root: string,
  pluginsDir: string,
  plugin: PluginMeta,
  localPath?: string,
): Promise<void> {
  const targetDir = path.join(root, pluginsDir, plugin.shortName);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const file of plugin.files) {
    let content: string;

    if (localPath) {
      const filePath = path.join(localPath, "packages", `plugin-${plugin.shortName}`, "src", file);
      content = fs.readFileSync(filePath, "utf8");
    } else {
      const url = pluginSourceUrl(plugin, file);
      content = await fetchFile(url);
    }

    // Rewrite @stormstack/<plugin> imports to relative local paths
    content = rewritePluginImports(content, plugin, pluginsDir);

    writeFile(path.join(targetDir, file), content);
  }
}

async function installNpmPlugin(
  root: string,
  pm: ReturnType<typeof detectPackageManager>,
  plugin: PluginMeta,
): Promise<void> {
  runInstall(root, pm, [`${plugin.id}@^0.1.0`]);
}

function rewritePluginImports(content: string, _plugin: PluginMeta, _pluginsDir: string): string {
  // Rewrite `@stormstack/<name>` imports to relative paths (except @stormstack/core)
  return content.replace(
    /from\s+["']@stormstack\/(?!core)([^"']+)["']/g,
    (_match, name) => `from "../${name}"`,
  );
}
