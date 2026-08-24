# @stormeoio/auth

Email/password authentication with JWT httpOnly cookies, role-based access control, and multi-tenant support.

## Installation

```bash
npm install @stormeoio/auth
```

## Features

- Email/password registration and login
- JWT tokens in httpOnly cookies (no localStorage)
- Role-based middleware (`requireRole("admin")`)
- Multi-tenant schema (users → tenants → members)
- Drizzle ORM schema included

## Usage

```ts
import { authPlugin } from "@stormeoio/auth";
import { registry } from "@stormeoio/core";

registry.register(authPlugin);
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login (sets cookie) |
| POST | `/api/auth/logout` | Logout (clears cookie) |
| GET | `/api/auth/me` | Current user |

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `SESSION_SECRET` | Yes | JWT signing secret (min 32 chars) |

## License

MIT
