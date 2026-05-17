import { Link, useParams } from "wouter";
import { clsx } from "clsx";

const SECTIONS = [
  { id: "getting-started", label: "Getting Started" },
  { id: "architecture", label: "Architecture" },
  { id: "creating-plugins", label: "Creating Plugins" },
  { id: "auth", label: "Auth Plugin" },
  { id: "crm", label: "CRM Plugin" },
  { id: "ticketing", label: "Ticketing Plugin" },
  { id: "deployment", label: "Deployment" },
];

const CONTENT: Record<string, { title: string; body: string }> = {
  "getting-started": {
    title: "Getting Started",
    body: `## Installation

\`\`\`bash
npx create-storm-app my-app
cd my-app
docker compose up -d
cp .env.example .env
npm install
npm run db:push
npm run dev
\`\`\`

The CLI will ask you which plugins to install and whether to generate a React frontend.

## Project Structure

\`\`\`
my-app/
├── server/index.ts       # Express bootstrap
├── client/src/           # React frontend (optional)
├── docker-compose.yml    # PostgreSQL
├── drizzle.config.ts     # Schema management
└── .env.example          # Configuration
\`\`\`

## Development

- **Server**: http://localhost:3000 (Express + all plugin APIs)
- **Client**: http://localhost:5173 (Vite + proxy to server)
- **Database**: PostgreSQL via Docker on port 5432

## Scripts

| Command | Description |
|---------|-------------|
| \`npm run dev\` | Start server + client |
| \`npm run db:push\` | Apply schema to database |
| \`npm run typecheck\` | TypeScript verification |
| \`npm run build\` | Production build |
`,
  },
  architecture: {
    title: "Architecture",
    body: `## Plugin System

Storm Stack uses a plugin registry with dependency resolution and lifecycle management.

\`\`\`
┌─────────────────────────────────────────┐
│            Your Application             │
├─────────────────────────────────────────┤
│  auth  │  crm  │  ticketing  │  ...    │  ← Plugins
├─────────────────────────────────────────┤
│           @stormstack/core              │  ← Registry
├─────────────────────────────────────────┤
│  Express 5  │  Drizzle  │  PostgreSQL  │  ← Foundation
└─────────────────────────────────────────┘
\`\`\`

## Boot Sequence

1. Register plugins in dependency order
2. Validate all requirements are met
3. Mount global middleware (auth cookies, etc.)
4. Run \`onBoot\` lifecycle hooks
5. Mount plugin routes at \`/api/<plugin-name>\`
6. Mount manifest API at \`/api/storm/\`

## Plugin Interface

Every plugin declares:

- **id** — unique identifier
- **schema** — Drizzle tables it owns
- **routes** — Express router factory
- **client** — nav items, routes, settings panels
- **lifecycle** — onBoot, onInstall, onUninstall
- **requires** — other plugins it depends on
- **env** — required environment variables
`,
  },
  "creating-plugins": {
    title: "Creating Plugins",
    body: `## Minimal Plugin

\`\`\`ts
import type { StormPlugin } from "@stormstack/core";
import { Router } from "express";

export const helloPlugin: StormPlugin = {
  id: "my-org/hello",
  name: "Hello",
  version: "1.0.0",
  description: "A simple greeting plugin",

  routes: ({ ctx, isAuthenticated }) => {
    const router = Router();
    router.get("/greet", isAuthenticated, (req, res) => {
      res.json({ message: \`Hello, \${req.user!.email}\` });
    });
    return router;
  },
};
\`\`\`

## With Schema

\`\`\`ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const notes = pgTable("notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  body: text("body"),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notesPlugin: StormPlugin = {
  id: "my-org/notes",
  name: "Notes",
  version: "1.0.0",
  description: "Personal notes",
  requires: ["@stormstack/auth"],
  schema: { tables: { notes } },
  routes: ({ ctx, isAuthenticated }) => {
    const router = Router();
    // CRUD routes...
    return router;
  },
};
\`\`\`

## Client Manifest

\`\`\`ts
client: {
  navItems: [
    { id: "notes", label: "Notes", icon: "StickyNote", path: "/notes" }
  ],
  routes: [
    { path: "/notes", component: "NotesPage", auth: true }
  ],
}
\`\`\`
`,
  },
  auth: {
    title: "Auth Plugin",
    body: `## @stormstack/auth

Email/password authentication with JWT httpOnly cookies, RBAC, and multi-tenant.

### Install

\`\`\`bash
npm install @stormstack/auth
\`\`\`

### Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | \`/api/auth/register\` | Create account |
| POST | \`/api/auth/login\` | Login (sets httpOnly cookie) |
| POST | \`/api/auth/logout\` | Logout (clears cookie) |
| GET | \`/api/auth/me\` | Current user |

### Environment

| Variable | Required |
|----------|----------|
| \`SESSION_SECRET\` | Yes (min 32 chars) |

### Utilities

\`\`\`ts
import { isAuthenticated, requireRole } from "@stormstack/auth";

// Protect a route
router.get("/admin", isAuthenticated, requireRole("admin"), handler);
\`\`\`

### Schema

- \`storm_users\` — id, email, passwordHash, name, role, emailVerified
- \`storm_tenants\` — multi-tenant workspace
- \`storm_tenant_members\` — user↔tenant membership with roles
`,
  },
  crm: {
    title: "CRM Plugin",
    body: `## @stormstack/crm

Contacts, organisations, and deal pipeline.

### Routes

#### Organizations
- \`GET /api/crm/organizations\` — List
- \`POST /api/crm/organizations\` — Create
- \`GET /api/crm/organizations/:id\` — Detail
- \`PATCH /api/crm/organizations/:id\` — Update
- \`DELETE /api/crm/organizations/:id\` — Delete

#### Contacts
- \`GET /api/crm/contacts\` — List
- \`POST /api/crm/contacts\` — Create
- \`PATCH /api/crm/contacts/:id\` — Update
- \`DELETE /api/crm/contacts/:id\` — Delete

#### Deals
- \`GET /api/crm/deals\` — List
- \`POST /api/crm/deals\` — Create
- \`PATCH /api/crm/deals/:id\` — Update
- \`DELETE /api/crm/deals/:id\` — Delete

### Stages

Deals flow through: \`new → qualified → proposal → negotiation → won/lost\`

### Contact Statuses

\`lead → prospect → client → churned\`
`,
  },
  ticketing: {
    title: "Ticketing Plugin",
    body: `## @stormstack/ticketing

Support tickets with comments and labels.

### Routes

#### Tickets
- \`GET /api/ticketing\` — List (filter: \`?status=open\`)
- \`POST /api/ticketing\` — Create
- \`GET /api/ticketing/:id\` — Detail + comments
- \`PATCH /api/ticketing/:id\` — Update
- \`DELETE /api/ticketing/:id\` — Delete

#### Comments
- \`POST /api/ticketing/:id/comments\` — Add comment
- \`PATCH /api/ticketing/:id/comments/:commentId\` — Edit
- \`DELETE /api/ticketing/:id/comments/:commentId\` — Delete

#### Labels
- \`GET /api/ticketing/labels\` — List
- \`POST /api/ticketing/labels\` — Create
- \`DELETE /api/ticketing/labels/:id\` — Delete

### Statuses

\`open → in_progress → waiting → resolved → closed\`

### Priorities

\`low | medium | high | urgent\`
`,
  },
  deployment: {
    title: "Deployment",
    body: `## Production Build

\`\`\`bash
npm run build
npm start
\`\`\`

## Docker

\`\`\`dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
\`\`\`

## Environment Variables

Configure via \`.env\` or your hosting platform:

| Variable | Required | Description |
|----------|----------|-------------|
| \`DATABASE_URL\` | Yes | PostgreSQL connection string |
| \`SESSION_SECRET\` | Yes | JWT secret (32+ chars) |
| \`PORT\` | No | Server port (default: 3000) |
| \`NODE_ENV\` | No | production/development |

## Database Migrations

\`\`\`bash
npm run db:push     # Apply schema (dev)
npm run db:generate # Generate SQL migration (prod)
\`\`\`

## Hosting Recommendations

- **Railway** — one-click PostgreSQL + Node deploy
- **Fly.io** — global edge, Dockerfile deploy
- **VPS** — Docker Compose with Traefik
- **Vercel** — not recommended (no long-lived server)
`,
  },
};

export function DocsPage() {
  const params = useParams<{ section?: string }>();
  const activeSection = params.section ?? "getting-started";
  const content = CONTENT[activeSection];

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 flex gap-12">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 hidden md:block">
        <nav className="sticky top-20 space-y-1">
          {SECTIONS.map(({ id, label }) => (
            <Link key={id} href={`/docs/${id}`}>
              <a className={clsx(
                "block px-3 py-1.5 text-sm rounded-md transition-colors",
                activeSection === id
                  ? "bg-storm-50 text-storm-700 font-medium"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              )}>
                {label}
              </a>
            </Link>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0">
        {content ? (
          <article className="prose prose-gray prose-sm max-w-none prose-headings:font-semibold prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">{content.title}</h1>
            <div className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">
              {content.body}
            </div>
          </article>
        ) : (
          <p className="text-gray-500 text-sm">Section not found.</p>
        )}
      </main>
    </div>
  );
}
