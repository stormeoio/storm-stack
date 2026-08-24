import fs from "node:fs";
import path from "node:path";
import type { PluginMeta } from "./registry";
import {
  findLastStaticImportEnd,
  findNamedImportBinding,
  hasUniqueRuntimeNamedImport,
} from "./static-import-scanner";
import type { RequiredWiringResult } from "./wiring-result";

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

function insertImport(content: string, importLine: string): string {
  const index = findLastStaticImportEnd(content);
  return index === -1
    ? `${importLine}\n${content}`
    : `${content.slice(0, index)}${importLine}\n${content.slice(index)}`;
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
): RequiredWiringResult {
  if (!plugin.rootComponent) {
    return { modified: false, configured: true, reason: "Plugin sans composant racine" };
  }

  const appPath = path.join(projectRoot, "client/src/App.tsx");
  if (!fs.existsSync(appPath)) {
    if (!fs.existsSync(path.join(projectRoot, "client"))) {
      return {
        modified: false,
        configured: true,
        reason: "Projet sans client; montage du composant racine ignoré",
      };
    }
    return { modified: false, configured: false, reason: "client/src/App.tsx introuvable" };
  }

  let content = fs.readFileSync(appPath, "utf8");
  const startMarker = renderMarker(plugin, "start");
  if (content.includes(startMarker)) {
    return rootComponentIsConfigured(content, plugin, mode, pluginsDir)
      ? { modified: false, configured: true, reason: "Composant racine déjà injecté" }
      : {
          modified: false,
          configured: false,
          reason: "Câblage du composant racine incomplet dans App.tsx",
        };
  }
  if (!content.includes(ROOT_COMPONENTS_MARKER)) {
    return {
      modified: false,
      configured: false,
      reason: "Marqueur storm:root-components absent; montez le composant manuellement dans App.tsx",
    };
  }

  const componentName = plugin.rootComponent.exportName;
  const componentSource = mode === "npm"
    ? `${plugin.id}/client`
    : `../../${pluginsDir}/${plugin.shortName}/client`;
  const componentAlreadyImported = hasUniqueRuntimeNamedImport(
    content,
    componentSource,
    componentName,
  );
  if (!componentAlreadyImported && findNamedImportBinding(content, componentName)) {
    return {
      modified: false,
      configured: false,
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
      return {
        modified: false,
        configured: false,
        reason: `Le nom ${helperName} existe déjà dans App.tsx`,
      };
    }
    const useStormAlreadyImported = hasUniqueRuntimeNamedImport(
      content,
      "@stormeoio/react",
      "useStorm",
    );
    if (!useStormAlreadyImported && findNamedImportBinding(content, "useStorm")) {
      return {
        modified: false,
        configured: false,
        reason: "Le nom useStorm est déjà importé depuis une autre source",
      };
    }
    if (!useStormAlreadyImported) {
      content = insertImport(
        content,
        `import { useStorm } from "@stormeoio/react"; // ${importMarker(plugin, "auth")}`,
      );
    }

    const appIndex = content.indexOf("export default function App");
    if (appIndex === -1) {
      return {
        modified: false,
        configured: false,
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
  if (!rootComponentIsConfigured(content, plugin, mode, pluginsDir)) {
    return {
      modified: false,
      configured: false,
      reason: "Impossible de vérifier le câblage du composant racine dans App.tsx",
    };
  }
  fs.writeFileSync(appPath, content, "utf8");
  return { modified: true, configured: true };
}

function rootComponentIsConfigured(
  content: string,
  plugin: PluginMeta,
  mode: "npm" | "copy",
  pluginsDir: string,
): boolean {
  if (!plugin.rootComponent) return true;

  const componentName = plugin.rootComponent.exportName;
  const componentSource = mode === "npm"
    ? `${plugin.id}/client`
    : `../../${pluginsDir}/${plugin.shortName}/client`;
  if (
    !content.includes(renderMarker(plugin, "start"))
    || !content.includes(renderMarker(plugin, "end"))
    || !hasUniqueRuntimeNamedImport(content, componentSource, componentName)
  ) {
    return false;
  }

  if (!plugin.rootComponent.authenticated) {
    return content.includes(`<${componentName} />`);
  }

  const helperName = wrapperName(plugin);
  return content.includes(authMarker(plugin, "start"))
    && content.includes(authMarker(plugin, "end"))
    && hasUniqueRuntimeNamedImport(content, "@stormeoio/react", "useStorm")
    && content.includes(`function ${helperName}`)
    && content.includes(`return user ? <${componentName} /> : null`)
    && content.includes(`<${helperName} />`);
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
