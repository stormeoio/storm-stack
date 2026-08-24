# @stormeoio/crm

CRM plugin for Storm Stack — contacts, organisations, and deal pipeline.

## Installation

```bash
npm install @stormeoio/crm
```

## Usage

```ts
import { crmPlugin } from "@stormeoio/crm";
import { registry } from "@stormeoio/core";

registry.register(crmPlugin);
```

## API Routes

### Organizations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/crm/organizations` | List organizations |
| POST | `/api/crm/organizations` | Create organization |
| GET | `/api/crm/organizations/:id` | Get organization |
| PATCH | `/api/crm/organizations/:id` | Update organization |
| DELETE | `/api/crm/organizations/:id` | Delete organization |

### Contacts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/crm/contacts` | List contacts |
| POST | `/api/crm/contacts` | Create contact |
| GET | `/api/crm/contacts/:id` | Get contact |
| PATCH | `/api/crm/contacts/:id` | Update contact |
| DELETE | `/api/crm/contacts/:id` | Delete contact |

### Deals

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/crm/deals` | List deals |
| POST | `/api/crm/deals` | Create deal |
| PATCH | `/api/crm/deals/:id` | Update deal |
| DELETE | `/api/crm/deals/:id` | Delete deal |

## Requires

- `@stormeoio/auth`

## License

MIT
