import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "fs";
import path from "path";
import { findProjectRoot, readConfig } from "../config";

// ─── Plugin catalog (same as manifest-route) ────────────────────────────────

const PLUGIN_META: Record<string, { name: string; icon: string }> = {
  "@stormeoio/auth": { name: "Auth", icon: "🔐" },
  "@stormeoio/auth-social": { name: "Auth Social", icon: "🌐" },
  "@stormeoio/crm": { name: "CRM", icon: "👥" },
  "@stormeoio/ticketing": { name: "Ticketing", icon: "🎫" },
  "@stormeoio/stripe": { name: "Stripe", icon: "💳" },
  "@stormeoio/billing": { name: "Billing", icon: "📄" },
  "@stormeoio/cms": { name: "CMS", icon: "📝" },
  "@stormeoio/messaging": { name: "Messaging", icon: "💬" },
  "@stormeoio/drive": { name: "Drive", icon: "📁" },
  "@stormeoio/monitoring": { name: "Monitoring", icon: "📡" },
};

export async function infoCommand(): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("Aucun projet détecté.");
    process.exit(1);
  }

  const config = readConfig(root);
  if (!config) {
    p.log.error(`Pas de ${pc.cyan("storm.json")} trouvé.`);
    process.exit(1);
  }

  const pkg = readPkg(root);

  console.log();
  console.log(`  ${pc.bold(pkg?.name ?? "storm-app")} ${pc.dim(`v${pkg?.version ?? "0.0.0"}`)}`);
  console.log(`  ${pc.dim(root)}`);
  console.log();

  // ── Plugins ──────────────────────────────────────────────────────────────

  if (config.installed.length === 0) {
    console.log(`  ${pc.dim("Plugins")}  ${pc.yellow("aucun")} — lancez ${pc.cyan("storm add <plugin>")}`);
  } else {
    console.log(`  ${pc.dim("Plugins")}  ${pc.bold(String(config.installed.length))} installé(s)`);
    for (const id of config.installed) {
      const meta = PLUGIN_META[id];
      const icon = meta?.icon ?? "📦";
      const name = meta?.name ?? id.replace("@stormeoio/", "");
      console.log(`           ${icon} ${pc.cyan(name)} ${pc.dim(id)}`);
    }
  }
  console.log();

  // ── Config ──────────────────────────────────────────────────────────────

  console.log(`  ${pc.dim("Server")}   ${config.serverEntry}`);
  console.log(`  ${pc.dim("Plugins")}  ${config.pluginsDir}/`);
  console.log(`  ${pc.dim("Drizzle")}  ${config.drizzleConfig}`);

  // ── Health checks ───────────────────────────────────────────────────────

  console.log();
  const checks = [
    check("storm.json", fs.existsSync(path.join(root, "storm.json"))),
    check("server entry", fs.existsSync(path.join(root, config.serverEntry))),
    check("drizzle config", fs.existsSync(path.join(root, config.drizzleConfig))),
    check("node_modules", fs.existsSync(path.join(root, "node_modules"))),
    check(".env", fs.existsSync(path.join(root, ".env")) || fs.existsSync(path.join(root, ".env.local"))),
    check("client/", fs.existsSync(path.join(root, "client"))),
    check("CLAUDE.md", fs.existsSync(path.join(root, "CLAUDE.md"))),
  ];

  for (const c of checks) {
    console.log(`  ${c}`);
  }
  console.log();
}

function check(label: string, ok: boolean): string {
  return ok
    ? `${pc.green("✓")} ${label}`
    : `${pc.red("✗")} ${label} ${pc.dim("(manquant)")}`;
}

function readPkg(root: string): { name?: string; version?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return null;
  }
}
