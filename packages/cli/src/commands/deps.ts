import * as p from "@clack/prompts";
import pc from "picocolors";
import { PLUGINS, type PluginMeta } from "../registry";
import { readConfig, findProjectRoot } from "../config";

interface DepsOptions {
  all?: boolean;
  json?: boolean;
}

interface DepNode {
  id: string;
  shortName: string;
  name: string;
  requires: string[];
  dependents: string[];
  depth: number;
  installed: boolean;
  status: "available" | "coming-soon";
}

export async function depsCommand(pluginArg?: string, opts: DepsOptions = {}): Promise<void> {
  const root = findProjectRoot();
  const config = root ? readConfig(root) : null;
  const installedIds = new Set(config?.installed ?? []);

  const pluginMap = new Map<string, PluginMeta>();
  for (const pl of PLUGINS) {
    pluginMap.set(pl.id, pl);
  }

  if (opts.json) {
    const graph = buildGraph(PLUGINS, installedIds, opts.all);
    const topo = topologicalSort(graph);
    const cycles = detectCycles(graph);
    console.log(JSON.stringify({ graph: Object.fromEntries(graph), order: topo, cycles }, null, 2));
    return;
  }

  if (pluginArg) {
    const plugin = pluginMap.get(pluginArg) ?? pluginMap.get(`@stormeoio/${pluginArg}`);
    if (!plugin) {
      p.log.error(`Plugin ${pc.red(pluginArg)} introuvable`);
      process.exit(1);
    }
    printPluginTree(plugin, pluginMap, installedIds);
    return;
  }

  const scope = opts.all ? PLUGINS : PLUGINS.filter((pl) => installedIds.has(pl.id));

  if (scope.length === 0) {
    p.log.info("Aucun plugin installé. Utilisez " + pc.cyan("storm deps --all") + " pour voir tout le catalogue.");
    return;
  }

  const graph = buildGraph(scope, installedIds, opts.all);

  const cycles = detectCycles(graph);
  if (cycles.length > 0) {
    p.log.error(pc.red("Cycles détectés :"));
    for (const cycle of cycles) {
      p.log.error("  " + cycle.map((id) => shortId(id)).join(" → "));
    }
    p.log.info("");
  }

  const topo = topologicalSort(graph);
  printTree(graph, topo, installedIds);

  p.log.info("");
  p.log.info(pc.bold("Ordre de bootstrap :"));
  p.log.info("  " + topo.map((id) => {
    const s = shortId(id);
    return installedIds.has(id) ? pc.green(s) : pc.dim(s);
  }).join(" → "));

  const stats = computeStats(graph, installedIds);
  p.log.info("");
  p.log.info(
    `${pc.dim("Plugins:")} ${stats.installed}/${stats.total} installés  ` +
    `${pc.dim("Profondeur max:")} ${stats.maxDepth}  ` +
    `${pc.dim("Racines:")} ${stats.roots}  ` +
    `${pc.dim("Feuilles:")} ${stats.leaves}`
  );
}

function buildGraph(plugins: PluginMeta[], installedIds: Set<string>, includeAll?: boolean): Map<string, DepNode> {
  const graph = new Map<string, DepNode>();

  const scope = includeAll ? PLUGINS : plugins;
  for (const pl of scope) {
    graph.set(pl.id, {
      id: pl.id,
      shortName: pl.shortName,
      name: pl.name,
      requires: [...pl.requires],
      dependents: [],
      depth: 0,
      installed: installedIds.has(pl.id),
      status: pl.status,
    });
  }

  for (const pl of scope) {
    for (const dep of pl.requires) {
      if (!graph.has(dep)) {
        const meta = PLUGINS.find((p) => p.id === dep);
        if (meta) {
          graph.set(dep, {
            id: dep,
            shortName: meta.shortName,
            name: meta.name,
            requires: [...meta.requires],
            dependents: [],
            depth: 0,
            installed: installedIds.has(dep),
            status: meta.status,
          });
        }
      }
      graph.get(dep)?.dependents.push(pl.id);
    }
  }

  computeDepths(graph);
  return graph;
}

function computeDepths(graph: Map<string, DepNode>): void {
  const visited = new Set<string>();

  function dfs(id: string): number {
    if (visited.has(id)) return graph.get(id)!.depth;
    visited.add(id);
    const node = graph.get(id);
    if (!node || node.requires.length === 0) {
      if (node) node.depth = 0;
      return 0;
    }
    let maxParent = 0;
    for (const dep of node.requires) {
      if (graph.has(dep)) {
        maxParent = Math.max(maxParent, dfs(dep) + 1);
      }
    }
    node.depth = maxParent;
    return maxParent;
  }

  for (const id of graph.keys()) {
    dfs(id);
  }
}

function detectCycles(graph: Map<string, DepNode>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(id: string, path: string[]): void {
    if (stack.has(id)) {
      const cycleStart = path.indexOf(id);
      if (cycleStart !== -1) {
        cycles.push([...path.slice(cycleStart), id]);
      }
      return;
    }
    if (visited.has(id)) return;

    visited.add(id);
    stack.add(id);
    path.push(id);

    const node = graph.get(id);
    if (node) {
      for (const dep of node.requires) {
        if (graph.has(dep)) {
          dfs(dep, [...path]);
        }
      }
    }

    stack.delete(id);
  }

  for (const id of graph.keys()) {
    dfs(id, []);
  }

  return cycles;
}

function topologicalSort(graph: Map<string, DepNode>): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  function visit(id: string): void {
    if (temp.has(id)) return;
    if (visited.has(id)) return;
    temp.add(id);

    const node = graph.get(id);
    if (node) {
      for (const dep of node.requires) {
        if (graph.has(dep)) visit(dep);
      }
    }

    temp.delete(id);
    visited.add(id);
    result.push(id);
  }

  for (const id of graph.keys()) {
    visit(id);
  }

  return result;
}

function printTree(graph: Map<string, DepNode>, order: string[], installedIds: Set<string>): void {
  const roots = order.filter((id) => {
    const node = graph.get(id)!;
    return node.requires.length === 0;
  });

  const printed = new Set<string>();

  for (const rootId of roots) {
    printNodeTree(rootId, graph, installedIds, "", true, printed);
  }

  for (const id of order) {
    if (!printed.has(id)) {
      printNodeTree(id, graph, installedIds, "", true, printed);
    }
  }
}

function printNodeTree(
  id: string,
  graph: Map<string, DepNode>,
  installedIds: Set<string>,
  prefix: string,
  isLast: boolean,
  printed: Set<string>,
): void {
  if (printed.has(id)) return;
  printed.add(id);

  const node = graph.get(id);
  if (!node) return;

  const connector = prefix === "" ? "" : (isLast ? "└── " : "├── ");
  const label = formatNode(node, installedIds);
  p.log.info(`${prefix}${connector}${label}`);

  const children = node.dependents.filter((dep) => graph.has(dep) && !printed.has(dep));
  for (let i = 0; i < children.length; i++) {
    const childPrefix = prefix === "" ? "  " : prefix + (isLast ? "    " : "│   ");
    printNodeTree(children[i]!, graph, installedIds, childPrefix, i === children.length - 1, printed);
  }
}

function printPluginTree(plugin: PluginMeta, pluginMap: Map<string, PluginMeta>, installedIds: Set<string>): void {
  p.log.info(pc.bold(plugin.name) + " " + pc.dim(`(${plugin.id})`));
  p.log.info("");

  if (plugin.requires.length > 0) {
    p.log.info(pc.bold("Dépendances :"));
    for (let i = 0; i < plugin.requires.length; i++) {
      const dep = pluginMap.get(plugin.requires[i]!);
      const isLast = i === plugin.requires.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const installed = installedIds.has(plugin.requires[i]!);
      const badge = installed ? pc.green(" ✓") : pc.dim(" ○");
      const name = dep ? dep.shortName : plugin.requires[i]!;
      p.log.info(`  ${connector}${name}${badge}`);
    }
  } else {
    p.log.info(pc.dim("Aucune dépendance (plugin racine)"));
  }

  const dependents = PLUGINS.filter((pl) => pl.requires.includes(plugin.id));
  if (dependents.length > 0) {
    p.log.info("");
    p.log.info(pc.bold("Dépendants :"));
    for (let i = 0; i < dependents.length; i++) {
      const dep = dependents[i]!;
      const isLast = i === dependents.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const installed = installedIds.has(dep.id);
      const badge = installed ? pc.green(" ✓") : pc.dim(" ○");
      p.log.info(`  ${connector}${dep.shortName}${badge}`);
    }
  }

  p.log.info("");
  const installed = installedIds.has(plugin.id);
  p.log.info(`${pc.dim("Statut :")} ${installed ? pc.green("installé") : plugin.status === "available" ? pc.yellow("disponible") : pc.dim("à venir")}`);
  p.log.info(`${pc.dim("Profondeur :")} ${plugin.requires.length === 0 ? "0 (racine)" : "1"}`);
}

function formatNode(node: DepNode, installedIds: Set<string>): string {
  const name = node.shortName;
  const installed = installedIds.has(node.id);

  let label: string;
  if (installed) {
    label = pc.green(name) + pc.green(" ✓");
  } else if (node.status === "available") {
    label = pc.yellow(name) + pc.dim(" ○");
  } else {
    label = pc.dim(name) + pc.dim(" ◌");
  }

  if (node.dependents.length > 0) {
    label += pc.dim(` (${node.dependents.length} dépendant${node.dependents.length > 1 ? "s" : ""})`);
  }

  return label;
}

function shortId(id: string): string {
  return id.replace("@stormeoio/", "");
}

function computeStats(graph: Map<string, DepNode>, installedIds: Set<string>) {
  let maxDepth = 0;
  let roots = 0;
  let leaves = 0;
  let installed = 0;

  for (const node of graph.values()) {
    if (node.depth > maxDepth) maxDepth = node.depth;
    if (node.requires.length === 0) roots++;
    if (node.dependents.length === 0) leaves++;
    if (installedIds.has(node.id)) installed++;
  }

  return { total: graph.size, installed, maxDepth, roots, leaves };
}
