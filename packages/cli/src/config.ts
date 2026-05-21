import fs from "fs";
import path from "path";

export interface StormConfig {
  version: number;
  pluginsDir: string;
  serverEntry: string;
  drizzleConfig: string;
  registry: string;
  installed: string[];
}

const CONFIG_FILE = "storm.json";

const DEFAULT_CONFIG: StormConfig = {
  version: 1,
  pluginsDir: "plugins",
  serverEntry: "server/index.ts",
  drizzleConfig: "drizzle.config.ts",
  registry: "https://raw.githubusercontent.com/stormeoio/storm-stack/main/registry.json",
  installed: [],
};

export function findProjectRoot(from: string = process.cwd()): string | null {
  let dir = from;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE)) || fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

export function configPath(root: string): string {
  return path.join(root, CONFIG_FILE);
}

export function readConfig(root: string): StormConfig | null {
  const file = configPath(root);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return { ...DEFAULT_CONFIG, ...raw };
}

export function writeConfig(root: string, config: StormConfig): void {
  fs.writeFileSync(configPath(root), JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function createDefaultConfig(): StormConfig {
  return { ...DEFAULT_CONFIG };
}
