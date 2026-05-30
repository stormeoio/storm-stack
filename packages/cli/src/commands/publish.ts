import fs from "fs";
import path from "path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { findProjectRoot, readConfig } from "../config";
import { resolvePlugin, type PluginMeta } from "../registry";
import { generateRegistryEntry } from "../registry-client";

interface PublishOptions {
  /** Skip interactive prompts */
  yes?: boolean;
  /** Dry-run: show entry without writing */
  dryRun?: boolean;
}

interface PackageJsonMeta {
  name?: string;
  version?: string;
  author?: string | { name?: string };
}

interface RegistryJsonFile {
  version?: number;
  updatedAt?: string;
  plugins?: unknown[];
}

export async function publishCommand(pluginArg?: string, opts: PublishOptions = {}): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("Impossible de trouver la racine du projet. Lancez cette commande depuis un projet Storm Stack.");
    return;
  }

  const config = readConfig(root);
  if (!config) {
    p.log.error(`Pas de ${pc.cyan("storm.json")} — lancez ${pc.cyan("storm init")} d'abord.`);
    return;
  }

  // ── Resolve plugin ────────────────────────────────────────────────────────

  let plugin: PluginMeta | undefined;

  if (pluginArg) {
    plugin = resolvePlugin(pluginArg);
    if (!plugin) {
      p.log.error(`Plugin ${pc.red(pluginArg)} introuvable dans le registre local.`);
      return;
    }
  } else {
    // Try to detect from current directory (if inside a plugin package)
    const currentPkg = tryReadPackageJson(process.cwd());
    if (currentPkg?.name) {
      plugin = resolvePlugin(currentPkg.name);
    }
    if (!plugin) {
      p.log.error("Spécifiez un plugin : " + pc.cyan("storm publish <plugin>"));
      return;
    }
  }

  // ── Gather metadata ───────────────────────────────────────────────────────

  const pkgJsonPath = path.join(root, "node_modules", plugin.id, "package.json");
  const localPkgPath = path.join(root, config.pluginsDir, plugin.shortName, "package.json");
  const monoPkgPath = findMonorepoPluginPackage(plugin.shortName);

  let version = "0.1.0";
  let author = "stormeo";

  // Try to read version from available package.json locations
  for (const p of [monoPkgPath, pkgJsonPath, localPkgPath]) {
    if (p) {
      const pkg = tryReadPackageJson(p);
      if (pkg?.version) version = pkg.version;
      if (pkg?.author) author = typeof pkg.author === "string" ? pkg.author : pkg.author.name ?? author;
    }
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

  let tags: string[] = [plugin.shortName];

  if (!opts.yes) {
    const tagsInput = await p.text({
      message: "Tags (séparés par des virgules)",
      placeholder: tags.join(", "),
      defaultValue: tags.join(", "),
    });

    if (p.isCancel(tagsInput)) {
      p.cancel("Publication annulée.");
      return;
    }

    tags = (tagsInput as string).split(",").map((t) => t.trim()).filter(Boolean);
  }

  // ── Generate entry ────────────────────────────────────────────────────────

  const entry = generateRegistryEntry(plugin, version, author, tags);
  const entryJson = JSON.stringify(entry, null, 2);

  p.log.info(pc.bold("Entrée de registre générée :\n"));
  console.log(pc.dim(entryJson));
  console.log("");

  if (opts.dryRun) {
    p.log.info(pc.dim("Mode dry-run — aucune modification."));
    return;
  }

  // ── Write to registry.json ────────────────────────────────────────────────

  const registryPath = findRegistryJson(root);

  if (!registryPath) {
    p.log.warn(
      `Aucun ${pc.cyan("registry.json")} trouvé. Copiez l'entrée ci-dessus manuellement dans votre registre.`,
    );
    return;
  }

  if (!opts.yes) {
    const confirm = await p.confirm({
      message: `Ajouter ${pc.cyan(plugin.name)} au registre ${pc.dim(path.relative(root, registryPath))} ?`,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Publication annulée.");
      return;
    }
  }

  try {
    const raw = JSON.parse(fs.readFileSync(registryPath, "utf8")) as RegistryJsonFile;
    const plugins: unknown[] = raw.plugins ?? [];

    // Replace if already exists, otherwise append
    const existingIdx = plugins.findIndex((item): item is { id: string } =>
      typeof item === "object" && item !== null && "id" in item && item.id === entry.id,
    );
    if (existingIdx >= 0) {
      plugins[existingIdx] = entry;
      p.log.info(`${pc.cyan(entry.id)} mis à jour dans le registre.`);
    } else {
      plugins.push(entry);
      p.log.info(`${pc.cyan(entry.id)} ajouté au registre.`);
    }

    raw.plugins = plugins;
    raw.updatedAt = new Date().toISOString();
    fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2) + "\n", "utf8");

    p.log.success(
      `Registre mis à jour. ${pc.dim("Commitez et pushez pour publier.")}`,
    );
  } catch (err) {
    p.log.error(`Erreur lors de l'écriture du registre : ${err}`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function tryReadPackageJson(dirOrFile: string): PackageJsonMeta | null {
  try {
    const file = dirOrFile.endsWith("package.json") ? dirOrFile : path.join(dirOrFile, "package.json");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function findMonorepoPluginPackage(shortName: string): string | null {
  // Walk up looking for a monorepo structure
  const root = findProjectRoot();
  if (!root) return null;
  const candidate = path.join(root, "packages", `plugin-${shortName}`, "package.json");
  return fs.existsSync(candidate) ? path.dirname(candidate) : null;
}

function findRegistryJson(from: string): string | null {
  // Check project root, then parent (monorepo root)
  const candidates = [
    path.join(from, "registry.json"),
    path.join(from, "..", "registry.json"),
    path.join(from, "../..", "registry.json"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.resolve(c);
  }
  return null;
}
