# create-storm-app

Scaffold a full-stack Storm Stack application in seconds.

## Usage

```bash
npx create-storm-app my-app
```

Or with a specific package manager:

```bash
npm create storm-app my-app
pnpm create storm-app my-app
yarn create storm-app my-app
```

## What it generates

```
my-app/
├── server/
│   ├── index.ts          # Express + plugin bootstrap
│   └── tsconfig.json
├── client/               # (if React frontend selected)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   └── lib/api.ts
│   ├── index.html
│   └── tsconfig.json
├── docker-compose.yml    # PostgreSQL dev container
├── drizzle.config.ts     # Drizzle Kit configuration
├── vite.config.ts        # Vite + proxy to Express
├── package.json
├── .env.example
└── README.md
```

## Features

- Interactive plugin selection (auth, auth-social, crm, ticketing, stripe)
- Optional React frontend with TanStack Query + Tailwind
- Docker Compose for PostgreSQL
- Drizzle ORM with all plugin schemas aggregated
- TypeScript throughout
- Adaptive — only generates pages for selected plugins

## Plugins selectable in v0.1

| Plugin | Description |
|--------|-------------|
| `@stormstack/auth` | Email/password + JWT + RBAC |
| `@stormstack/auth-social` | OAuth2 Google/GitHub/GitLab |
| `@stormstack/crm` | Contacts, orgs, pipeline |
| `@stormstack/ticketing` | Support tickets + feedback |
| `@stormstack/stripe` | Stripe payments + webhooks |

## License

MIT
