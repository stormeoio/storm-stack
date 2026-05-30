import fs from "fs";
import path from "path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { findProjectRoot, readConfig } from "../config";
import { PLUGINS } from "../registry";

interface DockerOptions {
  yes?: boolean;
  port?: number;
  pgVersion?: string;
}

export async function dockerCommand(opts: DockerOptions = {}): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("Aucun projet Storm Stack trouvé. Lancez " + pc.cyan("storm init") + " d'abord.");
    process.exit(1);
  }

  const config = readConfig(root);
  if (!config) {
    p.log.error("Fichier " + pc.dim("storm.json") + " introuvable.");
    process.exit(1);
  }

  const port = opts.port ?? 3000;
  const pgVersion = opts.pgVersion ?? "16";
  const installedPlugins = config.installed
    .map((id) => PLUGINS.find((pl) => pl.id === id))
    .filter(Boolean);

  const envVars = collectEnvVars(installedPlugins);
  const projectName = readProjectName(root);

  const files: { name: string; content: string; exists: boolean }[] = [
    {
      name: "Dockerfile",
      content: renderDockerfile(port),
      exists: fs.existsSync(path.join(root, "Dockerfile")),
    },
    {
      name: "docker-compose.yml",
      content: renderDockerCompose(projectName, port, pgVersion, envVars),
      exists: fs.existsSync(path.join(root, "docker-compose.yml")),
    },
    {
      name: ".dockerignore",
      content: renderDockerignore(),
      exists: fs.existsSync(path.join(root, ".dockerignore")),
    },
    {
      name: ".env.example",
      content: renderEnvExample(envVars, port),
      exists: fs.existsSync(path.join(root, ".env.example")),
    },
  ];

  const existingFiles = files.filter((f) => f.exists);
  if (existingFiles.length > 0 && !opts.yes) {
    p.log.warn("Fichiers existants qui seront écrasés :");
    for (const f of existingFiles) {
      p.log.warn(`  ${pc.dim("•")} ${f.name}`);
    }
    const confirmed = await p.confirm({
      message: "Écraser ces fichiers ?",
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Annulé.");
      return;
    }
  }

  const spinner = p.spinner();
  spinner.start("Génération des fichiers Docker…");

  for (const file of files) {
    fs.writeFileSync(path.join(root, file.name), file.content, "utf8");
  }

  spinner.stop(`${pc.green("✓")} Fichiers Docker générés`);

  p.log.info("");
  p.log.info(pc.bold("Fichiers créés :"));
  for (const file of files) {
    p.log.info(`  ${pc.cyan("•")} ${file.name}${file.exists ? pc.dim(" (écrasé)") : ""}`);
  }

  p.log.info("");
  p.log.info(pc.bold("Prochaines étapes :"));
  p.log.info(`  ${pc.cyan("1.")} cp .env.example .env`);
  p.log.info(`  ${pc.cyan("2.")} Éditez .env avec vos vraies valeurs`);
  p.log.info(`  ${pc.cyan("3.")} docker compose up -d`);
  p.log.info(`  ${pc.cyan("4.")} docker compose exec app storm migrate run`);
  p.log.info(`  ${pc.cyan("5.")} Ouvrez http://localhost:${port}`);
}

// ── Renderers ───────────────────────────────────────────────────────────────

function renderDockerfile(port: number): string {
  return `# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Dependencies first (cached layer)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Source + build
COPY . .
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# ── Production stage ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Non-root user
RUN addgroup -g 1001 storm && adduser -u 1001 -G storm -s /bin/sh -D storm

# Copy built artifacts + production deps
COPY --from=builder --chown=storm:storm /app/dist ./dist
COPY --from=builder --chown=storm:storm /app/node_modules ./node_modules
COPY --from=builder --chown=storm:storm /app/package.json ./
COPY --from=builder --chown=storm:storm /app/drizzle ./drizzle

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD wget -qO- http://localhost:${port}/api/health || exit 1

USER storm
EXPOSE ${port}
ENV NODE_ENV=production
ENV PORT=${port}

CMD ["node", "dist/server/index.js"]
`;
}

function renderDockerCompose(projectName: string, port: number, pgVersion: string, envVars: EnvVar[]): string {
  const envLines = envVars.map((v) => `      ${v.key}: \${${v.key}}`).join("\n");

  return `services:
  # ── PostgreSQL ──────────────────────────────────────────────────────────────
  postgres:
    image: postgres:${pgVersion}-alpine
    restart: unless-stopped
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: ${projectName}
      POSTGRES_USER: \${POSTGRES_USER:-storm}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-storm} -d ${projectName}"]
      interval: 5s
      timeout: 3s
      retries: 5

  # ── Storm Stack app ────────────────────────────────────────────────────────
  app:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "\${PORT:-${port}}:${port}"
    environment:
      NODE_ENV: production
      PORT: ${port}
      DATABASE_URL: postgresql://\${POSTGRES_USER:-storm}:\${POSTGRES_PASSWORD}@postgres:5432/${projectName}
${envLines}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:${port}/api/health"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3

volumes:
  pgdata:
`;
}

function renderDockerignore(): string {
  return `node_modules
dist
.git
.env
.env.local
*.log
.DS_Store
.turbo
coverage
.test-fixtures
drizzle/*.sql
`;
}

function renderEnvExample(envVars: EnvVar[], port: number): string {
  const lines: string[] = [
    "# ── Storm Stack — Environment Variables ──────────────────────────────────────",
    "",
    "# Database",
    "POSTGRES_USER=storm",
    "POSTGRES_PASSWORD=change-me-strong-password",
    `POSTGRES_PORT=5432`,
    `DATABASE_URL=postgresql://storm:change-me-strong-password@localhost:5432/storm-app`,
    "",
    "# Server",
    `PORT=${port}`,
    "NODE_ENV=production",
    "",
  ];

  const grouped = groupEnvVars(envVars);
  for (const [plugin, vars] of Object.entries(grouped)) {
    lines.push(`# ${plugin}`);
    for (const v of vars) {
      const comment = v.description ? ` # ${v.description}` : "";
      const value = v.example ?? (v.required ? "REQUIRED" : "");
      lines.push(`${v.key}=${value}${comment}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface EnvVar {
  key: string;
  description: string;
  required: boolean;
  example?: string;
  plugin: string;
}

function collectEnvVars(plugins: (typeof PLUGINS[number] | undefined)[]): EnvVar[] {
  const vars: EnvVar[] = [];
  const seen = new Set<string>();

  for (const plugin of plugins) {
    if (!plugin?.envVars) continue;
    for (const [key, meta] of Object.entries(plugin.envVars)) {
      if (seen.has(key)) continue;
      seen.add(key);
      vars.push({
        key,
        description: meta.description,
        required: meta.required,
        example: meta.example,
        plugin: plugin.name,
      });
    }
  }

  return vars;
}

function groupEnvVars(vars: EnvVar[]): Record<string, EnvVar[]> {
  const groups: Record<string, EnvVar[]> = {};
  for (const v of vars) {
    const group = groups[v.plugin] ?? (groups[v.plugin] = []);
    group.push(v);
  }
  return groups;
}

function readProjectName(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return (pkg.name ?? "storm-app").replace(/^@[^/]+\//, "").replace(/[^a-z0-9-]/g, "-");
  } catch {
    return "storm-app";
  }
}
