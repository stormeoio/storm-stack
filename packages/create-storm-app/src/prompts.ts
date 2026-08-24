import * as p from "@clack/prompts";
import pc from "picocolors";
import { VERSION } from "./version";
import { validateProjectName } from "./cli-options";

export interface ScaffoldOptions {
  projectName: string;
  plugins: string[];
  packageManager: "npm" | "pnpm" | "yarn";
  withClient: boolean;
}

const AVAILABLE_PLUGINS = [
  { value: "@stormeoio/auth", label: "auth", hint: "Email/password + JWT + RBAC (recommended)" },
  { value: "@stormeoio/auth-social", label: "auth-social", hint: "OAuth2 Google/GitHub/GitLab" },
  { value: "@stormeoio/crm", label: "crm", hint: "Contacts, organisations, pipeline" },
  { value: "@stormeoio/ticketing", label: "ticketing", hint: "Support tickets + feedback" },
  { value: "@stormeoio/stripe", label: "stripe", hint: "Stripe payments + webhooks" },
  { value: "@stormeoio/consent", label: "consent", hint: "Consentement RGPD + bannière cookies" },
];

export async function runPrompts(nameArg?: string): Promise<ScaffoldOptions> {
  p.intro(`${pc.bgCyan(pc.black(" create-storm-app "))} ${pc.dim(`v${VERSION}`)}`);

  const group = await p.group(
    {
      projectName: () =>
        p.text({
          message: "Nom du projet",
          placeholder: "my-storm-app",
          defaultValue: nameArg ?? "my-storm-app",
          validate: (v) => {
            try {
              validateProjectName(v);
            } catch {
              return "Utilisez uniquement des lettres minuscules, chiffres, - ou _";
            }
          },
        }),

      plugins: () =>
        p.multiselect({
          message: "Plugins à installer",
          options: AVAILABLE_PLUGINS,
          initialValues: ["@stormeoio/auth"],
          required: false,
        }),

      withClient: () =>
        p.confirm({
          message: "Générer le frontend React (Vite + TanStack Query + Tailwind) ?",
          initialValue: true,
        }),

      packageManager: () =>
        p.select({
          message: "Gestionnaire de paquets",
          options: [
            { value: "npm", label: "npm" },
            { value: "pnpm", label: "pnpm", hint: "recommandé" },
            { value: "yarn", label: "yarn" },
          ],
          initialValue: "npm",
        }),
    },
    {
      onCancel: () => {
        p.cancel("Annulé.");
        process.exit(0);
      },
    }
  );

  return group as ScaffoldOptions;
}
