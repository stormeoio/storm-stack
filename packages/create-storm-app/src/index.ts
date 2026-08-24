import * as p from "@clack/prompts";
import pc from "picocolors";
import path from "path";
import fs from "fs";
import { runPrompts } from "./prompts";
import { scaffold, SESSION_SECRET_SETUP_COMMAND } from "./scaffold";
import { CliUsageError, parseCliOptions, renderCliHelp } from "./cli-options";

export async function runCreateStormApp(
  args = process.argv.slice(2),
  cwd = process.cwd(),
): Promise<void> {
  const parsed = parseCliOptions(args);
  if (parsed.help) {
    console.log(renderCliHelp());
    return;
  }

  const opts = parsed.scaffoldOptions ?? (await runPrompts(parsed.nameArg));
  const targetDir = path.resolve(cwd, opts.projectName);

  if (fs.existsSync(targetDir)) {
    if (!parsed.force) {
      if (parsed.scaffoldOptions) {
        throw new CliUsageError(
          `Le dossier ${opts.projectName} existe déjà. Utilisez --force pour le remplacer.`,
        );
      }
      const overwrite = await p.confirm({
        message: `Le dossier ${pc.cyan(opts.projectName)} existe déjà. Écraser ?`,
        initialValue: false,
      });
      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel("Annulé.");
        return;
      }
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  const spinner = p.spinner();
  spinner.start("Génération du projet...");

  try {
    scaffold(opts, targetDir);
    spinner.stop("Projet généré ✓");
  } catch (err) {
    spinner.stop("Erreur lors de la génération");
    console.error(err);
    process.exit(1);
  }

  const pm = opts.packageManager;
  const run = pm === "npm" ? "npm run" : pm;

  const steps = [
    `cd ${opts.projectName}`,
    `docker compose up -d  ${pc.dim("# PostgreSQL local")}`,
    `cp .env.example .env  ${pc.dim("# configure secrets")}`,
    SESSION_SECRET_SETUP_COMMAND,
    `${pm} install`,
    `${run} db:generate  ${pc.dim("# generate migrations")}`,
    `${run} db:migrate  ${pc.dim("# apply migrations")}`,
    `${run} dev`,
  ];

  p.note(steps.join("\n"), "Prochaines étapes");

  if (opts.withClient) {
    p.log.info(`${pc.dim("Server")} → http://localhost:3000`);
    p.log.info(`${pc.dim("Client")} → http://localhost:5173`);
  } else {
    p.log.info(`${pc.dim("Server")} → http://localhost:3000`);
  }

  p.outro(`Bonne construction avec ${pc.cyan("Storm Stack")} ⚡`);
}

if (require.main === module) {
  runCreateStormApp().catch((err) => {
    if (err instanceof CliUsageError) {
      console.error(`Erreur : ${err.message}\n\n${renderCliHelp()}`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  });
}
