import * as p from "@clack/prompts";
import pc from "picocolors";

export interface ScaffoldOptions {
  projectName: string;
  plugins: string[];
  packageManager: "npm" | "pnpm" | "yarn";
  withClient: boolean;
}

const AVAILABLE_PLUGINS = [
  { value: "@stormstack/auth", label: "auth", hint: "Email/password + JWT + RBAC (recommended)" },
  { value: "@stormstack/auth-social", label: "auth-social", hint: "OAuth2 Google/GitHub/GitLab" },
  { value: "@stormstack/crm", label: "crm", hint: "Contacts, organisations, pipeline" },
  { value: "@stormstack/ticketing", label: "ticketing", hint: "Support tickets + feedback" },
  { value: "@stormstack/billing", label: "billing", hint: "Stripe subscriptions + webhooks" },
  { value: "@stormstack/messaging", label: "messaging", hint: "In-app IM + transactional email" },
  { value: "@stormstack/drive", label: "drive", hint: "File storage + GED" },
  { value: "@stormstack/monitoring", label: "monitoring", hint: "Uptime + infra health" },
];

export async function runPrompts(nameArg?: string): Promise<ScaffoldOptions> {
  p.intro(`${pc.bgCyan(pc.black(" create-storm-app "))} ${pc.dim("v0.1.0")}`);

  const group = await p.group(
    {
      projectName: () =>
        p.text({
          message: "Nom du projet",
          placeholder: "my-storm-app",
          defaultValue: nameArg ?? "my-storm-app",
          validate: (v) => {
            if (!/^[a-z0-9-_]+$/.test(v)) return "Utilisez uniquement des lettres minuscules, chiffres, - ou _";
          },
        }),

      plugins: () =>
        p.multiselect({
          message: "Plugins à installer",
          options: AVAILABLE_PLUGINS,
          initialValues: ["@stormstack/auth"],
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
