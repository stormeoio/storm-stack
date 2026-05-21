# @stormstack/crm — Claude Copilot Guide

## What this plugin does
Contacts, organizations, and a sales pipeline (deals). Provides CRUD APIs and React pages for managing customer relationships.

## Schema (Drizzle — PostgreSQL)

### `storm_contacts`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID |
| firstName | text NOT NULL | |
| lastName | text NOT NULL | |
| email | text | nullable |
| phone | text | nullable |
| status | text | Default "active" |
| organizationId | text FK → organizations | nullable |
| ownerId | text FK → users | nullable |
| created_at / updated_at | timestamptz | |

### `storm_organizations`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID |
| name | text NOT NULL | |
| domain | text | nullable |
| industry | text | nullable |

### `storm_deals`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID |
| title | text NOT NULL | |
| value | integer | Default 0 |
| stage | text | Default "lead" |
| contactId | text FK → contacts | nullable |
| organizationId | text FK → organizations | nullable |
| ownerId | text FK → users | |

## API Routes (mounted at `/api/crm`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /contacts | Yes | List contacts (paginated) |
| POST | /contacts | Yes | Create contact |
| GET | /contacts/:id | Yes | Get contact |
| PATCH | /contacts/:id | Yes | Update contact |
| DELETE | /contacts/:id | Yes | Delete contact |
| GET | /organizations | Yes | List organizations |
| POST | /organizations | Yes | Create organization |
| GET | /deals | Yes | List deals |
| POST | /deals | Yes | Create deal |
| PATCH | /deals/:id | Yes | Update deal (stage, value) |

## Client Components
| Component | Path | Description |
|-----------|------|-------------|
| CrmPage | /crm | Contacts list + create form |
| ContactDetailPage | /crm/contacts/:id | Contact detail view |
| DealsPage | /crm/deals | Pipeline / deals list |

## Exports
```ts
// Server
import { crmPlugin } from "@stormstack/crm";
import { contacts, organizations, deals } from "@stormstack/crm";

// Client
import { CrmPage, ContactDetailPage, DealsPage } from "@stormstack/crm/client";
```

## Requires
- `@stormstack/auth` — uses `isAuthenticated` middleware and `users` table FK

## Common Customizations

### Add a custom field to contacts
1. Edit `schema.ts` → add column to `storm_contacts`
2. Update `routes.ts` → include in create/update Zod schemas + select
3. Update `client/CrmPage.tsx` → add form field
4. Run `npm run db:push`

### Add a pipeline stage
Edit `routes.ts` → modify the `stage` validation in the deal create/update Zod schema.

### Filter contacts by organization
```ts
const orgContacts = await db.select().from(contacts)
  .where(eq(contacts.organizationId, orgId)).limit(100);
```
