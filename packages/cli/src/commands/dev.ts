import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { findProjectRoot, readConfig } from "../config";

// ─── Port defaults ───────────────────────────────────────────────────────────

const DEFAULT_SERVER_PORT = 3000;
const DEFAULT_CLIENT_PORT = 5173;

// ─── storm dev — unified dev server ──────────────────────────────────────────

export interface DevOptions {
  port?: number;
  clientPort?: number;
  noClient?: boolean;
}

export async function devCommand(opts: DevOptions = {}): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("Aucun projet détecté (pas de package.json trouvé).");
    process.exit(1);
  }

  const config = readConfig(root);
  if (!config) {
    p.log.error(
      `Pas de ${pc.cyan("storm.json")} trouvé. Lancez ${pc.cyan("storm init")} d'abord.`,
    );
    process.exit(1);
  }

  const serverEntry = path.join(root, config.serverEntry);
  if (!fs.existsSync(serverEntry)) {
    p.log.error(`Point d'entrée serveur introuvable : ${pc.dim(serverEntry)}`);
    process.exit(1);
  }

  const serverPort = opts.port ?? DEFAULT_SERVER_PORT;
  const clientPort = opts.clientPort ?? DEFAULT_CLIENT_PORT;
  const hasClient = !opts.noClient && hasClientDir(root);

  // ── Banner ───────────────────────────────────────────────────────────────

  console.log();
  console.log(
    `  ${pc.bgCyan(pc.black(" ⚡ storm dev "))} ${pc.dim("v0.1.0")}`,
  );
  console.log();

  if (config.installed.length > 0) {
    const pluginList = config.installed
      .map((id) => pc.cyan(id.replace("@stormstack/", "")))
      .join(pc.dim(", "));
    console.log(`  ${pc.dim("Plugins")}  ${pluginList}`);
  }

  console.log(
    `  ${pc.dim("Server")}   ${pc.green(`http://localhost:${serverPort}`)}`,
  );
  if (hasClient) {
    console.log(
      `  ${pc.dim("Client")}   ${pc.green(`http://localhost:${clientPort}`)} ${pc.dim("→ proxy /api")}`,
    );
  }
  console.log();

  // ── Spawn server (tsx watch) ─────────────────────────────────────────────

  const serverProc = spawnServer(root, config.serverEntry, serverPort);

  // ── Spawn client (vite) ──────────────────────────────────────────────────

  let clientProc: ChildProcess | null = null;
  if (hasClient) {
    // Small delay to let the server start first (cleaner logs)
    await sleep(500);
    clientProc = spawnClient(root, clientPort, serverPort);
  }

  // ── Graceful shutdown ────────────────────────────────────────────────────

  const cleanup = () => {
    console.log(`\n  ${pc.dim("Arrêt…")}`);
    serverProc.kill("SIGTERM");
    clientProc?.kill("SIGTERM");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // ── Wait for exit ────────────────────────────────────────────────────────

  serverProc.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.log(
        `\n  ${pc.red("✗")} Serveur crash (code ${code}). Redémarrage par tsx watch…`,
      );
    }
  });
}

// ─── Server spawner (tsx watch) ──────────────────────────────────────────────

function spawnServer(
  root: string,
  entry: string,
  port: number,
): ChildProcess {
  // Resolve tsx from the project's node_modules
  const tsxBin = resolveBin(root, "tsx");

  const proc = spawn(tsxBin, ["watch", "--clear-screen=false", entry], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "development",
      FORCE_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Prefix server output
  prefixOutput(proc, pc.cyan("server"));

  return proc;
}

// ─── Client spawner (vite dev) ───────────────────────────────────────────────

function spawnClient(
  root: string,
  clientPort: number,
  serverPort: number,
): ChildProcess {
  const viteBin = resolveBin(root, "vite");

  const proc = spawn(
    viteBin,
    ["--port", String(clientPort), "--strictPort"],
    {
      cwd: root,
      env: {
        ...process.env,
        FORCE_COLOR: "1",
        // Vite proxy target (used if vite.config references process.env)
        STORM_API_URL: `http://localhost:${serverPort}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  prefixOutput(proc, pc.magenta("client"));

  return proc;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hasClientDir(root: string): boolean {
  // Check common client entry points
  return (
    fs.existsSync(path.join(root, "client")) ||
    fs.existsSync(path.join(root, "vite.config.ts")) ||
    fs.existsSync(path.join(root, "vite.config.js"))
  );
}

function resolveBin(root: string, name: string): string {
  // Try project-local first, then fallback to npx-style
  const candidates = [
    path.join(root, "node_modules", ".bin", name),
    name, // fallback to PATH
  ];
  for (const bin of candidates) {
    if (bin === name) return bin; // PATH fallback always "works" (may fail at spawn)
    if (fs.existsSync(bin)) return bin;
  }
  return name;
}

function prefixOutput(proc: ChildProcess, prefix: string): void {
  const tag = `  ${pc.dim("│")} ${prefix} ${pc.dim("│")} `;

  proc.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        process.stdout.write(`${tag}${line}\n`);
      }
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        process.stderr.write(`${tag}${line}\n`);
      }
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
