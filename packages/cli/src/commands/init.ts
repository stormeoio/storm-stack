import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "fs";
import { findProjectRoot, readConfig, writeConfig, createDefaultConfig } from "../config";

export async function initCommand(): Promise<void> {
  const root = findProjectRoot();

  if (!root) {
    p.log.error("Aucun projet détecté (pas de package.json trouvé).");
    p.log.info(`Lancez ${pc.cyan("npx create-storm-app my-app")} pour créer un nouveau projet.`);
    process.exit(1);
  }

  const existing = readConfig(root);
  if (existing) {
    p.log.warn(`${pc.cyan("storm.json")} existe déjà dans ${pc.dim(root)}`);
    const overwrite = await p.confirm({ message: "Écraser la configuration existante ?", initialValue: false });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Annulé.");
      return;
    }
  }

  const opts = await p.group({
    pluginsDir: () => p.text({
      message: "Répertoire des plugins",
      placeholder: "plugins",
      defaultValue: "plugins",
    }),
    serverEntry: () => p.text({
      message: "Point d'entrée serveur",
      placeholder: "server/index.ts",
      defaultValue: "server/index.ts",
    }),
    drizzleConfig: () => p.text({
      message: "Fichier de config Drizzle",
      placeholder: "drizzle.config.ts",
      defaultValue: "drizzle.config.ts",
    }),
  }, {
    onCancel: () => { p.cancel("Annulé."); process.exit(0); },
  });

  const config = createDefaultConfig();
  config.pluginsDir = opts.pluginsDir as string;
  config.serverEntry = opts.serverEntry as string;
  config.drizzleConfig = opts.drizzleConfig as string;

  // Detect already-installed plugins from server entry
  const serverPath = `${root}/${config.serverEntry}`;
  if (fs.existsSync(serverPath)) {
    const content = fs.readFileSync(serverPath, "utf8");
    const importMatches = content.matchAll(/from\s+["']@stormstack\/([^"']+)["']/g);
    for (const match of importMatches) {
      const id = `@stormstack/${match[1]}`;
      if (id !== "@stormstack/core" && !config.installed.includes(id)) {
        config.installed.push(id);
      }
    }
  }

  writeConfig(root, config);

  p.log.success(`${pc.cyan("storm.json")} créé dans ${pc.dim(root)}`);
  if (config.installed.length > 0) {
    p.log.info(`Plugins détectés : ${config.installed.map((p) => pc.cyan(p)).join(", ")}`);
  }
  p.log.info(`Ajoutez des plugins avec ${pc.cyan("storm add <plugin>")}`);
}
