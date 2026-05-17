import * as p from "@clack/prompts";
import pc from "picocolors";
import path from "path";
import fs from "fs";
import { runPrompts } from "./prompts";
import { scaffold } from "./scaffold";

async function main() {
  const nameArg = process.argv[2];

  const opts = await runPrompts(nameArg);
  const targetDir = path.resolve(process.cwd(), opts.projectName);

  if (fs.existsSync(targetDir)) {
    const overwrite = await p.confirm({
      message: `Le dossier ${pc.cyan(opts.projectName)} existe déjà. Écraser ?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Annulé.");
      process.exit(0);
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
    `${pm} install`,
    `${run} db:push  ${pc.dim("# create tables")}`,
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
