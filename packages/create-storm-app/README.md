# create-storm-app

Scaffold a full-stack Storm Stack application in seconds.

## Usage

```bash
npx @stormeoio/create-storm-app my-app
```

Or with a specific package manager:

```bash
npm create storm-app my-app
pnpm create storm-app my-app
yarn create storm-app my-app
```

For deterministic CI or automation, use the non-interactive mode:

```bash
create-storm-app alpha --yes --plugins auth,consent --with-client --package-manager npm
```

Plugin IDs can be short (`auth`) or complete (`@stormeoio/auth`). Add `--force`
to replace an existing target directory. Run `create-storm-app --help` for all
options.

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

- Interactive or deterministic plugin selection (auth, auth-social, crm, ticketing, stripe, consent)
- Optional React frontend with TanStack Query + Tailwind
- Docker Compose for PostgreSQL
- Drizzle ORM with all plugin schemas aggregated
- TypeScript throughout
- Adaptive — only generates pages for selected plugins

## Plugins selectable in v0.1

| Plugin | Description |
|--------|-------------|
| `@stormeoio/auth` | Email/password + JWT + RBAC |
| `@stormeoio/auth-social` | OAuth2 Google/GitHub/GitLab |
| `@stormeoio/crm` | Contacts, orgs, pipeline |
| `@stormeoio/ticketing` | Support tickets + feedback |
| `@stormeoio/stripe` | Stripe payments + webhooks |
| `@stormeoio/consent` | RGPD consent preferences + cookie banner |

## License

MIT
