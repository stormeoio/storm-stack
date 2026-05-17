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
  const installCmd = pm === "npm" ? "npm install" : `${pm} install`;
  const devCmd = pm === "npm" ? "npm run dev" : `${pm} dev`;

  p.note(
    [
      `cd ${opts.projectName}`,
      `cp .env.example .env  ${pc.dim("# configure DATABASE_URL + secrets")}`,
      installCmd,
      `${pm === "npm" ? "npm run" : pm} db:push`,
      devCmd,
    ].join("\n"),
    "Prochaines étapes"
  );

  p.outro(`Bonne construction avec ${pc.cyan("Storm Stack")} ⚡`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
