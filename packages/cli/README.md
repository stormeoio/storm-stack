# @stormeoio/cli

CLI for managing Storm Stack plugins.

## Install

```bash
npm install -g @stormeoio/cli
```

Or use directly with `npx`:

```bash
npx @stormeoio/cli add auth
```

## Commands

### `storm add <plugin>`

Add a plugin to your project.

```bash
# Install as npm package (default)
storm add auth

# Copy source code into your project (shadcn-style)
storm add crm --copy

# Use local monorepo source (for development)
storm add ticketing --copy --local ~/storm-stack

# Skip confirmation prompts
storm add auth -y
```

### `storm remove <plugin>`

Remove a plugin and clean up all references.

```bash
storm remove crm
```

### `storm list`

Show all available plugins and their status.

```bash
storm list
```

### `storm init`

Initialize `storm.json` in an existing project.

```bash
storm init
```

## Configuration

`storm.json` tracks your project's plugin state:

```json
{
  "version": 1,
  "pluginsDir": "plugins",
  "serverEntry": "server/index.ts",
  "drizzleConfig": "drizzle.config.ts",
  "installed": ["@stormeoio/auth", "@stormeoio/crm"]
}
```

## Available Plugins

| Plugin | Description | Status |
|--------|-------------|--------|
| `auth` | Email/password + JWT + RBAC + multi-tenant | Available |
| `auth-social` | OAuth2 Google/GitHub/GitLab | Available |
| `crm` | Contacts, organisations, pipeline | Available |
| `ticketing` | Support tickets, comments, labels | Available |
| `stripe` | Payments, webhooks, subscriptions | Available |
| `billing` | Invoicing, recurring billing | Coming soon |
| `cms` | Content management | Coming soon |
| `messaging` | In-app IM, transactional email | Coming soon |
| `drive` | File storage, document management | Coming soon |
| `monitoring` | Uptime, health checks, alerts | Coming soon |

## License

MIT
