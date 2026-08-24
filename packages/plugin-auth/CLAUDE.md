# @stormeoio/auth — Claude Copilot Guide

## What this plugin does
Email/password authentication with JWT cookies, RBAC roles, and multi-tenant support. Provides `isAuthenticated` middleware, user registration/login, and a tenant membership system.

## Schema (Drizzle — PostgreSQL)

### `storm_users`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID auto-generated |
| email | text NOT NULL | Unique index |
| password_hash | text NOT NULL | bcrypt (12 rounds) |
| name | text NOT NULL | |
| role | text NOT NULL | Default "member" |
| email_verified | boolean | Default false |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `storm_tenants`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID |
| name | text NOT NULL | |
| slug | text NOT NULL | Unique index |

### `storm_tenant_members`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID |
| tenant_id | text FK → tenants | CASCADE delete |
| user_id | text FK → users | CASCADE delete |
| role | text NOT NULL | Default "member" |

## API Routes (mounted at `/api/auth`)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | /register | No | `{ email, password, name }` | `{ user }` + set cookie |
| POST | /login | No | `{ email, password }` | `{ user }` + set cookie |
| POST | /logout | No | — | `{ ok: true }` + clear cookie |
| GET | /me | Yes | — | `{ user }` |

## Validation (Zod)
- `registerSchema`: email (valid), password (min 8), name (min 1)
- `loginSchema`: email (valid), password (min 1)

## Exports
```ts
// Server
import { authPlugin } from "@stormeoio/auth";
import { isAuthenticated, requireRole, signToken, verifyToken } from "@stormeoio/auth";
import { users, tenants, tenantMembers } from "@stormeoio/auth";
import type { User, InsertUser, AuthTokenPayload } from "@stormeoio/auth";

// Client
import { LoginPage, RegisterPage } from "@stormeoio/auth/client";
```

## Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| SESSION_SECRET | Yes | JWT signing secret, min 32 chars |

## Common Customizations

### Add a field to users
1. Edit `schema.ts` → add column to `storm_users` pgTable
2. Update `routes.ts` → include in register/login/me responses
3. Run `npm run db:push`

### Add role-based route protection
```ts
import { isAuthenticated, requireRole } from "@stormeoio/auth";
router.get("/admin-only", isAuthenticated, requireRole("admin"), handler);
```

### Change password hashing rounds
Edit `routes.ts` line `bcrypt.hash(password, 12)` — 12 is the default.

## Dependencies
- `bcryptjs` — password hashing
- `jsonwebtoken` — JWT tokens
- `cookie-parser` — HTTP-only cookie auth
