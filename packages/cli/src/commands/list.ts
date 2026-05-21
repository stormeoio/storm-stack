import * as p from "@clack/prompts";
import pc from "picocolors";
import { findProjectRoot, readConfig } from "../config";
import { PLUGINS } from "../registry";

export async function listCommand(): Promise<void> {
  const root = findProjectRoot();
  const config = root ? readConfig(root) : null;
  const installed = new Set(config?.installed ?? []);

  const available = PLUGINS.filter((pl) => pl.status === "available");
  const comingSoon = PLUGINS.filter((pl) => pl.status === "coming-soon");

  p.log.info(pc.bold("Plugins disponibles\n"));

  const maxName = Math.max(...available.map((pl) => pl.shortName.length));

  for (const pl of available) {
    const status = installed.has(pl.id)
      ? pc.green("  ✓ installé")
      : pc.dim("  ○ disponible");
    const name = pl.shortName.padEnd(maxName + 2);
    const deps = pl.requires.length > 0
      ? pc.dim(` (requiert ${pl.requires.map((d) => d.replace("@stormstack/", "")).join(", ")})`)
      : "";
    console.log(`  ${pc.cyan(name)}${pl.description}${deps}${status}`);
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
