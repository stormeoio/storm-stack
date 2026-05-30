import * as p from "@clack/prompts";
import pc from "picocolors";
import { findProjectRoot, readConfig } from "../config";
import { fetchRegistry, mergePlugins, searchPlugins } from "../registry-client";

export async function searchCommand(query?: string): Promise<void> {
  if (!query) {
    p.log.error("Usage : storm search <query>");
    p.log.info(`  Exemple : ${pc.cyan("storm search auth")} ou ${pc.cyan("storm search payments")}`);
    return;
  }

  const root = findProjectRoot();
  const config = root ? readConfig(root) : null;
  const installed = new Set(config?.installed ?? []);

  // Fetch remote registry (degrades gracefully if offline)
  const spinner = p.spinner();
  spinner.start("Recherche dans le registre...");

  const remote = await fetchRegistry();
  const allPlugins = mergePlugins(remote, installed);
  const results = searchPlugins(query, allPlugins);

  spinner.stop(
    remote.length > 0
      ? `${allPlugins.length} plugins indexés (local + registre)`
      : `${allPlugins.length} plugins indexés (local uniquement, registre indisponible)`,
  );

  if (results.length === 0) {
    p.log.warn(`Aucun plugin trouvé pour ${pc.cyan(`"${query}"`)}`);
    p.log.info(`Essayez : ${pc.dim("storm search crm")}, ${pc.dim("storm search payments")}, ${pc.dim("storm list")}`);
    return;
  }

  p.log.info(pc.bold(`${results.length} résultat(s) pour "${query}"\n`));

  const maxName = Math.max(...results.map((r) => r.shortName.length));

  for (const plugin of results) {
    const name = plugin.shortName.padEnd(maxName + 2);

    // Status indicator
    let status: string;
    if (plugin.installed) {
      status = pc.green("  ✓ installé");
    } else if (plugin.status === "available") {
      status = pc.dim("  ○ disponible");
    } else {
      status = pc.dim("  ◌ bientôt");
    }

    // Source badge
    const sourceBadge = plugin.source === "remote" ? pc.magenta(" [registre]") : "";

    // Version
    const version = plugin.version ? pc.dim(` v${plugin.version}`) : "";

    // Tags (show first 3)
    const tags = plugin.tags.length > 0
      ? pc.dim(`  [${plugin.tags.slice(0, 3).join(", ")}]`)
      : "";

    // Dependencies
    const deps = plugin.requires.length > 0
      ? pc.dim(` (requiert ${plugin.requires.map((d) => d.replace("@stormstack/", "")).join(", ")})`)
      : "";

    console.log(`  ${pc.cyan(name)}${plugin.description}${version}${sourceBadge}${deps}${status}`);
    if (tags) console.log(`  ${"".padEnd(maxName + 2)}${tags}`);
  }

  console.log("");
  if (!config) {
    p.log.warn(`Pas de ${pc.cyan("storm.json")} — lancez ${pc.cyan("storm init")} pour commencer.`);
  } else {
    p.log.info(`${pc.cyan("storm add <plugin>")} pour installer un plugin.`);
  }
}
