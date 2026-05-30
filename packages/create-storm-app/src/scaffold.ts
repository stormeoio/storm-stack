import fs from "fs";
import path from "path";
import type { ScaffoldOptions } from "./prompts";
import { STORM_PACKAGE_RANGE } from "./version";

const hasPlugin = (plugins: string[], id: string) => plugins.includes(id);
const hasAuth = (plugins: string[]) => hasPlugin(plugins, "@stormstack/auth");
const hasCrm = (plugins: string[]) => hasPlugin(plugins, "@stormstack/crm");
const hasTicketing = (plugins: string[]) => hasPlugin(plugins, "@stormstack/ticketing");
const hasAuthSocial = (plugins: string[]) => hasPlugin(plugins, "@stormstack/auth-social");
const hasStripe = (plugins: string[]) => hasPlugin(plugins, "@stormstack/stripe");

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
    "@stormstack/core": STORM_PACKAGE_RANGE,
    cors: "^2.8.5",
    dotenv: "^16.4.0",
    "drizzle-orm": "^0.45.2",
    express: "^5.0.0",
    pg: "^8.13.0",
    zod: "^3.22.0",
  };

  for (const p of opts.plugins) {
    deps[p] = STORM_PACKAGE_RANGE;
  }

  const devDeps: Record<string, string> = {
    "@stormstack/cli": STORM_PACKAGE_RANGE,
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^20.0.0",
    "@types/pg": "^8.11.0",
    "drizzle-kit": "^0.31.10",
    tsx: "^4.0.0",
    typescript: "^5.4.0",
  };

  if (opts.withClient) {
    deps["react"] = "^18.3.0";
    deps["react-dom"] = "^18.3.0";
    deps["@stormstack/react"] = STORM_PACKAGE_RANGE;
    deps["@tanstack/react-query"] = "^5.0.0";
    deps["wouter"] = "^3.3.0";
    deps["clsx"] = "^2.1.0";
    deps["lucide-react"] = "^0.400.0";
    devDeps["@types/react"] = "^18.3.0";
    devDeps["@types/react-dom"] = "^18.3.0";
    devDeps["@vitejs/plugin-react"] = "^4.3.0";
    devDeps["autoprefixer"] = "^10.4.0";
    devDeps["postcss"] = "^8.4.0";
    devDeps["tailwindcss"] = "^3.4.0";
    devDeps["vite"] = "^5.0.0";
  }

  return JSON.stringify(
    {
      name: opts.projectName,
      version: "0.1.0",
      private: true,
      type: "module",
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
    "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/stormapp",
    "NODE_ENV=development",
    "PORT=3000",
  ];
  if (hasAuth(opts.plugins)) {
    lines.push("SESSION_SECRET=change-me-to-a-random-32-char-secret-minimum");
  }
  if (hasAuthSocial(opts.plugins)) {
    lines.push("");
    lines.push("# OAuth (optionnel)");
    lines.push("# GOOGLE_CLIENT_ID=");
    lines.push("# GOOGLE_CLIENT_SECRET=");
    lines.push("# GITHUB_CLIENT_ID=");
    lines.push("# GITHUB_CLIENT_SECRET=");
  }
  if (hasStripe(opts.plugins)) {
    lines.push("");
    lines.push("# Stripe");
    lines.push("STRIPE_SECRET_KEY=sk_test_...");
    lines.push("STRIPE_WEBHOOK_SECRET=whsec_...");
  }
  return lines.join("\n") + "\n";
}

function renderServerIndex(opts: ScaffoldOptions): string {
  const imports: string[] = [
    `import "dotenv/config";`,
    `import express from "express";`,
    `import cors from "cors";`,
    `import { drizzle } from "drizzle-orm/node-postgres";`,
    `import { Pool } from "pg";`,
    `import { registry, bootstrapPlugins, eventBus } from "@stormstack/core";`,
    `import type { StormContext, StormEnv } from "@stormstack/core";`,
  ];

  const registers: string[] = [];

  if (hasAuth(opts.plugins)) {
    imports.push(`import { authPlugin } from "@stormstack/auth";`);
    registers.push(`registry.register(authPlugin);`);
  }
  if (hasCrm(opts.plugins)) {
    imports.push(`import { crmPlugin } from "@stormstack/crm";`);
    registers.push(`registry.register(crmPlugin);`);
  }
  if (hasTicketing(opts.plugins)) {
    imports.push(`import { ticketingPlugin } from "@stormstack/ticketing";`);
    registers.push(`registry.register(ticketingPlugin);`);
  }
  if (hasAuthSocial(opts.plugins)) {
    imports.push(`import { createSocialAuthPlugin } from "@stormstack/auth-social";`);
  }
  if (hasStripe(opts.plugins)) {
    imports.push(`import type { Request } from "express";`);
    imports.push(`import { stripePlugin } from "@stormstack/stripe";`);
    registers.push(`registry.register(stripePlugin);`);
  }

  const socialBlock = hasAuthSocial(opts.plugins)
    ? `
if (env["GOOGLE_CLIENT_ID"] || env["GITHUB_CLIENT_ID"]) {
  const socialPlugin = createSocialAuthPlugin({
    google: env["GOOGLE_CLIENT_ID"]
      ? { clientId: env["GOOGLE_CLIENT_ID"]!, clientSecret: env["GOOGLE_CLIENT_SECRET"]!, callbackUrl: \`http://localhost:\${PORT}/api/auth-social/google/callback\` }
      : undefined,
    github: env["GITHUB_CLIENT_ID"]
      ? { clientId: env["GITHUB_CLIENT_ID"]!, clientSecret: env["GITHUB_CLIENT_SECRET"]!, callbackUrl: \`http://localhost:\${PORT}/api/auth-social/github/callback\` }
      : undefined,
  });
  registry.register(socialPlugin);
}
`
    : "";

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

const env: StormEnv = {
  DATABASE_URL: process.env["DATABASE_URL"] ?? "",
  SESSION_SECRET: process.env["SESSION_SECRET"] ?? "",
  NODE_ENV: (process.env["NODE_ENV"] as StormEnv["NODE_ENV"]) ?? "development",
};

if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
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

${registers.join("\n")}
${socialBlock}
async function main() {
  const app = express();
  app.use(cors({ origin: "http://localhost:5173", credentials: true }));
  app.use(${jsonParser});

  await bootstrapPlugins({ app, ctx });

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
  const schemas: string[] = [];
  if (hasAuth(opts.plugins)) schemas.push(`"node_modules/@stormstack/auth/dist/index.js"`);
  if (hasCrm(opts.plugins)) schemas.push(`"node_modules/@stormstack/crm/dist/index.js"`);
  if (hasTicketing(opts.plugins)) schemas.push(`"node_modules/@stormstack/ticketing/dist/index.js"`);
  if (hasAuthSocial(opts.plugins)) schemas.push(`"node_modules/@stormstack/auth-social/dist/index.js"`);

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

function renderDockerCompose(): string {
  return `services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: stormapp
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
`;
}

// ─── Client files ────────────────────────────────────────────────────────────

function renderViteConfig(): string {
  return `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: "client",
  resolve: {
    alias: { "@": path.resolve(__dirname, "client/src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
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
import { StormProvider } from "@stormstack/react";
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
  return `const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(\`\${BASE}\${path}\`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
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
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
`;
}

function renderAppTsx(opts: ScaffoldOptions): string {
  const hasAuthPlugin = hasAuth(opts.plugins);

  return `import { Route } from "wouter";
import { StormLayout, StormRouter } from "@stormstack/react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./lib/api";
import { DashboardPage } from "./pages/DashboardPage";
${hasAuthPlugin ? `import { LoginPage } from "./pages/LoginPage";\n` : ""}
export default function App() {
  const qc = useQueryClient();

  const handleLogout = async () => {
    await api.post("/auth/logout", {});
    await qc.invalidateQueries({ queryKey: ["storm", "auth"] });
    window.location.href = "/login";
  };

  return (
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
${hasAuthPlugin ? `        <Route path="/login" component={LoginPage} />\n` : ""}      </StormRouter>
    </StormLayout>
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
          <p className="text-lg font-semibold text-gray-900 mt-1">${opts.plugins.length}</p>
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

# Install & run
${pm} install
${run} db:push
${run} dev
\`\`\`

${opts.withClient ? "Server: http://localhost:3000 | Client: http://localhost:5173\n" : "Server: http://localhost:3000\n"}
## Plugins

${opts.plugins.map((p) => `- \`${p}\``).join("\n")}

## Scripts

| Command | Description |
|---------|-------------|
| \`${run} dev\` | Start dev server${opts.withClient ? " + client" : ""} |
| \`${run} build\` | Production build |
| \`${run} db:push\` | Apply schema to database |
| \`${run} typecheck\` | TypeScript check |
`;
}

function renderGitignore(): string {
  return `node_modules/
dist/
.env
drizzle/meta/
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
    installed: opts.plugins,
  }, null, 2);
}

function renderClaudeMd(opts: ScaffoldOptions): string {
  const pluginList = opts.plugins.map((p) => `- \`${p}\``).join("\n");
  return `# ${opts.projectName} — Claude Code Instructions

## Stack
- **Server:** Express 5 + TypeScript + Drizzle ORM + PostgreSQL
- **Client:** React 18 + wouter + TanStack Query + Tailwind CSS
- **Plugin system:** \`@stormstack/core\` registry + bootstrap

## Commands
\`\`\`bash
${opts.packageManager === "npm" ? "npm run" : opts.packageManager} dev          # Start dev (server + client)
${opts.packageManager === "npm" ? "npm run" : opts.packageManager} build        # Production build
${opts.packageManager === "npm" ? "npm run" : opts.packageManager} db:push      # Apply Drizzle schema to PostgreSQL
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
- Auth routes use \`isAuthenticated\` from \`@stormstack/auth\`
- Zod validation on all POST/PATCH/PUT bodies
- French UI text for user-facing strings

This file is auto-updated when you run \`storm add\` or \`storm remove\`.
`;
}

function renderStormComponents(opts: ScaffoldOptions): string {
  const imports: string[] = [];
  const entries: string[] = [];

  if (hasCrm(opts.plugins)) {
    imports.push(`import { ContactsPage } from "./pages/ContactsPage";`);
    imports.push(`import { ContactDetailPage } from "./pages/ContactDetailPage";`);
    imports.push(`import { DealsPage } from "./pages/DealsPage";`);
    entries.push(`  CrmPage: ContactsPage,`);
    entries.push(`  ContactDetailPage,`);
    entries.push(`  DealsPage,`);
  }
  if (hasTicketing(opts.plugins)) {
    imports.push(`import { TicketsPage } from "./pages/TicketsPage";`);
    entries.push(`  TicketsPage,`);
  }

  return `${imports.length > 0 ? imports.join("\n") + "\n" : ""}import type { ComponentMap } from "@stormstack/react";

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
  write(targetDir, "server/index.ts", renderServerIndex(opts));
  write(targetDir, "drizzle.config.ts", renderDrizzleConfig(opts));
  write(targetDir, ".env.example", renderEnvExample(opts));
  write(targetDir, "docker-compose.yml", renderDockerCompose());
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
