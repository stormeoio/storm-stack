import fs from "node:fs";
import path from "node:path";
import { PLUGINS, pluginSourceUrl, type PluginMeta } from "./registry";
import { fetchFile } from "./utils";

export interface PluginCopySource {
  file: string;
  content: string;
}

export type PluginCopySourceReader = (file: string) => Promise<string | null>;

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

/**
 * The declared server/client surfaces plus the conventional package entrypoints.
 * Relative imports are resolved transitively by resolvePluginCopySources().
 */
export function pluginCopyEntryFiles(plugin: PluginMeta): string[] {
  const entries = new Set<string>(["index.ts", ...plugin.files, ...(plugin.clientFiles ?? [])]);
  if ((plugin.clientComponents?.length ?? 0) > 0 || plugin.rootComponent) {
    entries.add("client/index.ts");
  }
  return [...entries].map(normalizeSourcePath).sort();
}

/** Resolves the complete copy surface from entrypoints and local imports. */
export async function resolvePluginCopySources(
  plugin: PluginMeta,
  readSource: PluginCopySourceReader,
): Promise<PluginCopySource[]> {
  const resolved = new Map<string, string>();
  const pending = pluginCopyEntryFiles(plugin);

  while (pending.length > 0) {
    const file = pending.shift()!;
    if (resolved.has(file)) continue;

    const content = await readSource(file);
    if (content === null) {
      throw new Error(`Source copy introuvable pour ${plugin.id}: ${file}`);
    }
    resolved.set(file, content);

    for (const specifier of relativeImportSpecifiers(content)) {
      const dependency = await resolveRelativeSource(file, specifier, readSource);
      if (!dependency) {
        throw new Error(`Import local introuvable dans ${plugin.id}: ${file} -> ${specifier}`);
      }
      if (!resolved.has(dependency)) pending.push(dependency);
    }
  }

  return [...resolved]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, content]) => ({ file, content }));
}

export async function loadLocalPluginCopySources(
  repositoryRoot: string,
  plugin: PluginMeta,
): Promise<PluginCopySource[]> {
  const sourceRoot = path.join(repositoryRoot, "packages", `plugin-${plugin.shortName}`, "src");
  return resolvePluginCopySources(plugin, async (file) => {
    const sourcePath = path.join(sourceRoot, ...file.split("/"));
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) return null;
    return fs.readFileSync(sourcePath, "utf8");
  });
}

export async function loadRemotePluginCopySources(
  plugin: PluginMeta,
): Promise<PluginCopySource[]> {
  const cache = new Map<string, Promise<string | null>>();
  const readRemoteSource: PluginCopySourceReader = (file) => {
    const existing = cache.get(file);
    if (existing) return existing;
    const fetched = fetchFile(pluginSourceUrl(plugin, file)).catch(() => null);
    cache.set(file, fetched);
    return fetched;
  };
  return resolvePluginCopySources(plugin, readRemoteSource);
}

/** Rewrites installed Storm plugin imports to sibling copy directories. */
export function rewriteCopiedPluginImports(
  content: string,
  owner: PluginMeta,
  file: string,
): string {
  const rewrite = (specifier: string): string => {
    const match = /^@stormeoio\/([^/]+)(\/.*)?$/.exec(specifier);
    if (!match) return specifier;
    const dependency = PLUGINS.find((candidate) => candidate.shortName === match[1]);
    if (!dependency) return specifier;

    const fromDirectory = path.posix.dirname(path.posix.join(owner.shortName, file));
    const target = path.posix.join(dependency.shortName, match[2] ?? "");
    const relative = path.posix.relative(fromDirectory, target);
    return relative.startsWith(".") ? relative : `./${relative}`;
  };

  return content
    .replace(
      /(\bfrom\s*)(["'])(@stormeoio\/[^"']+)\2/g,
      (_match, prefix: string, quote: string, specifier: string) => `${prefix}${quote}${rewrite(specifier)}${quote}`,
    )
    .replace(
      /(\b(?:import|require)\s*\(\s*)(["'])(@stormeoio\/[^"']+)\2(\s*\))/g,
      (_match, prefix: string, quote: string, specifier: string, suffix: string) => `${prefix}${quote}${rewrite(specifier)}${quote}${suffix}`,
    )
    .replace(
      /(\bimport\s*)(["'])(@stormeoio\/[^"']+)\2/g,
      (_match, prefix: string, quote: string, specifier: string) => `${prefix}${quote}${rewrite(specifier)}${quote}`,
    );
}

function relativeImportSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)(["'])(\.[^"']+)\1/g;
  for (const match of content.matchAll(pattern)) {
    specifiers.add(match[2]!);
  }
  return [...specifiers];
}

async function resolveRelativeSource(
  ownerFile: string,
  specifier: string,
  readSource: PluginCopySourceReader,
): Promise<string | null> {
  const withoutQuery = specifier.split(/[?#]/, 1)[0]!;
  const base = normalizeSourcePath(path.posix.join(path.posix.dirname(ownerFile), withoutQuery));
  const extension = path.posix.extname(base);
  const candidates = extension
    ? sourceExtensionCandidates(base, extension)
    : [
        ...SOURCE_EXTENSIONS.map((candidateExtension) => `${base}${candidateExtension}`),
        ...SOURCE_EXTENSIONS.map((candidateExtension) => `${base}/index${candidateExtension}`),
      ];

  for (const candidate of candidates) {
    if (await readSource(candidate) !== null) return candidate;
  }
  return null;
}

function sourceExtensionCandidates(file: string, extension: string): string[] {
  if (extension === ".js") return [file, `${file.slice(0, -3)}.ts`, `${file.slice(0, -3)}.tsx`];
  if (extension === ".jsx") return [file, `${file.slice(0, -4)}.tsx`];
  return [file];
}

function normalizeSourcePath(file: string): string {
  const normalized = path.posix.normalize(file.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Chemin source copy hors plugin refusé: ${file}`);
  }
  return normalized;
}
