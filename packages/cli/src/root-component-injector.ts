import fs from "node:fs";
import path from "node:path";
import type { PluginMeta } from "./registry";

const ROOT_COMPONENTS_MARKER = "      {/* storm:root-components */}";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderMarker(plugin: PluginMeta, edge: "start" | "end"): string {
  return `      {/* storm:root-component ${plugin.id}:${edge} */}`;
}

function authMarker(plugin: PluginMeta, edge: "start" | "end"): string {
  return `/* storm:root-auth ${plugin.id}:${edge} */`;
}

function importMarker(plugin: PluginMeta, kind: "component" | "auth"): string {
  return `storm:root-${kind}-import ${plugin.id}`;
}

function wrapperName(plugin: PluginMeta): string {
  const exportName = plugin.rootComponent?.exportName ?? "Component";
  return `StormRoot${exportName.replace(/[^A-Za-z0-9_$]/g, "")}`;
}

function findLastImportIndex(content: string): number {
  const lines = content.split("\n");
  let lastImportLineIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*import[\s{]/.test(lines[index]!)) lastImportLineIndex = index;
  }
  if (lastImportLineIndex === -1) return -1;
  return lines
    .slice(0, lastImportLineIndex + 1)
    .reduce((offset, line) => offset + line.length + 1, 0);
}

function insertImport(content: string, importLine: string): string {
  const index = findLastImportIndex(content);
  return index === -1
    ? `${importLine}\n${content}`
    : `${content.slice(0, index)}${importLine}\n${content.slice(index)}`;
}

function hasNamedImport(content: string, source: string, name: string): boolean {
  const sourcePattern = escapeRegex(source);
  const imports = content.matchAll(
    new RegExp(`^import\\s*\\{([^}]*)\\}\\s*from\\s*["']${sourcePattern}["'];?.*$`, "gm"),
  );
  for (const match of imports) {
    const hasExactBinding = match[1]!.split(",").some((part) => {
      const [importedName, localName = importedName] = part.trim().split(/\s+as\s+/);
      return importedName === name && localName === name;
    });
    if (hasExactBinding) return true;
  }
  return false;
}

function hasImportedBinding(content: string, name: string): boolean {
  for (const match of content.matchAll(/^import\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];?.*$/gm)) {
    const localNames = match[1]!.split(",").map((part) => {
      const names = part.trim().split(/\s+as\s+/);
      return names[1] ?? names[0];
    });
    if (localNames.includes(name)) return true;
  }
  return false;
}

function removeMarkedLine(content: string, marker: string): string {
  return content.replace(new RegExp(`^.*//\\s*${escapeRegex(marker)}\\s*$\\n?`, "m"), "");
}

function removeDelimitedBlock(content: string, start: string, end: string): string {
  const pattern = new RegExp(
    `^[ \\t]*${escapeRegex(start)}\\r?\\n[\\s\\S]*?^[ \\t]*${escapeRegex(end)}\\r?\\n?`,
    "m",
  );
  return content.replace(pattern, "");
}

/** Mounts a plugin component in the generated App root using owned markers. */
export function injectRootComponent(
  projectRoot: string,
  plugin: PluginMeta,
  mode: "npm" | "copy",
  pluginsDir: string,
): { modified: boolean; reason?: string } {
  if (!plugin.rootComponent) return { modified: false, reason: "Plugin sans composant racine" };

  const appPath = path.join(projectRoot, "client/src/App.tsx");
  if (!fs.existsSync(appPath)) {
    return { modified: false, reason: "client/src/App.tsx introuvable" };
  }

  let content = fs.readFileSync(appPath, "utf8");
  const startMarker = renderMarker(plugin, "start");
  if (content.includes(startMarker)) {
    return { modified: false, reason: "Composant racine déjà injecté" };
  }
  if (!content.includes(ROOT_COMPONENTS_MARKER)) {
    return {
      modified: false,
      reason: "Marqueur storm:root-components absent; montez le composant manuellement dans App.tsx",
    };
  }

  const componentName = plugin.rootComponent.exportName;
  const componentSource = mode === "npm"
    ? `${plugin.id}/client`
    : `../../${pluginsDir}/${plugin.shortName}/client`;
  const componentAlreadyImported = hasNamedImport(content, componentSource, componentName);
  if (!componentAlreadyImported && hasImportedBinding(content, componentName)) {
    return {
      modified: false,
      reason: `Le nom ${componentName} est déjà importé depuis une autre source`,
    };
  }
  if (!componentAlreadyImported) {
    content = insertImport(
      content,
      `import { ${componentName} } from "${componentSource}"; // ${importMarker(plugin, "component")}`,
    );
  }

  let renderExpression = `<${componentName} />`;
  if (plugin.rootComponent.authenticated) {
    const helperName = wrapperName(plugin);
    if (new RegExp(`\\b${escapeRegex(helperName)}\\b`).test(content)) {
      return { modified: false, reason: `Le nom ${helperName} existe déjà dans App.tsx` };
    }
    const useStormAlreadyImported = hasNamedImport(content, "@stormstack/react", "useStorm");
    if (!useStormAlreadyImported && hasImportedBinding(content, "useStorm")) {
      return {
        modified: false,
        reason: "Le nom useStorm est déjà importé depuis une autre source",
      };
    }
    if (!useStormAlreadyImported) {
      content = insertImport(
        content,
        `import { useStorm } from "@stormstack/react"; // ${importMarker(plugin, "auth")}`,
      );
    }

    const appIndex = content.indexOf("export default function App");
    if (appIndex === -1) {
      return {
        modified: false,
        reason: "Fonction export default App introuvable; montez le composant manuellement",
      };
    }
    const helper = `${authMarker(plugin, "start")}
function ${helperName}() {
  const { user } = useStorm();
  return user ? <${componentName} /> : null;
}
${authMarker(plugin, "end")}

`;
    content = `${content.slice(0, appIndex)}${helper}${content.slice(appIndex)}`;
    renderExpression = `<${helperName} />`;
  }

  content = content.replace(
    ROOT_COMPONENTS_MARKER,
    `${ROOT_COMPONENTS_MARKER}\n${startMarker}\n      ${renderExpression}\n${renderMarker(plugin, "end")}`,
  );
  fs.writeFileSync(appPath, content, "utf8");
  return { modified: true };
}

/** Removes only code delimited or tagged as owned by injectRootComponent(). */
export function removeRootComponent(
  projectRoot: string,
  plugin: PluginMeta,
): { modified: boolean; reason?: string; blocked?: boolean } {
  if (!plugin.rootComponent) return { modified: false, reason: "Plugin sans composant racine" };

  const appPath = path.join(projectRoot, "client/src/App.tsx");
  if (!fs.existsSync(appPath)) {
    return { modified: false, reason: "client/src/App.tsx introuvable" };
  }

  let content = fs.readFileSync(appPath, "utf8");
  const startMarker = renderMarker(plugin, "start");
  const endMarker = renderMarker(plugin, "end");
  const hasStartMarker = content.includes(startMarker);
  const hasEndMarker = content.includes(endMarker);
  const hasOtherOwnedCode = [
    authMarker(plugin, "start"),
    authMarker(plugin, "end"),
    importMarker(plugin, "auth"),
    importMarker(plugin, "component"),
  ].some((marker) => content.includes(marker));
  if (!hasStartMarker && !hasEndMarker && !hasOtherOwnedCode) {
    return { modified: false, reason: "Composant racine généré introuvable" };
  }
  if (!hasStartMarker || !hasEndMarker) {
    return {
      modified: false,
      blocked: true,
      reason: "Bloc du composant racine généré incomplet",
    };
  }
  if (
    plugin.rootComponent.authenticated
    && (!content.includes(authMarker(plugin, "start")) || !content.includes(authMarker(plugin, "end")))
  ) {
    return {
      modified: false,
      blocked: true,
      reason: "Bloc d’authentification généré incomplet",
    };
  }

  content = removeDelimitedBlock(content, startMarker, endMarker);
  if (plugin.rootComponent.authenticated) {
    content = removeDelimitedBlock(content, authMarker(plugin, "start"), authMarker(plugin, "end"));
    content = removeMarkedLine(content, importMarker(plugin, "auth"));
  }
  content = removeMarkedLine(content, importMarker(plugin, "component"));
  content = content.replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(appPath, content, "utf8");
  return { modified: true };
}
