import fs from "fs";
import path from "path";
import { execSync } from "child_process";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export function detectPackageManager(root: string): PackageManager {
  if (fs.existsSync(path.join(root, "bun.lockb"))) return "bun";
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

export function installCommand(pm: PackageManager): string {
  return pm === "yarn" ? "yarn add" : `${pm} install`;
}

export function installDevCommand(pm: PackageManager): string {
  if (pm === "yarn") return "yarn add -D";
  if (pm === "pnpm") return "pnpm add -D";
  if (pm === "bun") return "bun add -d";
  return "npm install -D";
}

export function runInstall(root: string, pm: PackageManager, packages: string[], dev: boolean = false): void {
  if (packages.length === 0) return;
  const cmd = dev ? installDevCommand(pm) : installCommand(pm);
  execSync(`${cmd} ${packages.join(" ")}`, { cwd: root, stdio: "pipe" });
}

export function uninstallCommand(pm: PackageManager): string {
  if (pm === "yarn") return "yarn remove";
  if (pm === "pnpm") return "pnpm remove";
  if (pm === "bun") return "bun remove";
  return "npm uninstall";
}

export function runUninstall(root: string, pm: PackageManager, packages: string[]): void {
  if (packages.length === 0) return;
  const cmd = uninstallCommand(pm);
  execSync(`${cmd} ${packages.join(" ")}`, { cwd: root, stdio: "pipe" });
}

export async function fetchFile(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url} (${res.status})`);
  return res.text();
}

export function readLocalFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

export function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export function removeDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}
