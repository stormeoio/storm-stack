import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "fs";
import path from "path";
import { findProjectRoot, readConfig, writeConfig } from "../config";
import { resolvePlugin, PLUGINS, type PluginMeta } from "../registry";
import {
  injectPluginRegistration,
  injectDrizzleSchema,
  injectClientComponents,
  injectRootComponent,
  injectStripeWebhookRawBody,
} from "../injector";
import { updateProjectClaudeMd } from "../project-claude";
import { detectPackageManager, runInstall, writeFile } from "../utils";
import { STORM_PACKAGE_RANGE } from "../version";
import {
  loadLocalPluginCopySources,
  loadRemotePluginCopySources,
  rewriteCopiedPluginImports,
} from "../copy-source-files";
import { ProjectFileTransaction } from "../project-file-transaction";

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
  const pluginsToInstall: PluginMeta[] = [];
  if (missingDeps.length > 0) {
    p.log.info(`${pc.cyan(plugin.shortName)} requiert : ${missingDeps.map((d) => pc.yellow(d.replace("@stormeoio/", ""))).join(", ")}`);
    if (!opts.yes) {
      const installDeps = await p.confirm({
        message: `Installer les dépendances manquantes d'abord ?`,
        initialValue: true,
      });
      if (p.isCancel(installDeps) || !installDeps) { p.cancel("Annulé."); return; }
    }
    for (const dep of missingDeps) {
      const depPlugin = resolvePlugin(dep);
      if (depPlugin) pluginsToInstall.push(depPlugin);
    }
  }
  pluginsToInstall.push(plugin);

  let transaction: ProjectFileTransaction | null = null;
  try {
    const copiedPluginDirectories = opts.copy
      ? pluginsToInstall.map((candidate) => path.join(root, config!.pluginsDir, candidate.shortName))
      : [];
    transaction = new ProjectFileTransaction(
      addMutationTargets(root, config!, copiedPluginDirectories),
    );

    for (const candidate of pluginsToInstall) {
      await addSinglePlugin(root, config, candidate, opts);
    }
  } catch (error) {
    let rollbackMessage = "";
    try {
      transaction?.rollback();
    } catch (rollbackError) {
      rollbackMessage = ` Rollback incomplet: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`;
    }
    const message = error instanceof Error ? error.message : String(error);
    p.log.error(`${message}${rollbackMessage}`);
    process.exit(1);
  }
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

  const serverEntryPath = path.join(root, config!.serverEntry);

  try {
    // Refuse the install before touching packages, copied sources, or storm.json
    // when the server entry cannot be wired safely.
    const injResult = injectPluginRegistration(serverEntryPath, plugin, mode, path.join(root, config!.pluginsDir));
    if (!injResult.modified) {
      throw new Error(injResult.reason ?? `Impossible d'injecter ${plugin.exportName} dans ${config!.serverEntry}`);
    }
    spinner.message(`${pc.cyan(plugin.shortName)} — wiring server entry…`);

    if (mode === "copy") {
      await copyPluginSource(root, config!.pluginsDir, plugin, opts.local);
    } else {
      await installNpmPlugin(root, pm, plugin);
    }

    if (plugin.id === "@stormeoio/stripe") {
      const rawBodyResult = injectStripeWebhookRawBody(serverEntryPath);
      if (!rawBodyResult.configured) {
        throw new Error(
          rawBodyResult.reason ?? "Impossible de préserver le body brut du webhook Stripe",
        );
      }
      if (rawBodyResult.modified) {
        spinner.message(`${pc.cyan(plugin.shortName)} — preserving webhook raw body…`);
      }
    }

    // Wire up drizzle config
    if (plugin.files.includes("schema.ts")) {
      const drizzlePath = path.join(root, config!.drizzleConfig);
      const schemaResult = injectDrizzleSchema(drizzlePath, plugin, mode, config!.pluginsDir);
      if (!schemaResult.configured) {
        throw new Error(
          schemaResult.reason ?? `Impossible d'ajouter le schéma ${plugin.shortName} à Drizzle`,
        );
      }
    }

    // Wire up client components (storm-components.ts)
    if (plugin.clientComponents && plugin.clientComponents.length > 0) {
      const clientResult = injectClientComponents(root, plugin, mode, config!.pluginsDir);
      if (!clientResult.configured) {
        throw new Error(
          clientResult.reason ?? `Impossible de câbler les composants client de ${plugin.shortName}`,
        );
      }
      if (clientResult.modified) {
        spinner.message(`${pc.cyan(plugin.shortName)} — wiring client components…`);
      }
    }

    if (plugin.rootComponent) {
      const rootResult = injectRootComponent(root, plugin, mode, config!.pluginsDir);
      if (!rootResult.configured) {
        throw new Error(
          rootResult.reason ?? `Impossible de monter le composant racine de ${plugin.shortName}`,
        );
      }
      if (rootResult.modified) {
        spinner.message(`${pc.cyan(plugin.shortName)} — montage du composant racine…`);
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
    throw err;
  }
}

export async function copyPluginSource(
  root: string,
  pluginsDir: string,
  plugin: PluginMeta,
  localPath?: string,
): Promise<void> {
  const targetDir = path.join(root, pluginsDir, plugin.shortName);
  const sources = localPath
    ? await loadLocalPluginCopySources(localPath, plugin)
    : await loadRemotePluginCopySources(plugin);

  fs.mkdirSync(targetDir, { recursive: true });
  for (const source of sources) {
    const content = rewriteCopiedPluginImports(source.content, plugin, source.file);
    writeFile(path.join(targetDir, ...source.file.split("/")), content);
  }
}

function addMutationTargets(
  root: string,
  config: ReturnType<typeof readConfig> & {},
  copiedPluginDirectories: string[],
): string[] {
  const targets = [
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    config.serverEntry,
    config.drizzleConfig,
    "client/src/storm-components.ts",
    "client/src/App.tsx",
    "storm.json",
    "CLAUDE.md",
  ].map((file) => path.join(root, file));
  targets.push(...copiedPluginDirectories);
  return targets;
}

async function installNpmPlugin(
  root: string,
  pm: ReturnType<typeof detectPackageManager>,
  plugin: PluginMeta,
): Promise<void> {
  runInstall(root, pm, [`${plugin.id}@${STORM_PACKAGE_RANGE}`]);
}
