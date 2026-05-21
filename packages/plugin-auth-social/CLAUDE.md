# @stormstack/auth-social — Claude Copilot Guide

## What this plugin does
OAuth2 social login with Google, GitHub, and GitLab. Extends `@stormstack/auth` with SSO providers. Creates/links social accounts to existing users.

## Schema (Drizzle — PostgreSQL)

### `storm_social_accounts`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID |
| userId | text FK → users | CASCADE delete |
| provider | text NOT NULL | "google" / "github" / "gitlab" |
| providerAccountId | text NOT NULL | External provider user ID |
| accessToken | text | nullable |
| refreshToken | text | nullable |
| created_at | timestamptz | |

Unique index on (provider, providerAccountId).

## API Routes (mounted at `/api/auth-social`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /google | No | Redirect to Google OAuth |
| GET | /google/callback | No | Google OAuth callback → set cookie |
| GET | /github | No | Redirect to GitHub OAuth |
| GET | /github/callback | No | GitHub OAuth callback → set cookie |

## Exports
```ts
import { createSocialAuthPlugin } from "@stormstack/auth-social";

const socialPlugin = createSocialAuthPlugin({
  google: { clientId: "...", clientSecret: "...", callbackUrl: "..." },
  github: { clientId: "...", clientSecret: "...", callbackUrl: "..." },
});
registry.register(socialPlugin);
```

Note: This plugin uses a **factory function** — you must call `createSocialAuthPlugin()` with provider configs.

## Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| GOOGLE_CLIENT_ID | No | Google OAuth client ID |
| GOOGLE_CLIENT_SECRET | No | Google OAuth client secret |
| GITHUB_CLIENT_ID | No | GitHub OAuth client ID |
| GITHUB_CLIENT_SECRET | No | GitHub OAuth client secret |

At least one provider pair must be configured.

## Requires
- `@stormstack/auth` — extends the auth system, uses `users` table + `signToken`

## Common Customizations

### Add GitLab provider
Add a `gitlab` option to `createSocialAuthPlugin()` with `clientId`, `clientSecret`, `callbackUrl`, and `apiUrl` (for self-hosted GitLab).

### Auto-create tenant on social signup
Hook into the callback handler in `routes.ts` — after user creation, also create a tenant and tenant_member row.
