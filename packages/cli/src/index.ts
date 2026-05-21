import * as p from "@clack/prompts";
import pc from "picocolors";

const VERSION = "0.1.0";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return;
  }

  p.intro(`${pc.bgCyan(pc.black(" storm "))} ${pc.dim(`v${VERSION}`)}`);

  switch (command) {
    case "add": {
      const pluginArg = args[1];
      const copy = args.includes("--copy");
      const yes = args.includes("--yes") || args.includes("-y");
      const localIdx = args.indexOf("--local");
      const local = localIdx !== -1 ? args[localIdx + 1] : undefined;
      const { addCommand } = await import("./commands/add");
      await addCommand(pluginArg, { copy, local, yes });
      break;
    }

    case "list":
    case "ls": {
      const { listCommand } = await import("./commands/list");
      await listCommand();
      break;
    }

    case "init": {
      const { initCommand } = await import("./commands/init");
      await initCommand();
      break;
    }

    case "info":
    case "status": {
      const { infoCommand } = await import("./commands/info");
      await infoCommand();
      break;
    }

    case "remove":
    case "rm": {
      const pluginArg = args[1];
      const { removeCommand } = await import("./commands/remove");
      await removeCommand(pluginArg);
      break;
    }

    case "dev": {
      const portIdx = args.indexOf("--port");
      const port = portIdx !== -1 ? parseInt(args[portIdx + 1]!, 10) : undefined;
      const clientPortIdx = args.indexOf("--client-port");
      const clientPort = clientPortIdx !== -1 ? parseInt(args[clientPortIdx + 1]!, 10) : undefined;
      const noClient = args.includes("--no-client");
      const { devCommand } = await import("./commands/dev");
      await devCommand({ port, clientPort, noClient });
      // dev command runs indefinitely — don't show outro
      return;
    }

    default: {
      p.log.error(`Commande inconnue : ${pc.red(command)}`);
      printUsage();
      process.exit(1);
    }
  }

  p.outro(pc.dim("stormstack.dev"));
}

function printUsage() {
  console.log(`
${pc.bold("storm")} — CLI Storm Stack ${pc.dim(`v${VERSION}`)}

${pc.bold("Usage:")}
  storm <command> [options]

${pc.bold("Commands:")}
  ${pc.cyan("dev")}              Lancer le serveur de dev (server + client)
  ${pc.cyan("add")} <plugin>     Ajouter un plugin au projet
  ${pc.cyan("remove")} <plugin>  Retirer un plugin
  ${pc.cyan("list")}             Lister les plugins disponibles
  ${pc.cyan("info")}             Afficher l'état du projet
  ${pc.cyan("init")}             Initialiser storm.json

${pc.bold("Options (dev):")}
  --port <n>         Port du serveur API (défaut: 3000)
  --client-port <n>  Port du client Vite (défaut: 5173)
  --no-client        Démarrer seulement le serveur API

${pc.bold("Options (add):")}
  --copy           Copier le code source (style shadcn) au lieu d'installer le package npm
  --local <path>   Chemin local vers le monorepo storm-stack (pour dev)
  --yes, -y        Confirmer automatiquement les prompts

${pc.bold("Examples:")}
  storm dev                       # Lancer le dev server complet
  storm dev --port 4000           # API sur le port 4000
  storm dev --no-client           # API seule (pas de Vite)
  storm add auth                  # Installer le plugin auth (npm)
  storm add crm --copy            # Copier le code source du CRM
  storm list                      # Voir tous les plugins
  storm remove stripe             # Retirer un plugin

${pc.dim("https://stormstack.dev")}
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
