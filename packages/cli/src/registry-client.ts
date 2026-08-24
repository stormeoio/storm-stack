import { PLUGINS, type PluginMeta } from "./registry";
import { readConfig, findProjectRoot } from "./config";

// ── Remote registry types ───────────────────────────────────────────────────

export interface RegistryEntry {
  id: string;
  name: string;
  shortName: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  requires: string[];
  status: "available" | "coming-soon";
  npmPackage: string;
}

export interface RegistryPayload {
  version: number;
  updatedAt: string;
  plugins: RegistryEntry[];
}

export interface MergedPlugin {
  id: string;
  shortName: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags: string[];
  requires: string[];
  status: "available" | "coming-soon";
  source: "local" | "remote" | "both";
  installed: boolean;
}

// ── In-memory cache ─────────────────────────────────────────────────────────

let cachedRegistry: RegistryEntry[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Fetch remote registry ───────────────────────────────────────────────────

/**
 * Fetches the remote plugin registry. Returns cached data if fresh enough.
 * Falls back to empty array on network failure (offline-friendly).
 */
export async function fetchRegistry(registryUrl?: string): Promise<RegistryEntry[]> {
  // Return cache if still fresh
  if (cachedRegistry && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedRegistry;
  }

  // Resolve registry URL from storm.json or use default
  const url = registryUrl ?? resolveRegistryUrl();
  if (!url) return [];

  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as RegistryPayload;
    if (!data.plugins || !Array.isArray(data.plugins)) return [];
    cachedRegistry = data.plugins;
    cacheTimestamp = Date.now();
    return cachedRegistry;
  } catch {
    // Offline or registry down — degrade gracefully
    return [];
  }
}

function resolveRegistryUrl(): string | null {
  const root = findProjectRoot();
  if (!root) return null;
  const config = readConfig(root);
  return config?.registry || null;
}

// ── Merge local + remote ────────────────────────────────────────────────────

/**
 * Merges the hardcoded PLUGINS array with remote registry entries.
 * Local metadata takes precedence for install mechanics (files, deps, etc.).
 * Remote adds version, author, tags, and any community plugins.
 */
export function mergePlugins(remote: RegistryEntry[], installedIds: Set<string>): MergedPlugin[] {
  const localById = new Map(PLUGINS.map((p) => [p.id, p]));
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const allIds = new Set([...localById.keys(), ...remoteById.keys()]);

  const merged: MergedPlugin[] = [];

  for (const id of allIds) {
    const local = localById.get(id);
    const rem = remoteById.get(id);

    merged.push({
      id,
      shortName: local?.shortName ?? rem?.shortName ?? id.replace("@stormeoio/", ""),
      name: local?.name ?? rem?.name ?? id,
      description: local?.description ?? rem?.description ?? "",
      version: rem?.version,
      author: rem?.author,
      tags: rem?.tags ?? [],
      requires: local?.requires ?? rem?.requires ?? [],
      status: local?.status ?? rem?.status ?? "coming-soon",
      source: local && rem ? "both" : local ? "local" : "remote",
      installed: installedIds.has(id),
    });
  }

  // Sort: available first, then alphabetical
  merged.sort((a, b) => {
    if (a.status !== b.status) return a.status === "available" ? -1 : 1;
    return a.shortName.localeCompare(b.shortName);
  });

  return merged;
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * Searches merged plugins by query string.
 * Matches against name, shortName, description, tags, and id.
 * Returns results sorted by relevance score.
 */
export function searchPlugins(query: string, plugins: MergedPlugin[]): MergedPlugin[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return plugins;

  const scored = plugins.map((p) => {
    let score = 0;
    const haystack = [
      p.shortName.toLowerCase(),
      p.name.toLowerCase(),
      p.description.toLowerCase(),
      p.id.toLowerCase(),
      ...p.tags.map((t) => t.toLowerCase()),
    ];

    for (const term of terms) {
      // Exact shortName match — highest signal
      if (p.shortName.toLowerCase() === term) { score += 100; continue; }
      // Exact tag match
      if (p.tags.some((t) => t.toLowerCase() === term)) { score += 50; continue; }
      // Name starts with term
      if (p.name.toLowerCase().startsWith(term)) { score += 30; continue; }
      // Substring match in any field
      if (haystack.some((h) => h.includes(term))) { score += 10; continue; }
    }

    return { plugin: p, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.plugin);
}

// ── Publish helper ──────────────────────────────────────────────────────────

/**
 * Generates a registry entry from a local plugin directory.
 * Used by `storm publish` to create the JSON that gets added to registry.json.
 */
export function generateRegistryEntry(
  pluginMeta: PluginMeta,
  version: string,
  author: string,
  tags: string[],
): RegistryEntry {
  return {
    id: pluginMeta.id,
    name: pluginMeta.name,
    shortName: pluginMeta.shortName,
    description: pluginMeta.description,
    version,
    author,
    tags,
    requires: pluginMeta.requires,
    status: pluginMeta.status,
    npmPackage: pluginMeta.id,
  };
}
