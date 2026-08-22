import * as p from "@clack/prompts";
import pc from "picocolors";
import { VERSION } from "./version";

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

  const silent = (command === "deps" || command === "graph") && args.includes("--json");
  if (!silent) p.intro(`${pc.bgCyan(pc.black(" storm "))} ${pc.dim(`v${VERSION}`)}`);

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

    case "search":
    case "find": {
      const query = args.slice(1).join(" ");
      const { searchCommand } = await import("./commands/search");
      await searchCommand(query || undefined);
      break;
    }

    case "publish": {
      const pluginArg = args[1];
      const yes = args.includes("--yes") || args.includes("-y");
      const dryRun = args.includes("--dry-run");
      const { publishCommand } = await import("./commands/publish");
      await publishCommand(pluginArg, { yes, dryRun });
      break;
    }

    case "remove":
    case "rm": {
      const pluginArg = args[1];
      const { removeCommand } = await import("./commands/remove");
      await removeCommand(pluginArg);
      break;
    }

    case "create-plugin": {
      const nameArg = args[1];
      const yes = args.includes("--yes") || args.includes("-y");
      const { createPluginCommand } = await import("./commands/create-plugin");
      await createPluginCommand(nameArg, { yes });
      break;
    }

    case "deps":
    case "graph": {
      const pluginArg = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
      const all = args.includes("--all");
      const json = args.includes("--json");
      const { depsCommand } = await import("./commands/deps");
      await depsCommand(pluginArg, { all, json });
      break;
    }

    case "migrate":
    case "migration": {
      const action = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
      const pluginArg = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
      const yes = args.includes("--yes") || args.includes("-y");
      const { migrateCommand } = await import("./commands/migrate");
      await migrateCommand(action, pluginArg, { yes });
      break;
    }

    case "update":
    case "upgrade": {
      const pluginArg = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
      const yes = args.includes("--yes") || args.includes("-y");
      const dryRun = args.includes("--dry-run");
      const all = args.includes("--all");
      const { updateCommand } = await import("./commands/update");
      const result = await updateCommand(pluginArg, { yes, dryRun, all });
      if (result.status === "failed") process.exitCode = 1;
      break;
    }

    case "docker": {
      const yes = args.includes("--yes") || args.includes("-y");
      const portIdx = args.indexOf("--port");
      const port = portIdx !== -1 ? parseInt(args[portIdx + 1]!, 10) : undefined;
      const pgIdx = args.indexOf("--pg");
      const pgVersion = pgIdx !== -1 ? args[pgIdx + 1] : undefined;
      const { dockerCommand } = await import("./commands/docker");
      await dockerCommand({ yes, port, pgVersion });
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

  if (!silent) p.outro(pc.dim("stormstack.dev"));
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
  ${pc.cyan("search")} <query>   Chercher un plugin par nom, tag ou description
  ${pc.cyan("publish")} [plugin] Publier un plugin dans le registre
  ${pc.cyan("info")}             Afficher l'état du projet
  ${pc.cyan("migrate")} <action>  Migrations DB (generate, run, rollback, status, reset)
  ${pc.cyan("deps")} [plugin]     Graphe de dépendances (arbre, cycles, ordre bootstrap)
  ${pc.cyan("update")} [plugin]   Mettre à jour un ou tous les plugins
  ${pc.cyan("docker")}           Générer Dockerfile + docker-compose + .env.example
  ${pc.cyan("create-plugin")} <name>  Générer un nouveau plugin (scaffolder)
  ${pc.cyan("init")}             Initialiser storm.json

${pc.bold("Options (dev):")}
  --port <n>         Port du serveur API (défaut: 3000)
  --client-port <n>  Port du client Vite (défaut: 5173)
  --no-client        Démarrer seulement le serveur API

${pc.bold("Options (add):")}
  --copy           Copier le code source (style shadcn) au lieu d'installer le package npm
  --local <path>   Chemin local vers le monorepo storm-stack (pour dev)
  --yes, -y        Confirmer automatiquement les prompts

${pc.bold("Options (migrate):")}
  generate [plugin]  Générer les migrations SQL depuis les schémas
  run                Appliquer les migrations en attente
  rollback           Annuler la dernière migration
  status             Voir l'état des migrations
  reset              Annuler toutes les migrations (inverse)
  --yes, -y          Confirmer automatiquement

${pc.bold("Options (docker):")}
  --port <n>       Port de l'app (défaut: 3000)
  --pg <version>   Version PostgreSQL (défaut: 16)
  --yes, -y        Écraser les fichiers existants sans confirmer

${pc.bold("Options (deps):")}
  --all            Inclure tous les plugins (pas seulement les installés)
  --json           Sortie JSON (pour scripting)

${pc.bold("Options (create-plugin):")}
  --yes, -y        Utiliser les valeurs par défaut (scope @stormstack, avec auth)

${pc.bold("Options (update):")}
  --dry-run        Voir les mises à jour sans appliquer
  --all            Mettre à jour tous les plugins installés
  --yes, -y        Confirmer automatiquement

${pc.bold("Options (publish):")}
  --dry-run        Afficher l'entrée sans écrire dans le registre
  --yes, -y        Confirmer automatiquement

${pc.bold("Examples:")}
  storm dev                       # Lancer le dev server complet
  storm dev --port 4000           # API sur le port 4000
  storm dev --no-client           # API seule (pas de Vite)
  storm add auth                  # Installer le plugin auth (npm)
  storm add crm --copy            # Copier le code source du CRM
  storm list                      # Voir tous les plugins
  storm search payments           # Chercher par mot-clé
  storm publish auth --dry-run    # Prévisualiser l'entrée registre
  storm docker                       # Générer Dockerfile + docker-compose
  storm docker --port 4000          # Port custom
  storm docker --pg 15              # PostgreSQL 15
  storm migrate generate            # Générer les migrations SQL
  storm migrate generate auth      # Migration pour un plugin spécifique
  storm migrate run                # Appliquer les migrations
  storm migrate rollback           # Annuler la dernière
  storm migrate status             # État des migrations
  storm deps                       # Arbre des plugins installés
  storm deps --all                 # Arbre complet du catalogue
  storm deps auth                  # Détail d'un plugin
  storm deps --json                # Sortie JSON
  storm create-plugin my-plugin    # Scaffolder un nouveau plugin
  storm create-plugin my-plugin -y # Avec valeurs par défaut
  storm update                     # Vérifier et appliquer les mises à jour
  storm update auth                # Mettre à jour un seul plugin
  storm update --dry-run           # Voir les mises à jour disponibles
  storm remove stripe             # Retirer un plugin

${pc.dim("https://stormstack.dev")}
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
