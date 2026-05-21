import fs from "fs";
import path from "path";
import type { PluginMeta } from "./registry";

/**
 * Injects a plugin import + registration into server/index.ts.
 *
 * For npm mode: `import { crmPlugin } from "@stormstack/crm";`
 * For copy mode: `import { crmPlugin } from "../plugins/crm";`
 */
export function injectPluginRegistration(
  serverEntryPath: string,
  plugin: PluginMeta,
  mode: "npm" | "copy",
  pluginsDir: string,
): { modified: boolean; reason?: string } {
  if (!fs.existsSync(serverEntryPath)) {
    return { modified: false, reason: `Fichier introuvable: ${serverEntryPath}` };
  }

  let content = fs.readFileSync(serverEntryPath, "utf8");

  if (content.includes(plugin.exportName)) {
    return { modified: false, reason: `${plugin.exportName} déjà présent dans ${path.basename(serverEntryPath)}` };
  }

  const relPath = path.relative(path.dirname(serverEntryPath), pluginsDir);
  const importSource = mode === "npm"
    ? plugin.id
    : (relPath.startsWith("..") ? relPath : `./${relPath}`) + `/${plugin.shortName}`;

  const importLine = `import { ${plugin.exportName} } from "${importSource}";`;
  const registerLine = `registry.register(${plugin.exportName});`;

  // Insert import after the last existing import line
  const importInsertIndex = findLastImportIndex(content);
  if (importInsertIndex === -1) {
    content = importLine + "\n" + content;
  } else {
    const before = content.slice(0, importInsertIndex);
    const after = content.slice(importInsertIndex);
    content = before + importLine + "\n" + after;
  }

  // Insert registry.register() before bootstrapPlugins or before `async function main`
  const registerInsertIndex = findRegistrationInsertPoint(content);
  if (registerInsertIndex !== -1) {
    const before = content.slice(0, registerInsertIndex);
    const after = content.slice(registerInsertIndex);
    content = before + registerLine + "\n" + after;
  } else {
    // Fallback: insert before the first `async function main` or `bootstrapPlugins`
    const fallbackMatch = content.match(/^(async\s+function\s+main|await\s+bootstrapPlugins)/m);
    if (fallbackMatch && fallbackMatch.index !== undefined) {
      const before = content.slice(0, fallbackMatch.index);
      const after = content.slice(fallbackMatch.index);
      content = before + registerLine + "\n\n" + after;
    } else {
      return { modified: false, reason: "Impossible de trouver le point d'injection pour registry.register()" };
    }
  }

  fs.writeFileSync(serverEntryPath, content, "utf8");
  return { modified: true };
}

/**
 * Removes a plugin import + registration from server/index.ts.
 */
export function removePluginRegistration(
  serverEntryPath: string,
  plugin: PluginMeta,
): { modified: boolean; reason?: string } {
  if (!fs.existsSync(serverEntryPath)) {
    return { modified: false, reason: `Fichier introuvable: ${serverEntryPath}` };
  }

  let content = fs.readFileSync(serverEntryPath, "utf8");

  if (!content.includes(plugin.exportName)) {
    return { modified: false, reason: `${plugin.exportName} non trouvé dans ${path.basename(serverEntryPath)}` };
  }

  // Remove import line
  const importRegex = new RegExp(`^.*import.*\\{[^}]*${plugin.exportName}[^}]*\\}.*from.*["'].*["'];?\\s*\\n`, "m");
  content = content.replace(importRegex, "");

  // Remove register line
  const registerRegex = new RegExp(`^\\s*registry\\.register\\(${plugin.exportName}\\);?\\s*\\n`, "m");
  content = content.replace(registerRegex, "");

  // Clean up double blank lines
  content = content.replace(/\n{3,}/g, "\n\n");

  fs.writeFileSync(serverEntryPath, content, "utf8");
  return { modified: true };
}

/**
 * Adds a schema path to drizzle.config.ts
 */
export function injectDrizzleSchema(
  drizzleConfigPath: string,
  plugin: PluginMeta,
  mode: "npm" | "copy",
  pluginsDir: string,
): { modified: boolean; reason?: string } {
  if (!fs.existsSync(drizzleConfigPath)) {
    return { modified: false, reason: `Fichier introuvable: ${drizzleConfigPath}` };
  }

  let content = fs.readFileSync(drizzleConfigPath, "utf8");

  const schemaPath = mode === "npm"
    ? `"node_modules/${plugin.id}/dist/schema.js"`
    : `"./${pluginsDir}/${plugin.shortName}/schema.ts"`;

  if (content.includes(schemaPath)) {
    return { modified: false, reason: "Schema déjà dans drizzle.config.ts" };
  }

  // Find the schema array and add to it
  const schemaMatch = content.match(/schema:\s*\[([^\]]*)\]/);
  if (!schemaMatch) {
    return { modified: false, reason: "Array schema: [...] introuvable dans drizzle.config.ts" };
  }

  const existingSchemas = schemaMatch[1]!.trim();
  const separator = existingSchemas.length > 0 ? ", " : "";
  const newSchemas = existingSchemas + separator + schemaPath;
  content = content.replace(/schema:\s*\[([^\]]*)\]/, `schema: [${newSchemas}]`);

  fs.writeFileSync(drizzleConfigPath, content, "utf8");
  return { modified: true };
}

/**
 * Removes a schema path from drizzle.config.ts
 */
export function removeDrizzleSchema(
  drizzleConfigPath: string,
  plugin: PluginMeta,
): { modified: boolean; reason?: string } {
  if (!fs.existsSync(drizzleConfigPath)) {
    return { modified: false, reason: `Fichier introuvable: ${drizzleConfigPath}` };
  }

  let content = fs.readFileSync(drizzleConfigPath, "utf8");

  // Remove any schema reference containing the plugin name
  const patterns = [
    new RegExp(`,?\\s*"[^"]*${plugin.shortName}[^"]*"`, "g"),
    new RegExp(`"[^"]*${plugin.shortName}[^"]*",?\\s*`, "g"),
  ];

  for (const pattern of patterns) {
    content = content.replace(pattern, "");
  }

  // Clean up schema: [, ] or schema: [ ,] artifacts
  content = content.replace(/schema:\s*\[\s*,\s*/g, "schema: [");
  content = content.replace(/,\s*\]/g, "]");

  fs.writeFileSync(drizzleConfigPath, content, "utf8");
  return { modified: true };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function findLastImportIndex(content: string): number {
  const lines = content.split("\n");
  let lastImportLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import[\s{]/.test(lines[i]!)) {
      lastImportLineIdx = i;
    }
  }

  if (lastImportLineIdx === -1) return -1;

  // Return the character offset right after the last import line's newline
  let offset = 0;
  for (let i = 0; i <= lastImportLineIdx; i++) {
    offset += lines[i]!.length + 1; // +1 for \n
  }
  return offset;
}

function findRegistrationInsertPoint(content: string): number {
  // Look for the last existing `registry.register(...)` line
  const matches = [...content.matchAll(/registry\.register\([^)]+\);?\s*\n/g)];
  if (matches.length > 0) {
    const last = matches[matches.length - 1]!;
    return last.index! + last[0].length;
  }

  // Look for `async function main` and insert just before it
  const mainMatch = content.match(/^async\s+function\s+main/m);
  if (mainMatch && mainMatch.index !== undefined) {
    return mainMatch.index;
  }

  return -1;
}
