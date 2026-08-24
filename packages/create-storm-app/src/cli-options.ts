import { parseArgs } from "node:util";
import type { ScaffoldOptions } from "./prompts";
import { resolveGeneratedPluginIds } from "./generated-plugin-definitions";

export const PLUGIN_IDS = [
  "@stormeoio/auth",
  "@stormeoio/auth-social",
  "@stormeoio/consent",
  "@stormeoio/crm",
  "@stormeoio/ticketing",
  "@stormeoio/stripe",
] as const;

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn"] as const;

export interface ParsedCliOptions {
  force: boolean;
  help: boolean;
  nameArg?: string;
  scaffoldOptions?: ScaffoldOptions;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function validateProjectName(value: string): void {
  if (!/^[a-z0-9-_]+$/.test(value)) {
    throw new CliUsageError(
      "Le nom du projet doit contenir uniquement des lettres minuscules, chiffres, - ou _",
    );
  }
}

export function normalizePluginIds(value: string): string[] {
  const requested = value
    .split(",")
    .map((plugin) => plugin.trim())
    .filter(Boolean)
    .map((plugin) => (plugin.startsWith("@stormeoio/") ? plugin : `@stormeoio/${plugin}`));

  const unknown = requested.filter(
    (plugin): plugin is string => !PLUGIN_IDS.includes(plugin as (typeof PLUGIN_IDS)[number]),
  );
  if (unknown.length > 0) {
    throw new CliUsageError(
      `Plugin(s) inconnu(s) : ${unknown.join(", ")}. Valeurs acceptées : ${PLUGIN_IDS.join(", ")}`,
    );
  }

  return resolveGeneratedPluginIds(requested);
}

export function parseCliOptions(args: string[]): ParsedCliOptions {
  let parsed: {
    values: {
      yes?: boolean;
      plugins?: string;
      "with-client"?: boolean;
      "package-manager"?: string;
      force?: boolean;
      help?: boolean;
    };
    positionals: string[];
  };
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        yes: { type: "boolean", short: "y" },
        plugins: { type: "string" },
        "with-client": { type: "boolean" },
        "package-manager": { type: "string" },
        force: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }) as typeof parsed;
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : "Options CLI invalides");
  }

  if (parsed.positionals.length > 1) {
    throw new CliUsageError("Un seul nom de projet peut être fourni");
  }

  const nameArg = parsed.positionals[0];
  const force = parsed.values.force ?? false;
  const help = parsed.values.help ?? false;

  if (help) return { force, help, nameArg };

  if (!parsed.values.yes) {
    const nonInteractiveOnlyOptions = [
      parsed.values.plugins,
      parsed.values["with-client"],
      parsed.values["package-manager"],
    ];
    if (nonInteractiveOnlyOptions.some((value) => value !== undefined)) {
      throw new CliUsageError(
        "--plugins, --with-client et --package-manager nécessitent --yes",
      );
    }
    return { force, help, nameArg };
  }

  if (!nameArg) {
    throw new CliUsageError("Le nom du projet est requis avec --yes");
  }
  validateProjectName(nameArg);

  const packageManager = parsed.values["package-manager"] ?? "npm";
  if (!PACKAGE_MANAGERS.includes(packageManager as (typeof PACKAGE_MANAGERS)[number])) {
    throw new CliUsageError(
      `Gestionnaire de paquets invalide : ${packageManager}. Valeurs acceptées : ${PACKAGE_MANAGERS.join(", ")}`,
    );
  }

  return {
    force,
    help,
    nameArg,
    scaffoldOptions: {
      projectName: nameArg,
      plugins: normalizePluginIds(parsed.values.plugins ?? "auth"),
      packageManager: packageManager as ScaffoldOptions["packageManager"],
      withClient: parsed.values["with-client"] ?? false,
    },
  };
}

export function renderCliHelp(): string {
  return `Usage: create-storm-app <nom> [options]

Sans --yes, le configurateur interactif est lancé.

Options :
  -y, --yes                    Génération non interactive
      --plugins <ids>          IDs courts ou complets, séparés par des virgules
      --with-client            Générer le client React
      --package-manager <pm>   npm, pnpm ou yarn (défaut : npm)
      --force                  Remplacer un dossier cible existant
  -h, --help                   Afficher cette aide

Exemple :
  create-storm-app alpha --yes --plugins auth,consent --with-client --package-manager npm`;
}
