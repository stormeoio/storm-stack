import fs from "node:fs";
import path from "node:path";
import type { PluginMeta } from "./registry";

/** Generates the project-level CLAUDE.md after every plugin add/remove. */
export function updateProjectClaudeMd(
  projectRoot: string,
  installedPlugins: PluginMeta[],
): void {
  const claudePath = path.join(projectRoot, "CLAUDE.md");
  const pluginSections = installedPlugins.map((plugin) => {
    const envVars = plugin.envVars
      ? Object.entries(plugin.envVars)
        .map(([key, value]) => `  - \`${key}\`${value.required ? " (required)" : ""} — ${value.description}`)
        .join("\n")
      : "  None";
    const routes = plugin.clientComponents
      ? plugin.clientComponents
        .map((component) => `  - ${component.manifestName} → ${component.exportName}`)
        .join("\n")
      : "  Server-only plugin";

    return `### ${plugin.name} (\`${plugin.id}\`)
${plugin.description}
- **Requires:** ${plugin.requires.length > 0 ? plugin.requires.map((requirement) => `\`${requirement}\``).join(", ") : "none"}
- **Server files:** ${plugin.files.join(", ")}
- **Env vars:**
${envVars}
- **Client components:**
${routes}`;
  }).join("\n\n");

  const content = `# Storm Stack Project — Claude Code Instructions

## Stack
- **Server:** Express 5 + TypeScript + Drizzle ORM + PostgreSQL
- **Client:** React 18 + wouter + TanStack Query + Tailwind CSS
- **Plugin system:** \`@stormstack/core\` registry + bootstrap

## Commands
\`\`\`bash
npm run dev          # Start dev (server + client)
npm run build        # Production build
npm run db:push      # Apply Drizzle schema → PostgreSQL
storm add <plugin>   # Install a Storm Stack plugin
storm remove <name>  # Uninstall a plugin
storm list           # Show available plugins
\`\`\`

## Project Structure
\`\`\`
server/index.ts          — Express entry (plugin registry + bootstrap)
client/src/App.tsx       — React app (StormLayout + StormRouter)
client/src/storm-components.ts — Maps plugin components to React imports
drizzle.config.ts        — Schema paths for all plugins
storm.json               — Installed plugins config
\`\`\`

## Installed Plugins (${installedPlugins.length})

${pluginSections || "No plugins installed yet. Run `storm add auth` to get started."}

## Conventions
- All API routes are mounted at \`/api/<plugin-name>/\`
- Auth-protected routes use \`isAuthenticated\` middleware from \`@stormstack/auth\`
- Zod validation on all POST/PATCH/PUT bodies (\`safeParse\`)
- Client uses \`@stormstack/react\` for dynamic nav/routes from plugin manifests
- French UI text for user-facing strings
`;

  fs.writeFileSync(claudePath, content, "utf8");
}
