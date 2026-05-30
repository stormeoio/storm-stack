import * as p from "@clack/prompts";
import pc from "picocolors";
import { findProjectRoot, readConfig } from "../config";
import { fetchRegistry, mergePlugins } from "../registry-client";

export async function listCommand(): Promise<void> {
  const root = findProjectRoot();
  const config = root ? readConfig(root) : null;
  const installed = new Set(config?.installed ?? []);

  // Fetch remote registry (silent fail if offline)
  const remote = await fetchRegistry();
  const allPlugins = mergePlugins(remote, installed);

  const available = allPlugins.filter((p) => p.status === "available");
  const comingSoon = allPlugins.filter((p) => p.status === "coming-soon");

  if (remote.length > 0) {
    p.log.info(pc.dim(`Registre synchronisé (${remote.length} plugins distants)`));
  }

  p.log.info(pc.bold("Plugins disponibles\n"));

  const maxName = Math.max(...available.map((pl) => pl.shortName.length));

  for (const pl of available) {
    const status = pl.installed
      ? pc.green("  ✓ installé")
      : pc.dim("  ○ disponible");
    const name = pl.shortName.padEnd(maxName + 2);
    const deps = pl.requires.length > 0
      ? pc.dim(` (requiert ${pl.requires.map((d) => d.replace("@stormstack/", "")).join(", ")})`)
      : "";
    const version = pl.version ? pc.dim(` v${pl.version}`) : "";
    const source = pl.source === "remote" ? pc.magenta(" [registre]") : "";
    console.log(`  ${pc.cyan(name)}${pl.description}${version}${source}${deps}${status}`);
  }

  if (comingSoon.length > 0) {
    console.log("");
    p.log.info(pc.bold("Bientôt disponibles\n"));
    for (const pl of comingSoon) {
      const name = pl.shortName.padEnd(maxName + 2);
      console.log(`  ${pc.dim(name)}${pc.dim(pl.description)}`);
    }
  }

  console.log("");
  if (!config) {
    p.log.warn(`Pas de ${pc.cyan("storm.json")} — lancez ${pc.cyan("storm init")} pour commencer.`);
  } else {
    p.log.info(`${pc.dim(`${installed.size} plugin(s) installé(s)`)} — ${pc.cyan("storm add <plugin>")} pour en ajouter.`);
  }
}
