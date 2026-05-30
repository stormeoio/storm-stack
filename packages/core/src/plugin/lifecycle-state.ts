import fs from "fs";
import path from "path";

const LIFECYCLE_FILENAME = "storm-lifecycle.json";

interface LifecycleState {
  version: 1;
  installed: string[];
}

let state: LifecycleState = { version: 1, installed: [] };
let statePath: string | null = null;

export function initLifecycleState(projectRoot: string): void {
  statePath = path.join(projectRoot, LIFECYCLE_FILENAME);
  state = { version: 1, installed: [] };
  if (fs.existsSync(statePath)) {
    try {
      const raw = fs.readFileSync(statePath, "utf8");
      state = JSON.parse(raw);
    } catch {
      state = { version: 1, installed: [] };
    }
  }
}

export function isPluginInstalled(pluginId: string): boolean {
  return state.installed.includes(pluginId);
}

export function markPluginInstalled(pluginId: string): void {
  if (!state.installed.includes(pluginId)) {
    state.installed.push(pluginId);
    persistState();
  }
}

export function markPluginUninstalled(pluginId: string): void {
  state.installed = state.installed.filter((id) => id !== pluginId);
  persistState();
}

export function getInstalledPluginIds(): string[] {
  return [...state.installed];
}

function persistState(): void {
  if (!statePath) return;
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // best-effort
  }
}
