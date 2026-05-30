import fs from "fs";
import path from "path";
import type { PluginMeta } from "./registry";

export function drizzleSchemaReference(
  plugin: PluginMeta,
  mode: "npm" | "copy",
  pluginsDir: string,
): string {
  if (mode === "npm") {
    return `"node_modules/${plugin.id}/dist/index.js"`;
  }

  return `"./${pluginsDir}/${plugin.shortName}/schema.ts"`;
}

export function pluginSchemaCandidates(
  root: string,
  plugin: PluginMeta,
  pluginsDir: string,
): string[] {
  return [
    path.join(root, pluginsDir, plugin.shortName, "schema.ts"),
    path.join(root, `node_modules/${plugin.id}/dist/index.js`),
    path.join(root, `node_modules/${plugin.id}/dist/schema.js`),
  ];
}

export function resolvePluginSchemaFile(
  root: string,
  plugin: PluginMeta,
  pluginsDir: string,
): string | null {
  return pluginSchemaCandidates(root, plugin, pluginsDir).find((file) => fs.existsSync(file)) ?? null;
}
