import fs from "fs";
import path from "path";
import type { PluginMeta } from "./registry";
import { drizzleSchemaReference } from "./schema-paths";
import {
  findLastStaticImportEnd as findLastImportIndex,
  findNamedImportBinding,
  hasUniqueRuntimeNamedImport,
  isActiveCodePosition,
  maskCommentsPreservingLayout,
} from "./static-import-scanner";
import type { RequiredWiringResult } from "./wiring-result";

export { injectRootComponent, removeRootComponent } from "./root-component-injector";

const DEFAULT_JSON_PARSER = "app.use(express.json());";

const STRIPE_RAW_BODY_JSON_PARSER = `app.use(express.json({
    verify: (req, _res, buf) => {
      const request = req as typeof req & { originalUrl?: string; rawBody?: Buffer };
      if (request.originalUrl?.startsWith("/api/stripe/webhook")) {
        request.rawBody = Buffer.from(buf);
      }
    },
  }));`;

/**
 * Injects a plugin import + registration into server/index.ts.
 *
 * For npm mode: `import { crmPlugin } from "@stormeoio/crm";`
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

  const bootstrapOptions = findBootstrapOptions(content);
  const needsDatabaseAdminGuard = plugin.id === "@stormeoio/auth"
    && !bootstrapOptions?.properties.some((property) => findObjectProperty([property], "requireAdmin"));
  const databaseExpression = needsDatabaseAdminGuard
    ? findBootstrapDatabaseExpression(content, bootstrapOptions)
    : null;
  if (needsDatabaseAdminGuard && !databaseExpression) {
    return {
      modified: false,
      reason: "Impossible de trouver la base de données passée à bootstrapPlugins() pour sécuriser requireAdmin",
    };
  }

  const relPath = path.relative(path.dirname(serverEntryPath), pluginsDir);
  const importSource = mode === "npm"
    ? plugin.id
    : (relPath.startsWith("..") ? relPath : `./${relPath}`) + `/${plugin.shortName}`;

  const importNames = needsDatabaseAdminGuard
    ? `${plugin.exportName}, createDatabaseRoleGuard`
    : plugin.exportName;
  const importLine = `import { ${importNames} } from "${importSource}";`;
  const registerLine = `registry.register(${plugin.exportName});`;

  if (needsDatabaseAdminGuard) {
    const guardResult = injectDatabaseAdminGuard(content, databaseExpression!);
    if (!guardResult.modified || !guardResult.configured) {
      return {
        modified: false,
        reason: guardResult.reason ?? "Impossible d'injecter requireAdmin dans bootstrapPlugins()",
      };
    }
    content = guardResult.content;
  }

  // Insert import after the last existing import line
  const importInsertIndex = findLastImportIndex(content);
  if (importInsertIndex === -1) {
    content = importLine + "\n" + content;
  } else {
    const before = content.slice(0, importInsertIndex);
    const after = content.slice(importInsertIndex);
    const separator = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    content = before + separator + importLine + "\n" + after;
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

export type DatabaseAdminGuardWiringResult = RequiredWiringResult;

/**
 * Reports whether the exact bootstrapPlugins options object already contains
 * an administration policy. Occurrences elsewhere in the file are ignored.
 */
export function hasBootstrapAdminGuard(serverEntryPath: string): boolean {
  if (!fs.existsSync(serverEntryPath)) return false;
  const content = fs.readFileSync(serverEntryPath, "utf8");
  const bootstrapOptions = findBootstrapOptions(content);
  return bootstrapOptions !== null
    && findObjectProperty(bootstrapOptions.properties, "requireAdmin") !== null;
}

/**
 * Migrates an existing auth registration to the database-backed Storm admin
 * guard. The file is written once, only after the import and bootstrap option
 * have both been constructed and verified in memory.
 */
export function ensureDatabaseAdminGuardWiring(
  serverEntryPath: string,
): DatabaseAdminGuardWiringResult {
  if (!fs.existsSync(serverEntryPath)) {
    return {
      modified: false,
      configured: false,
      reason: `Fichier introuvable: ${serverEntryPath}`,
    };
  }

  const original = fs.readFileSync(serverEntryPath, "utf8");
  const bootstrapOptions = findBootstrapOptions(original);
  if (!bootstrapOptions) {
    return {
      modified: false,
      configured: false,
      reason: "Impossible d'identifier un unique objet d'options bootstrapPlugins()",
    };
  }

  if (findObjectProperty(bootstrapOptions.properties, "requireAdmin")) {
    return { modified: false, configured: true };
  }

  const databaseExpression = findBootstrapDatabaseExpression(original, bootstrapOptions);
  if (!databaseExpression) {
    return {
      modified: false,
      configured: false,
      reason: "Impossible de trouver la base de données passée à bootstrapPlugins() pour sécuriser requireAdmin",
    };
  }

  const importResult = injectNamedImport(original, "authPlugin", "createDatabaseRoleGuard");
  if (!importResult) {
    return {
      modified: false,
      configured: false,
      reason: "Impossible de trouver l'import authPlugin à migrer vers createDatabaseRoleGuard",
    };
  }

  const guardResult = injectDatabaseAdminGuard(importResult.content, databaseExpression);
  if (!guardResult.modified || !guardResult.configured) {
    return {
      modified: false,
      configured: false,
      reason: guardResult.reason ?? "Impossible d'injecter requireAdmin dans bootstrapPlugins()",
    };
  }

  fs.writeFileSync(serverEntryPath, guardResult.content, "utf8");
  return { modified: true, configured: true };
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

  if (plugin.id === "@stormeoio/auth") {
    content = content.replace(
      /^[ \t]*requireAdmin:[ \t]*createDatabaseRoleGuard\([^\r\n]+\),?[ \t]*(?:\r?\n|$)/m,
      "",
    );
  }

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
): RequiredWiringResult {
  if (!fs.existsSync(drizzleConfigPath)) {
    return {
      modified: false,
      configured: false,
      reason: `Fichier introuvable: ${drizzleConfigPath}`,
    };
  }

  let content = fs.readFileSync(drizzleConfigPath, "utf8");

  const schemaPath = drizzleSchemaReference(plugin, mode, pluginsDir);

  if (drizzleSchemaIsConfigured(content, schemaPath)) {
    return { modified: false, configured: true, reason: "Schema déjà dans drizzle.config.ts" };
  }

  const schemaRange = findActiveDrizzleSchemaArray(content);
  if (!schemaRange) {
    return {
      modified: false,
      configured: false,
      reason: "Array schema: [...] introuvable dans drizzle.config.ts",
    };
  }

  const maskedContent = maskCommentsPreservingLayout(content);
  const activeSchemas = maskedContent.slice(schemaRange.opening + 1, schemaRange.closing).trim();
  const existingSchemas = content.slice(schemaRange.opening + 1, schemaRange.closing);
  const newSchemas = `${schemaPath}${activeSchemas.length > 0 ? ", " : ""}${existingSchemas}`;
  content = `${content.slice(0, schemaRange.opening + 1)}${newSchemas}${content.slice(schemaRange.closing)}`;

  if (!drizzleSchemaIsConfigured(content, schemaPath)) {
    return {
      modified: false,
      configured: false,
      reason: "Impossible de vérifier l'ajout du schéma dans drizzle.config.ts",
    };
  }

  fs.writeFileSync(drizzleConfigPath, content, "utf8");
  return { modified: true, configured: true };
}

function drizzleSchemaIsConfigured(content: string, schemaPath: string): boolean {
  const schemaRange = findActiveDrizzleSchemaArray(content);
  if (!schemaRange) return false;
  const maskedContent = maskCommentsPreservingLayout(content);
  return maskedContent.slice(schemaRange.opening + 1, schemaRange.closing).includes(schemaPath);
}

function findActiveDrizzleSchemaArray(content: string): ObjectRange | null {
  const maskedContent = maskCommentsPreservingLayout(content);
  const schemaPattern = /\bschema\s*:\s*\[/g;
  let schemaMatch: RegExpExecArray | null;

  while ((schemaMatch = schemaPattern.exec(maskedContent)) !== null) {
    if (!isActiveCodePosition(content, schemaMatch.index)) continue;
    const opening = maskedContent.indexOf("[", schemaMatch.index);
    const closing = findMatchingDelimiter(maskedContent, opening, "[", "]");
    return closing === -1 ? null : { opening, closing };
  }

  return null;
}

/**
 * Preserves the raw request body required by Stripe signature verification.
 */
export function injectStripeWebhookRawBody(
  serverEntryPath: string,
): RequiredWiringResult {
  if (!fs.existsSync(serverEntryPath)) {
    return {
      modified: false,
      configured: false,
      reason: `Fichier introuvable: ${serverEntryPath}`,
    };
  }

  let content = fs.readFileSync(serverEntryPath, "utf8");
  if (stripeWebhookRawBodyIsConfigured(content)) {
    return { modified: false, configured: true, reason: "Body brut Stripe déjà configuré" };
  }

  const defaultParserIndex = findActiveSnippet(content, DEFAULT_JSON_PARSER);
  if (defaultParserIndex === -1) {
    return {
      modified: false,
      configured: false,
      reason: "app.use(express.json()) introuvable",
    };
  }

  content = `${content.slice(0, defaultParserIndex)}${STRIPE_RAW_BODY_JSON_PARSER}${content.slice(defaultParserIndex + DEFAULT_JSON_PARSER.length)}`;
  if (!stripeWebhookRawBodyIsConfigured(content)) {
    return {
      modified: false,
      configured: false,
      reason: "Impossible de vérifier la préservation du body brut Stripe",
    };
  }
  fs.writeFileSync(serverEntryPath, content, "utf8");
  return { modified: true, configured: true };
}

function stripeWebhookRawBodyIsConfigured(content: string): boolean {
  if (findActiveSnippet(content, STRIPE_RAW_BODY_JSON_PARSER) !== -1) return true;
  return hasActivePattern(
    content,
    /originalUrl\??\.startsWith\(\s*["']\/api\/stripe\/webhook["']\s*\)/g,
  ) && hasActivePattern(
    content,
    /\b(?:request|req)\.rawBody\s*=\s*Buffer\.from\(\s*buf\s*\)/g,
  );
}

function findActiveSnippet(content: string, snippet: string): number {
  const maskedContent = maskCommentsPreservingLayout(content);
  let index = maskedContent.indexOf(snippet);
  while (index !== -1) {
    if (isActiveCodePosition(content, index)) return index;
    index = maskedContent.indexOf(snippet, index + 1);
  }
  return -1;
}

function hasActivePattern(content: string, pattern: RegExp): boolean {
  const maskedContent = maskCommentsPreservingLayout(content);
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(maskedContent)) !== null) {
    if (isActiveCodePosition(content, match.index)) return true;
  }
  return false;
}

/**
 * Restores the default JSON parser when Stripe's generated raw-body hook is removed.
 */
export function removeStripeWebhookRawBody(
  serverEntryPath: string,
): { modified: boolean; reason?: string } {
  if (!fs.existsSync(serverEntryPath)) {
    return { modified: false, reason: `Fichier introuvable: ${serverEntryPath}` };
  }

  let content = fs.readFileSync(serverEntryPath, "utf8");
  if (!content.includes(STRIPE_RAW_BODY_JSON_PARSER)) {
    return { modified: false, reason: "Body brut Stripe généré introuvable" };
  }

  content = content.replace(STRIPE_RAW_BODY_JSON_PARSER, DEFAULT_JSON_PARSER);
  fs.writeFileSync(serverEntryPath, content, "utf8");
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

// ── Client component map injection ──────────────────────────────────────────

/**
 * Adds a plugin's components to client/src/storm-components.ts.
 * This maps the component names from the server manifest to actual imports.
 */
export function injectClientComponents(
  projectRoot: string,
  plugin: PluginMeta,
  mode: "npm" | "copy",
  pluginsDir: string,
): RequiredWiringResult {
  const stormComponentsPath = path.join(projectRoot, "client/src/storm-components.ts");

  if (!fs.existsSync(stormComponentsPath)) {
    if (!fs.existsSync(path.join(projectRoot, "client"))) {
      return {
        modified: false,
        configured: true,
        reason: "Projet sans client; câblage des composants ignoré",
      };
    }
    return {
      modified: false,
      configured: false,
      reason: "client/src/storm-components.ts introuvable",
    };
  }

  if (!plugin.clientComponents || plugin.clientComponents.length === 0) {
    return { modified: false, configured: true, reason: "Plugin sans composants client" };
  }

  let content = fs.readFileSync(stormComponentsPath, "utf8");

  // Build import path
  const importSource = mode === "npm"
    ? `${plugin.id}/client`
    : `../../${pluginsDir}/${plugin.shortName}/client`;
  if (clientComponentsAreConfigured(content, plugin, importSource)) {
    return { modified: false, configured: true, reason: "Composants déjà injectés" };
  }

  const mapRange = findStormComponentsObject(content);
  if (!mapRange) {
    return {
      modified: false,
      configured: false,
      reason: "Objet STORM_COMPONENTS introuvable dans client/src/storm-components.ts",
    };
  }

  for (const component of plugin.clientComponents) {
    const componentAlreadyImported = hasUniqueRuntimeNamedImport(
      content,
      importSource,
      component.exportName,
    );
    const conflictingBinding = componentAlreadyImported
      ? null
      : findNamedImportBinding(content, component.exportName);
    if (conflictingBinding) {
      return {
        modified: false,
        configured: false,
        reason: `Le nom ${component.exportName} est déjà importé depuis ${conflictingBinding.source}`,
      };
    }
  }

  const hasPartialWiring = plugin.clientComponents.some((component) => (
    hasUniqueRuntimeNamedImport(content, importSource, component.exportName)
    || hasClientComponentEntry(
      content,
      mapRange,
      component.manifestName,
      component.exportName,
    )
  ));
  if (hasPartialWiring) {
    return {
      modified: false,
      configured: false,
      reason: "Câblage des composants client incomplet dans storm-components.ts",
    };
  }

  // Add import line after last existing import
  const importNames = plugin.clientComponents.map((c) => c.exportName).join(", ");
  const importLine = `import { ${importNames} } from "${importSource}";`;
  const lastImportIdx = findLastImportIndex(content);
  if (lastImportIdx === -1) {
    content = importLine + "\n" + content;
  } else {
    content = content.slice(0, lastImportIdx) + importLine + "\n" + content.slice(lastImportIdx);
  }

  const updatedMapRange = findStormComponentsObject(content);
  if (!updatedMapRange) {
    return {
      modified: false,
      configured: false,
      reason: "Objet STORM_COMPONENTS introuvable après l'injection de l'import",
    };
  }

  let entries = "";
  for (const comp of plugin.clientComponents) {
    if (!hasClientComponentEntry(content, updatedMapRange, comp.manifestName, comp.exportName)) {
      entries += `  ${comp.manifestName}: ${comp.exportName},\n`;
    }
  }
  if (entries) {
    content = `${content.slice(0, updatedMapRange.closing)}${entries}${content.slice(updatedMapRange.closing)}`;
  }

  if (!clientComponentsAreConfigured(content, plugin, importSource)) {
    return {
      modified: false,
      configured: false,
      reason: "Impossible de vérifier le câblage des composants client",
    };
  }

  fs.writeFileSync(stormComponentsPath, content, "utf8");
  return { modified: true, configured: true };
}

interface ObjectRange {
  opening: number;
  closing: number;
}

function findStormComponentsObject(content: string): ObjectRange | null {
  const pattern = /\b(?:export\s+)?const\s+STORM_COMPONENTS\b/g;
  let declaration: RegExpExecArray | null;
  while ((declaration = pattern.exec(content)) !== null) {
    if (!isActiveCodePosition(content, declaration.index)) continue;

    const equals = content.indexOf("=", declaration.index + declaration[0].length);
    if (equals === -1) return null;
    const opening = content.indexOf("{", equals + 1);
    if (opening === -1) return null;
    const closing = findMatchingDelimiter(content, opening, "{", "}");
    return closing === -1 ? null : { opening, closing };
  }
  return null;
}

function clientComponentsAreConfigured(
  content: string,
  plugin: PluginMeta,
  importSource: string,
): boolean {
  if (!plugin.clientComponents || plugin.clientComponents.length === 0) return true;
  const mapRange = findStormComponentsObject(content);
  return mapRange !== null && plugin.clientComponents.every((component) => (
    hasUniqueRuntimeNamedImport(content, importSource, component.exportName)
    && hasClientComponentEntry(
      content,
      mapRange,
      component.manifestName,
      component.exportName,
    )
  ));
}

function hasClientComponentEntry(
  content: string,
  range: ObjectRange,
  manifestName: string,
  exportName: string,
): boolean {
  const body = content.slice(range.opening + 1, range.closing);
  const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[,\\r\\n])\\s*${escape(manifestName)}\\s*:\\s*${escape(exportName)}\\s*(?=,|$)`,
  ).test(body);
}

/**
 * Removes a plugin's components from client/src/storm-components.ts.
 */
export function removeClientComponents(
  projectRoot: string,
  plugin: PluginMeta,
): { modified: boolean; reason?: string } {
  const stormComponentsPath = path.join(projectRoot, "client/src/storm-components.ts");

  if (!fs.existsSync(stormComponentsPath)) {
    return { modified: false, reason: "client/src/storm-components.ts introuvable" };
  }

  if (!plugin.clientComponents || plugin.clientComponents.length === 0) {
    return { modified: false, reason: "Plugin sans composants client" };
  }

  let content = fs.readFileSync(stormComponentsPath, "utf8");

  // Remove import line
  const importRegex = new RegExp(`^.*import.*\\{[^}]*\\}.*from.*["'].*${plugin.shortName}.*["'];?\\s*\\n`, "m");
  content = content.replace(importRegex, "");

  // Remove entries from STORM_COMPONENTS
  for (const comp of plugin.clientComponents) {
    const entryRegex = new RegExp(`^\\s*${comp.manifestName}:.*,?\\s*\\n`, "m");
    content = content.replace(entryRegex, "");
  }

  content = content.replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(stormComponentsPath, content, "utf8");
  return { modified: true };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface BootstrapOptionsLocation {
  openingBrace: number;
  closingBrace: number;
  properties: string[];
}

interface ContentInjectionResult {
  content: string;
  modified: boolean;
  configured: boolean;
  reason?: string;
}

function findBootstrapOptions(content: string): BootstrapOptionsLocation | null {
  const matches: BootstrapOptionsLocation[] = [];
  const bootstrapPattern = /\bawait\s+bootstrapPlugins\s*\(/g;
  let bootstrapMatch: RegExpExecArray | null;

  while ((bootstrapMatch = bootstrapPattern.exec(content)) !== null) {
    if (!isActiveCodePosition(content, bootstrapMatch.index)) continue;

    let openingBrace = bootstrapMatch.index + bootstrapMatch[0].length;
    while (/\s/.test(content[openingBrace] ?? "")) openingBrace++;
    if (content[openingBrace] !== "{") return null;

    const closingBrace = findMatchingDelimiter(content, openingBrace, "{", "}");
    if (closingBrace === -1) return null;

    const properties = splitTopLevelProperties(content.slice(openingBrace + 1, closingBrace));
    if (!properties) return null;
    matches.push({ openingBrace, closingBrace, properties });
  }

  return matches.length === 1 ? matches[0]! : null;
}

function findBootstrapDatabaseExpression(
  content: string,
  bootstrapOptions: BootstrapOptionsLocation | null = findBootstrapOptions(content),
): string | null {
  if (!bootstrapOptions) return null;

  const contextProperty = findObjectProperty(bootstrapOptions.properties, "ctx");
  if (!contextProperty) return null;
  if (contextProperty.shorthand) return "ctx.db";

  const contextExpression = contextProperty.value.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(contextExpression)) {
    return `${contextExpression}.db`;
  }

  if (!contextExpression.startsWith("{")) return null;
  const contextClosingBrace = findMatchingDelimiter(contextExpression, 0, "{", "}");
  if (contextClosingBrace === -1 || contextExpression.slice(contextClosingBrace + 1).trim() !== "") {
    return null;
  }

  const contextProperties = splitTopLevelProperties(contextExpression.slice(1, contextClosingBrace));
  if (!contextProperties) return null;
  const databaseProperty = findObjectProperty(contextProperties, "db");
  if (!databaseProperty) return null;
  if (databaseProperty.shorthand) return "db";

  const databaseExpression = databaseProperty.value.trim();
  if (isSafeDatabaseExpression(databaseExpression)) return databaseExpression;
  return null;
}

function injectDatabaseAdminGuard(
  content: string,
  databaseExpression: string,
): ContentInjectionResult {
  const bootstrapOptions = findBootstrapOptions(content);
  if (!bootstrapOptions) {
    return {
      content,
      modified: false,
      configured: false,
      reason: "Impossible d'identifier un unique objet d'options bootstrapPlugins()",
    };
  }
  if (findObjectProperty(bootstrapOptions.properties, "requireAdmin")) {
    return { content, modified: false, configured: true };
  }

  const openingEnd = bootstrapOptions.openingBrace + 1;
  const lineStart = content.lastIndexOf("\n", bootstrapOptions.openingBrace) + 1;
  const callIndent = content.slice(lineStart, bootstrapOptions.openingBrace).match(/^[ \t]*/)?.[0] ?? "";
  const afterOpening = content.slice(openingEnd);
  const leadingWhitespace = afterOpening.match(/^\s*/)?.[0] ?? "";
  const lastNewline = Math.max(leadingWhitespace.lastIndexOf("\n"), leadingWhitespace.lastIndexOf("\r"));
  const existingIndent = lastNewline === -1 ? "" : leadingWhitespace.slice(lastNewline + 1);
  const propertyIndent = existingIndent || `${callIndent}  `;
  const guardLine = `${propertyIndent}requireAdmin: createDatabaseRoleGuard(${databaseExpression}, "admin"),`;

  let injected: string;
  if (lastNewline !== -1) {
    injected = `${content.slice(0, openingEnd)}\n${guardLine}${afterOpening}`;
  } else {
    injected = `${content.slice(0, openingEnd)}\n${guardLine}\n${propertyIndent}${afterOpening.slice(leadingWhitespace.length)}`;
  }

  const verifiedBootstrap = findBootstrapOptions(injected);
  const verifiedGuard = verifiedBootstrap
    ? findObjectProperty(verifiedBootstrap.properties, "requireAdmin")
    : null;
  const expectedGuard = `createDatabaseRoleGuard(${databaseExpression}, "admin")`;
  if (!verifiedGuard || verifiedGuard.shorthand || verifiedGuard.value.trim() !== expectedGuard) {
    return {
      content,
      modified: false,
      configured: false,
      reason: "La vérification du garde requireAdmin injecté a échoué",
    };
  }

  return { content: injected, modified: true, configured: true };
}

function injectNamedImport(
  content: string,
  existingName: string,
  newName: string,
): { content: string; modified: boolean } | null {
  const importPattern = /^([ \t]*import\s*\{)([\s\S]*?)(\}\s*from\s*["'][^"']+["'];?[ \t]*)(?=\r?$)/gm;
  const candidates: Array<{
    match: RegExpExecArray;
    bindings: string;
  }> = [];
  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(content)) !== null) {
    const bindings = match[2]!;
    if (hasNamedImport(bindings, existingName)) {
      candidates.push({ match, bindings });
    }
  }

  if (candidates.length !== 1) return null;
  const candidate = candidates[0]!;
  if (hasNamedImport(candidate.bindings, newName)) {
    return { content, modified: false };
  }

  const nextBindings = appendNamedImport(candidate.bindings, newName);
  const replacement = `${candidate.match[1]}${nextBindings}${candidate.match[3]}`;
  return {
    content: `${content.slice(0, candidate.match.index)}${replacement}${content.slice(candidate.match.index + candidate.match[0].length)}`,
    modified: true,
  };
}

function hasNamedImport(bindings: string, name: string): boolean {
  return bindings
    .split(",")
    .some((binding) => new RegExp(`^${name}(?:\\s+as\\s+[A-Za-z_$][\\w$]*)?$`).test(binding.trim()));
}

function appendNamedImport(bindings: string, name: string): string {
  if (!bindings.includes("\n") && !bindings.includes("\r")) {
    const trimmed = bindings.trim();
    return ` ${trimmed}${trimmed.endsWith(",") ? "" : ","} ${name} `;
  }

  const trailingWhitespace = bindings.match(/(\r?\n[ \t]*)$/)?.[1] ?? "\n";
  const body = trailingWhitespace === "\n"
    ? bindings.trimEnd()
    : bindings.slice(0, -trailingWhitespace.length);
  const indentation = [...body.matchAll(/(?:^|\r?\n)([ \t]*)\S/g)].at(-1)?.[1] ?? "  ";
  return `${body}${body.trimEnd().endsWith(",") ? "" : ","}\n${indentation}${name}${trailingWhitespace}`;
}

interface ObjectProperty {
  shorthand: boolean;
  value: string;
}

function findObjectProperty(properties: string[], name: string): ObjectProperty | null {
  for (const rawProperty of properties) {
    const property = stripLeadingTrivia(rawProperty).trim();
    if (property === name) return { shorthand: true, value: name };

    const match = new RegExp(`^${name}\\s*:`).exec(property);
    if (match) {
      return { shorthand: false, value: property.slice(match[0].length) };
    }
  }
  return null;
}

function isSafeDatabaseExpression(expression: string): boolean {
  const identifier = "[A-Za-z_$][\\w$]*";
  const memberPath = `${identifier}(?:\\s*\\.\\s*${identifier})*`;
  const simpleValue = `(?:${memberPath}\\s*!?|\\{\\s*\\})`;
  const simpleType = `(?:any|unknown|${memberPath})`;
  return new RegExp(`^${simpleValue}(?:\\s+as\\s+${simpleType})?$`).test(expression);
}

function splitTopLevelProperties(source: string): string[] | null {
  const properties: string[] = [];
  let start = 0;
  let parentheses = 0;
  let braces = 0;
  let brackets = 0;

  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    const next = source[index + 1];

    if (character === "\"" || character === "'" || character === "`") {
      index = skipQuotedValue(source, index, character);
      if (index === -1) return null;
      continue;
    }
    if (character === "/" && next === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) break;
      continue;
    }
    if (character === "/" && next === "*") {
      index = source.indexOf("*/", index + 2);
      if (index === -1) return null;
      index += 1;
      continue;
    }

    if (character === "(") parentheses++;
    else if (character === ")") parentheses--;
    else if (character === "{") braces++;
    else if (character === "}") braces--;
    else if (character === "[") brackets++;
    else if (character === "]") brackets--;

    if (parentheses < 0 || braces < 0 || brackets < 0) return null;
    if (character === "," && parentheses === 0 && braces === 0 && brackets === 0) {
      properties.push(source.slice(start, index));
      start = index + 1;
    }
  }

  if (parentheses !== 0 || braces !== 0 || brackets !== 0) return null;
  properties.push(source.slice(start));
  return properties;
}

function findMatchingDelimiter(source: string, openingIndex: number, opening: string, closing: string): number {
  let depth = 0;

  for (let index = openingIndex; index < source.length; index++) {
    const character = source[index]!;
    const next = source[index + 1];

    if (character === "\"" || character === "'" || character === "`") {
      index = skipQuotedValue(source, index, character);
      if (index === -1) return -1;
      continue;
    }
    if (character === "/" && next === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) return -1;
      continue;
    }
    if (character === "/" && next === "*") {
      index = source.indexOf("*/", index + 2);
      if (index === -1) return -1;
      index += 1;
      continue;
    }

    if (character === opening) depth++;
    else if (character === closing) {
      depth--;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function skipQuotedValue(source: string, openingIndex: number, quote: string): number {
  for (let index = openingIndex + 1; index < source.length; index++) {
    if (source[index] === "\\") {
      index++;
      continue;
    }
    if (source[index] === quote) return index;
  }
  return -1;
}

function stripLeadingTrivia(source: string): string {
  let remaining = source;
  while (true) {
    const trimmed = remaining.trimStart();
    if (trimmed.startsWith("//")) {
      const newline = trimmed.indexOf("\n");
      if (newline === -1) return "";
      remaining = trimmed.slice(newline + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      const closing = trimmed.indexOf("*/", 2);
      if (closing === -1) return "";
      remaining = trimmed.slice(closing + 2);
      continue;
    }
    return trimmed;
  }
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
