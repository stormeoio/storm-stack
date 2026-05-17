# Storm Stack

**React/Node plugin framework for SaaS applications — Claude-native by design.**

Storm Stack lets you bootstrap production-grade SaaS apps by assembling pre-built, battle-tested plugins extracted from [StormeoOS](https://stormeo.io) — a real-world SaaS running in production since 2023.

```bash
npx create-storm-app my-saas --plugins auth,billing,crm
storm add messaging drive
```

## Architecture

```
storm-stack/
├── packages/
│   ├── core/              # Plugin registry, auth, multi-tenant, middleware
│   ├── cli/               # `storm` CLI
│   ├── create-storm-app/  # `npx create-storm-app`
│   ├── plugin-stripe/     # Stripe billing plugin
│   ├── plugin-crm/        # CRM — contacts, organisations, pipeline
│   ├── plugin-ticketing/  # Support tickets, feedback, beta testers
│   ├── plugin-messaging/  # In-app IM + transactional email
│   ├── plugin-drive/      # File storage, GED, SFTP
│   ├── plugin-monitoring/ # Uptime monitoring, infra health
│   ├── plugin-cms/        # Content management, help center
│   ├── plugin-vault/      # Encrypted secrets vault
│   ├── plugin-auth-social/# Google, Apple, GitHub, GitLab OAuth
│   ├── plugin-rgpd/       # GDPR consent registry, cookies
│   ├── plugin-design/     # Live theme editor, design system
│   ├── plugin-search/     # Multi-module unified search
│   └── plugin-dock/       # macOS-style dock, shortcuts, windows
├── apps/
│   ├── stormclaude/       # StormClaude SaaS platform (app management UI)
│   └── docs/              # Documentation site
└── tooling/
    ├── eslint-config/
    └── tsconfig/
```

## Plugin model

Every plugin is a self-contained module that declares:
- **routes** — Express router factory
- **schema** — Drizzle tables it owns
- **client** — nav items, dock shortcuts, React routes, settings panels
- **lifecycle** — onInstall / onBoot / onUninstall hooks
- **env** — required environment variables (validated at boot)
- **configSchema** — Zod schema for the StormClaude settings UI

```ts
import { registry } from "@storm/core";
import { stripePlugin } from "@storm/plugin-stripe";

registry.register(stripePlugin);

// In your Express app:
await bootstrapPlugins({ app, ctx });
```

## Claude-native design

Every plugin ships with a `CLAUDE.md` documenting:
- What the plugin does and its data model
- Extension points and customisation hooks
- Example prompts for common tasks

This makes Storm Stack apps first-class citizens in Claude Code — no context-gathering overhead.

## Distribution model

Plugins are distributed **shadcn/ui style** — the CLI copies code into your project.
You own the code. No dependency lock-in. Claude can modify it directly.

```bash
# Copy plugin source into your project
storm add billing
# → copies packages/plugin-stripe/src/ into src/plugins/billing/
# → updates your plugin registry
# → generates migration SQL for the new tables
```

## Roadmap

- [x] Plugin manifest TypeScript types
- [x] Plugin registry + topological sort
- [x] Bootstrap system (Express mount)
- [ ] `create-storm-app` CLI
- [ ] `storm add <plugin>` CLI
- [ ] @storm/core (auth, RBAC, multi-tenant)
- [ ] @storm/plugin-stripe
- [ ] @storm/plugin-crm
- [ ] StormClaude MVP (app management platform)

## License

MIT — framework and official plugins are free and open source.
[StormClaude](https://stormclaude.io) cloud hosting is a commercial product.

---

*Built by [Stormeo Technologies](https://stormeo.io) — extracted from StormeoOS v3.7+*
