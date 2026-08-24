import fs from "fs";
import path from "path";
import type { ScaffoldOptions } from "./prompts";
import { STORM_PACKAGE_RANGE } from "./version";
import { selectGeneratedPluginDefinitions } from "./generated-plugin-definitions";

const selectedPluginDefinitions = (plugins: string[]) =>
  selectGeneratedPluginDefinitions(plugins);
const hasPlugin = (plugins: string[], id: string) =>
  selectedPluginDefinitions(plugins).some((definition) => definition.id === id);
const hasAuth = (plugins: string[]) => hasPlugin(plugins, "@stormeoio/auth");
const hasCrm = (plugins: string[]) => hasPlugin(plugins, "@stormeoio/crm");
const hasTicketing = (plugins: string[]) => hasPlugin(plugins, "@stormeoio/ticketing");
const hasStripe = (plugins: string[]) => hasPlugin(plugins, "@stormeoio/stripe");
const hasConsent = (plugins: string[]) => hasPlugin(plugins, "@stormeoio/consent");

export const SESSION_SECRET_PLACEHOLDER = "change-me-to-a-random-32-char-secret-minimum";
export const SESSION_SECRET_SETUP_SCRIPT =
  `const fs=require('node:fs'),crypto=require('node:crypto'),file='.env',` +
  `placeholder='SESSION_SECRET=${SESSION_SECRET_PLACEHOLDER}',env=fs.readFileSync(file,'utf8');` +
  "if(env.indexOf(placeholder)<0)throw new Error('SESSION_SECRET placeholder not found');" +
  "fs.writeFileSync(file,env.replace(placeholder,'SESSION_SECRET='+crypto.randomBytes(32).toString('hex')))";
export const SESSION_SECRET_SETUP_COMMAND = `node -e "${SESSION_SECRET_SETUP_SCRIPT}"`;

function write(targetDir: string, file: string, content: string) {
  const filePath = path.join(targetDir, file);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

// ─── Server files ────────────────────────────────────────────────────────────

function renderRootPackageJson(opts: ScaffoldOptions): string {
  const scripts: Record<string, string> = {
    dev: "storm dev",
    "dev:server": "tsx watch server/index.ts",
    build: opts.withClient
      ? "tsc --noEmit -p server/tsconfig.json && tsc --noEmit -p client/tsconfig.json && tsc -p server/tsconfig.json && vite build"
      : "tsc --noEmit -p server/tsconfig.json && tsc -p server/tsconfig.json",
    start: "node dist/server/index.js",
    "db:push": "drizzle-kit push",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    typecheck: opts.withClient
      ? "tsc --noEmit -p server/tsconfig.json && tsc --noEmit -p client/tsconfig.json"
      : "tsc --noEmit -p server/tsconfig.json",
    info: "storm info",
  };

  if (!opts.withClient) {
    scripts["dev"] = "storm dev --no-client";
    delete scripts["dev:client"];
  } else {
    scripts["dev:client"] = "vite";
  }

  const deps: Record<string, string> = {
    "@stormeoio/core": STORM_PACKAGE_RANGE,
    cors: "^2.8.5",
    dotenv: "^16.4.0",
    "drizzle-orm": "^0.45.2",
    express: "^5.0.0",
    pg: "^8.13.0",
    zod: "^3.22.0",
  };

  for (const plugin of selectedPluginDefinitions(opts.plugins)) {
    deps[plugin.id] = STORM_PACKAGE_RANGE;
  }

  const devDeps: Record<string, string> = {
    "@stormeoio/cli": STORM_PACKAGE_RANGE,
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^20.19.0",
    "@types/pg": "^8.11.0",
    "drizzle-kit": "^0.31.10",
    tsx: "^4.0.0",
    typescript: "^5.4.0",
  };

  if (opts.withClient) {
    deps["react"] = "^18.3.0";
    deps["react-dom"] = "^18.3.0";
    deps["@stormeoio/react"] = STORM_PACKAGE_RANGE;
    deps["@tanstack/react-query"] = "^5.0.0";
    deps["wouter"] = "^3.3.0";
    deps["clsx"] = "^2.1.0";
    deps["lucide-react"] = "^0.400.0";
    devDeps["@types/react"] = "^18.3.0";
    devDeps["@types/react-dom"] = "^18.3.0";
    devDeps["@vitejs/plugin-react"] = "^6.0.2";
    devDeps["autoprefixer"] = "^10.4.0";
    devDeps["postcss"] = "^8.4.0";
    devDeps["tailwindcss"] = "^3.4.0";
    devDeps["vite"] = "^8.0.14";
  }

  return JSON.stringify(
    {
      name: opts.projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      engines: { node: ">=20.19.0" },
      scripts,
      dependencies: deps,
      devDependencies: devDeps,
    },
    null,
    2
  );
}

function renderServerTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        lib: ["ES2022"],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        outDir: "../dist/server",
        rootDir: ".",
        resolveJsonModule: true,
      },
      include: ["./**/*.ts"],
      exclude: ["node_modules"],
    },
    null,
    2
  );
}

function renderEnvExample(opts: ScaffoldOptions): string {
  const lines = [
    `COMPOSE_PROJECT_NAME=${opts.projectName}`,
    "POSTGRES_DB=stormapp",
    "POSTGRES_PORT=5432",
    "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/stormapp",
    "NODE_ENV=development",
    "PORT=3000",
    "CLIENT_PORT=5173",
    "APP_ORIGIN=http://localhost:5173",
    `SESSION_SECRET=${SESSION_SECRET_PLACEHOLDER}`,
  ];
  for (const plugin of selectedPluginDefinitions(opts.plugins)) {
    lines.push(...(plugin.envLines ?? []));
  }
  return lines.join("\n") + "\n";
}

function renderAppOriginModule(): string {
  return `export function normalizeAppOrigin(value: string | undefined): string {
  if (!value || value !== value.trim()) {
    return "";
  }

  try {
    const url = new URL(value);
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    const isBareOrigin = url.href === \`\${url.origin}/\`;

    if (!isHttp || url.username || url.password || !isBareOrigin) {
      return "";
    }

    return url.origin;
  } catch {
    return "";
  }
}
`;
}

function renderServerIndex(opts: ScaffoldOptions): string {
  const imports: string[] = [
    `import "dotenv/config";`,
    `import express from "express";`,
    `import cors from "cors";`,
    `import { drizzle } from "drizzle-orm/node-postgres";`,
    `import { Pool } from "pg";`,
    `import { registry, bootstrapPlugins, eventBus } from "@stormeoio/core";`,
    `import type { StormContext, StormEnv } from "@stormeoio/core";`,
    `import { createCsrfProtection } from "@stormeoio/core/csrf";`,
    `import { normalizeAppOrigin } from "./app-origin.js";`,
  ];
  const selectedPlugins = selectedPluginDefinitions(opts.plugins);
  imports.push(...selectedPlugins.flatMap((plugin) => plugin.serverImports));
  const registrations = selectedPlugins.map((plugin) => plugin.registration);

  const jsonParser = hasStripe(opts.plugins)
    ? `express.json({
    verify: (req, _res, buf) => {
      const request = req as Request & { rawBody?: Buffer };
      if (request.originalUrl.startsWith("/api/stripe/webhook")) {
        request.rawBody = Buffer.from(buf);
      }
    },
  })`
    : `express.json()`;

  return `${imports.join("\n")}

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const APP_ORIGIN = normalizeAppOrigin(process.env["APP_ORIGIN"]);
const SESSION_SECRET_PLACEHOLDER = "${SESSION_SECRET_PLACEHOLDER}";

const env: StormEnv = {
  DATABASE_URL: process.env["DATABASE_URL"] ?? "",
  SESSION_SECRET: process.env["SESSION_SECRET"] ?? "",
  APP_ORIGIN,
  NODE_ENV: (process.env["NODE_ENV"] as StormEnv["NODE_ENV"]) ?? "development",
};

if (
  !env.DATABASE_URL
  || !APP_ORIGIN
  || env.SESSION_SECRET.length < 32
  || env.SESSION_SECRET === SESSION_SECRET_PLACEHOLDER
) {
  console.error("DATABASE_URL, APP_ORIGIN and a non-placeholder SESSION_SECRET (min 32 chars) are required");
  process.exit(1);
}

const pool = new Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool);
const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(\`[info] \${msg}\`, meta ?? ""),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(\`[warn] \${msg}\`, meta ?? ""),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(\`[error] \${msg}\`, meta ?? ""),
};

const ctx: StormContext = { db, env, logger, events: eventBus };

${registrations.join("\n")}
async function main() {
  const app = express();
  app.use(cors({ origin: APP_ORIGIN, credentials: true }));
  app.use(${jsonParser});

  const csrf = createCsrfProtection({
    secret: env.SESSION_SECRET,
    allowedOrigins: [APP_ORIGIN],
    secure: env.NODE_ENV === "production",
  });
  app.get("/api/storm/csrf", csrf.issueToken);
  app.use((req, res, next) => {
    if (${hasStripe(opts.plugins) ? `req.method === "POST" && req.path === "/api/stripe/webhook"` : "false"}) return next();
    return csrf.protect(req, res, next);
  });

  await bootstrapPlugins({
    app,
    ctx,${hasAuth(opts.plugins) ? '\n    requireAdmin: createDatabaseRoleGuard(db, "admin"),' : ""}
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.listen(PORT, () => {
    console.log(\`[storm-stack] Server running on http://localhost:\${PORT}\`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
`;
}

function renderDrizzleConfig(opts: ScaffoldOptions): string {
  const schemas = selectedPluginDefinitions(opts.plugins)
    .flatMap((plugin) => (plugin.schemaPath ? [JSON.stringify(plugin.schemaPath)] : []));

  return `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [${schemas.join(", ")}],
  out: "./drizzle",
  dbCredentials: {
    url: process.env["DATABASE_URL"]!,
  },
});
`;
}

function renderDockerCompose(opts: ScaffoldOptions): string {
  return `name: \${COMPOSE_PROJECT_NAME:-${opts.projectName}}

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: \${POSTGRES_DB:-stormapp}
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
`;
}

// ─── Client files ────────────────────────────────────────────────────────────

function renderViteConfig(): string {
  return `import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const clientPort = Number.parseInt(env["CLIENT_PORT"] ?? "5173", 10);
  const serverPort = Number.parseInt(env["PORT"] ?? "3000", 10);

  return {
    plugins: [react()],
    root: "client",
    envDir: ".",
    resolve: {
      alias: { "@": path.resolve(__dirname, "client/src") },
    },
    server: {
      port: clientPort,
      strictPort: true,
      proxy: {
        "/api": { target: \`http://localhost:\${serverPort}\`, changeOrigin: true },
      },
    },
    build: {
      outDir: "../dist/client",
      emptyOutDir: true,
    },
  };
});
`;
}

function renderTailwindConfig(): string {
  return `/** @type {import('tailwindcss').Config} */
export default {
  content: ["./client/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        storm: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#1d4ed8",
          700: "#1e40af",
          800: "#1e3a8a",
          900: "#1e3050",
        },
      },
    },
  },
  plugins: [],
};
`;
}

function renderPostcssConfig(): string {
  return `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;
}

function renderIndexHtml(opts: ScaffoldOptions): string {
  return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${opts.projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function renderMainTsx(): string {
  return `import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StormProvider } from "@stormeoio/react";
import App from "./App";
import { STORM_COMPONENTS } from "./storm-components";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <StormProvider components={STORM_COMPONENTS}>
        <App />
      </StormProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
`;
}

function renderIndexCss(): string {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
`;
}

function renderApiLib(): string {
  return `import { csrfFetch } from "@stormeoio/core/csrf-client";

const BASE = "/api";
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? "GET";
  const transport = MUTATION_METHODS.has(method) ? csrfFetch : fetch;
  const res = await transport(\`\${BASE}\${path}\`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? \`HTTP \${res.status}\`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
`;
}

function renderAppTsx(opts: ScaffoldOptions): string {
  const hasAuthPlugin = hasAuth(opts.plugins);
  const hasConsentPlugin = hasConsent(opts.plugins);

  return `import { Route } from "wouter";
import { StormLayout, StormRouter } from "@stormeoio/react";
${hasConsentPlugin ? `import { useStorm } from "@stormeoio/react"; // storm:root-auth-import @stormeoio/consent\n` : ""}import { useQueryClient } from "@tanstack/react-query";
import { api } from "./lib/api";
import { DashboardPage } from "./pages/DashboardPage";
${hasAuthPlugin ? `import { LoginPage } from "./pages/LoginPage";\n` : ""}
${hasConsentPlugin ? `import { ConsentBanner } from "@stormeoio/consent/client"; // storm:root-component-import @stormeoio/consent\n` : ""}
${hasConsentPlugin ? `/* storm:root-auth @stormeoio/consent:start */
function StormRootConsentBanner() {
  const { user } = useStorm();
  return user ? <ConsentBanner /> : null;
}
/* storm:root-auth @stormeoio/consent:end */

` : ""}export default function App() {
  const qc = useQueryClient();

  const handleLogout = async () => {
    await api.post("/auth/logout", {});
    await qc.invalidateQueries({ queryKey: ["storm", "auth"] });
    window.location.href = "/login";
  };

  return (
    <>
      <StormLayout
        appName="${opts.projectName}"
        version="0.1.0"
        onLogout={handleLogout}
        navProps={{
          prepend: [{ id: "dashboard", label: "Dashboard", icon: "LayoutDashboard", path: "/" }],
        }}
      >
        <StormRouter loginPath="/login">
          <Route path="/" component={DashboardPage} />
${hasAuthPlugin ? `          <Route path="/login" component={LoginPage} />\n` : ""}        </StormRouter>
      </StormLayout>
      {/* storm:root-components */}
${hasConsentPlugin ? `      {/* storm:root-component @stormeoio/consent:start */}\n      <StormRootConsentBanner />\n      {/* storm:root-component @stormeoio/consent:end */}\n` : ""}    </>
  );
}
`;
}

function renderDashboardPage(opts: ScaffoldOptions): string {
  return `import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function DashboardPage() {
  const { data } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<{ ok: boolean; uptime: number }>("/health"),
  });

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Statut</p>
          <p className="text-lg font-semibold text-green-600 mt-1">{data?.ok ? "En ligne" : "…"}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Uptime</p>
          <p className="text-lg font-semibold text-gray-900 mt-1">{data?.uptime ? \`\${Math.floor(data.uptime)}s\` : "…"}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Plugins</p>
          <p className="text-lg font-semibold text-gray-900 mt-1">${selectedPluginDefinitions(opts.plugins).length}</p>
        </div>
      </div>
    </div>
  );
}
`;
}

function renderLoginPage(): string {
  return `import { useState } from "react";
import { api } from "../lib/api";
import { useQueryClient } from "@tanstack/react-query";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/login", { email, password });
      await qc.invalidateQueries({ queryKey: ["auth"] });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h1 className="text-lg font-semibold text-center text-gray-900">Connexion</h1>
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" required />
        <input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" required />
        <button type="submit" disabled={loading} className="w-full py-2 bg-storm-600 text-white text-sm font-medium rounded-md hover:bg-storm-700 disabled:opacity-50">
          {loading ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
`;
}

function renderContactsPage(): string {
  return `import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";

interface Contact { id: string; firstName: string; lastName: string; email: string | null; status: string; }

export function ContactsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "" });
  const [showForm, setShowForm] = useState(false);

  const { data: contacts = [] } = useQuery({
    queryKey: ["crm", "contacts"],
    queryFn: () => api.get<{ contacts: Contact[] }>("/crm/contacts").then((r) => r.contacts),
  });

  const create = useMutation({
    mutationFn: (data: typeof form) => api.post("/crm/contacts", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["crm", "contacts"] }); setShowForm(false); setForm({ firstName: "", lastName: "", email: "" }); },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Contacts</h1>
        <button onClick={() => setShowForm(!showForm)} className="px-3 py-2 bg-storm-600 text-white text-sm rounded-lg hover:bg-storm-700">+ Nouveau</button>
      </div>
      {showForm && (
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(form); }} className="mb-4 p-4 bg-white border rounded-lg grid grid-cols-3 gap-3">
          <input placeholder="Prénom" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="px-3 py-2 border rounded-md text-sm" required />
          <input placeholder="Nom" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="px-3 py-2 border rounded-md text-sm" required />
          <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="px-3 py-2 border rounded-md text-sm" />
          <button type="submit" className="px-4 py-2 bg-storm-600 text-white text-sm rounded-md">Créer</button>
        </form>
      )}
      <div className="bg-white border rounded-lg divide-y">
        {contacts.length === 0 ? (
          <p className="p-4 text-sm text-gray-400 text-center">Aucun contact</p>
        ) : contacts.map((c) => (
          <a key={c.id} href={\`/crm/contacts/\${c.id}\`} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
            <span className="text-sm font-medium">{c.firstName} {c.lastName}</span>
            <span className="text-xs text-gray-500">{c.email ?? "—"}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
`;
}

function renderContactDetailPage(): string {
  return `import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { api } from "../lib/api";

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
}

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: contact, isLoading } = useQuery({
    queryKey: ["crm", "contacts", id],
    queryFn: () => api.get<{ contact: Contact }>(\`/crm/contacts/\${id}\`).then((r) => r.contact),
    enabled: !!id,
  });

  if (isLoading) return <div className="p-6 text-sm text-gray-400">Chargement...</div>;
  if (!contact) return <div className="p-6 text-sm text-gray-500">Contact introuvable.</div>;

  return (
    <div className="p-6 max-w-2xl">
      <a href="/crm" className="text-sm text-storm-600 hover:text-storm-700 mb-4 inline-block">&larr; Retour</a>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">{contact.firstName} {contact.lastName}</h1>
      <div className="bg-white border rounded-lg divide-y">
        <div className="px-4 py-3 flex justify-between">
          <span className="text-sm text-gray-500">Email</span>
          <span className="text-sm font-medium">{contact.email ?? "—"}</span>
        </div>
        <div className="px-4 py-3 flex justify-between">
          <span className="text-sm text-gray-500">Téléphone</span>
          <span className="text-sm font-medium">{contact.phone ?? "—"}</span>
        </div>
        <div className="px-4 py-3 flex justify-between">
          <span className="text-sm text-gray-500">Statut</span>
          <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{contact.status}</span>
        </div>
        <div className="px-4 py-3 flex justify-between">
          <span className="text-sm text-gray-500">Créé le</span>
          <span className="text-sm">{new Date(contact.createdAt).toLocaleDateString("fr-FR")}</span>
        </div>
      </div>
    </div>
  );
}
`;
}

function renderDealsPage(): string {
  return `import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface Deal { id: string; title: string; value: number; stage: string; createdAt: string; }

export function DealsPage() {
  const { data: deals = [] } = useQuery({
    queryKey: ["crm", "deals"],
    queryFn: () => api.get<{ deals: Deal[] }>("/crm/deals").then((r) => r.deals),
  });

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Pipeline</h1>
      <div className="space-y-2">
        {deals.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Aucun deal</p>
        ) : deals.map((d) => (
          <div key={d.id} className="flex items-center justify-between p-4 bg-white border rounded-lg">
            <div>
              <p className="text-sm font-medium">{d.title}</p>
              <p className="text-xs text-gray-500">{d.stage} · {new Date(d.createdAt).toLocaleDateString("fr-FR")}</p>
            </div>
            <span className="text-sm font-semibold text-gray-900">
              {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(d.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
`;
}

function renderTicketsPage(): string {
  return `import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";

interface Ticket { id: string; title: string; status: string; priority: string; createdAt: string; }

export function TicketsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", priority: "medium" });
  const [showForm, setShowForm] = useState(false);

  const { data: tickets = [] } = useQuery({
    queryKey: ["ticketing"],
    queryFn: () => api.get<{ tickets: Ticket[] }>("/ticketing").then((r) => r.tickets),
  });

  const create = useMutation({
    mutationFn: (data: typeof form) => api.post("/ticketing", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ticketing"] }); setShowForm(false); setForm({ title: "", priority: "medium" }); },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Tickets</h1>
        <button onClick={() => setShowForm(!showForm)} className="px-3 py-2 bg-storm-600 text-white text-sm rounded-lg hover:bg-storm-700">+ Nouveau</button>
      </div>
      {showForm && (
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(form); }} className="mb-4 p-4 bg-white border rounded-lg flex gap-3">
          <input placeholder="Titre" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="flex-1 px-3 py-2 border rounded-md text-sm" required />
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="px-3 py-2 border rounded-md text-sm">
            <option value="low">Basse</option>
            <option value="medium">Moyenne</option>
            <option value="high">Haute</option>
            <option value="urgent">Urgente</option>
          </select>
          <button type="submit" className="px-4 py-2 bg-storm-600 text-white text-sm rounded-md">Créer</button>
        </form>
      )}
      <div className="space-y-2">
        {tickets.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Aucun ticket</p>
        ) : tickets.map((t) => (
          <div key={t.id} className="flex items-center justify-between p-4 bg-white border rounded-lg">
            <div>
              <p className="text-sm font-medium">{t.title}</p>
              <p className="text-xs text-gray-500">{t.priority} · {new Date(t.createdAt).toLocaleDateString("fr-FR")}</p>
            </div>
            <span className="px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-full">{t.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
`;
}

function renderClientTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        lib: ["ES2020", "DOM", "DOM.Iterable"],
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        paths: { "@/*": ["./src/*"] },
      },
      include: ["src/**/*.ts", "src/**/*.tsx"],
    },
    null,
    2
  );
}

// ─── README ──────────────────────────────────────────────────────────────────

function renderReadme(opts: ScaffoldOptions): string {
  const pm = opts.packageManager;
  const run = pm === "npm" ? "npm run" : pm;

  return `# ${opts.projectName}

Built with [Storm Stack](https://github.com/stormeoio/storm-stack).

## Quick start

\`\`\`bash
# Start PostgreSQL (or use your own)
docker compose up -d

# Configure
cp .env.example .env
${SESSION_SECRET_SETUP_COMMAND}

# Install & run
${pm} install
${run} db:generate
${run} db:migrate
${run} dev
\`\`\`

${opts.withClient ? "Server: http://localhost:3000 | Client: http://localhost:5173\n" : "Server: http://localhost:3000\n"}
## Plugins

${selectedPluginDefinitions(opts.plugins).map((plugin) => `- \`${plugin.id}\``).join("\n")}

## Scripts

| Command | Description |
|---------|-------------|
| \`${run} dev\` | Start dev server${opts.withClient ? " + client" : ""} |
| \`${run} build\` | Production build |
| \`${run} db:generate\` | Generate versioned Drizzle migrations |
| \`${run} db:migrate\` | Apply pending Drizzle migrations |
| \`${run} db:push\` | Push schema directly (local prototyping only) |
| \`${run} typecheck\` | TypeScript check |
`;
}

function renderGitignore(): string {
  return `node_modules/
dist/
.env
*.local
`;
}

// ─── Main scaffold ───────────────────────────────────────────────────────────

function renderStormJson(opts: ScaffoldOptions): string {
  return JSON.stringify({
    version: 1,
    pluginsDir: "plugins",
    serverEntry: "server/index.ts",
    drizzleConfig: "drizzle.config.ts",
    registry: "https://raw.githubusercontent.com/stormeoio/storm-stack/main/registry.json",
    installed: selectedPluginDefinitions(opts.plugins).map((plugin) => plugin.id),
  }, null, 2);
}

function renderClaudeMd(opts: ScaffoldOptions): string {
  const pluginList = selectedPluginDefinitions(opts.plugins)
    .map((plugin) => `- \`${plugin.id}\``)
    .join("\n");
  return `# ${opts.projectName} — Claude Code Instructions

## Stack
- **Server:** Express 5 + TypeScript + Drizzle ORM + PostgreSQL
- **Client:** React 18 + wouter + TanStack Query + Tailwind CSS
- **Plugin system:** \`@stormeoio/core\` registry + bootstrap

## Commands
\`\`\`bash
${opts.packageManager === "npm" ? "npm run" : opts.packageManager} dev          # Start dev (server + client)
${opts.packageManager === "npm" ? "npm run" : opts.packageManager} build        # Production build
${opts.packageManager === "npm" ? "npm run" : opts.packageManager} db:generate  # Generate versioned Drizzle migrations
${opts.packageManager === "npm" ? "npm run" : opts.packageManager} db:migrate   # Apply pending Drizzle migrations
storm add <plugin>   # Install a Storm Stack plugin
storm remove <name>  # Uninstall a plugin
storm list           # Show available plugins
\`\`\`

## Installed Plugins
${pluginList || "None yet — run \`storm add auth\` to get started."}

## Project Structure
\`\`\`
server/index.ts          — Express entry (plugin registry + bootstrap)
${opts.withClient ? "client/src/App.tsx       — React app (StormLayout + StormRouter)\nclient/src/storm-components.ts — Plugin component map\n" : ""}drizzle.config.ts        — Schema paths for all plugins
storm.json               — Plugin configuration
CLAUDE.md                — This file (auto-updated by storm CLI)
\`\`\`

## Conventions
- API routes mounted at \`/api/<plugin-name>/\`
- Auth routes use \`isAuthenticated\` from \`@stormeoio/auth\`
- Zod validation on all POST/PATCH/PUT bodies
- French UI text for user-facing strings

This file is auto-updated when you run \`storm add\` or \`storm remove\`.
`;
}

function renderStormComponents(opts: ScaffoldOptions): string {
  const selectedPlugins = selectedPluginDefinitions(opts.plugins);
  const imports = selectedPlugins.flatMap((plugin) => plugin.componentImports ?? []);
  const entries = selectedPlugins.flatMap((plugin) => plugin.componentEntries ?? []);

  return `${imports.length > 0 ? imports.join("\n") + "\n" : ""}import type { ComponentMap } from "@stormeoio/react";

/**
 * Maps plugin component names (from server manifest) to actual React components.
 * When you run "storm add <plugin>", this file gets updated automatically.
 */
export const STORM_COMPONENTS: ComponentMap = {
${entries.join("\n")}
};
`;
}

export function scaffold(opts: ScaffoldOptions, targetDir: string): void {
  // Server
  write(targetDir, "package.json", renderRootPackageJson(opts));
  write(targetDir, "server/tsconfig.json", renderServerTsConfig());
  write(targetDir, "server/app-origin.ts", renderAppOriginModule());
  write(targetDir, "server/index.ts", renderServerIndex(opts));
  write(targetDir, "drizzle.config.ts", renderDrizzleConfig(opts));
  write(targetDir, ".env.example", renderEnvExample(opts));
  write(targetDir, "docker-compose.yml", renderDockerCompose(opts));
  write(targetDir, ".gitignore", renderGitignore());
  write(targetDir, "README.md", renderReadme(opts));
  write(targetDir, "storm.json", renderStormJson(opts));
  write(targetDir, "CLAUDE.md", renderClaudeMd(opts));

  // Client
  if (opts.withClient) {
    write(targetDir, "vite.config.ts", renderViteConfig());
    write(targetDir, "tailwind.config.ts", renderTailwindConfig());
    write(targetDir, "postcss.config.js", renderPostcssConfig());
    write(targetDir, "client/index.html", renderIndexHtml(opts));
    write(targetDir, "client/src/main.tsx", renderMainTsx());
    write(targetDir, "client/src/index.css", renderIndexCss());
    write(targetDir, "client/src/App.tsx", renderAppTsx(opts));
    write(targetDir, "client/src/lib/api.ts", renderApiLib());
    write(targetDir, "client/src/storm-components.ts", renderStormComponents(opts));
    write(targetDir, "client/src/pages/DashboardPage.tsx", renderDashboardPage(opts));
    write(targetDir, "client/tsconfig.json", renderClientTsConfig());

    if (hasAuth(opts.plugins)) {
      write(targetDir, "client/src/pages/LoginPage.tsx", renderLoginPage());
    }
    if (hasCrm(opts.plugins)) {
      write(targetDir, "client/src/pages/ContactsPage.tsx", renderContactsPage());
      write(targetDir, "client/src/pages/ContactDetailPage.tsx", renderContactDetailPage());
      write(targetDir, "client/src/pages/DealsPage.tsx", renderDealsPage());
    }
    if (hasTicketing(opts.plugins)) {
      write(targetDir, "client/src/pages/TicketsPage.tsx", renderTicketsPage());
    }
  }
}
