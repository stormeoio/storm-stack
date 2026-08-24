# @stormeoio/ticketing — Claude Copilot Guide

## What this plugin does
Support ticket management with priorities, statuses, comments, and labels. Provides APIs and React pages for a helpdesk workflow.

## Schema (Drizzle — PostgreSQL)

### `storm_tickets`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID |
| title | text NOT NULL | |
| description | text | nullable |
| status | text | Default "open" (open/in_progress/resolved/closed) |
| priority | text | Default "medium" (low/medium/high/urgent) |
| assigneeId | text FK → users | nullable |
| reporterId | text FK → users | |
| created_at / updated_at | timestamptz | |

### `storm_ticket_comments`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID |
| ticketId | text FK → tickets | CASCADE delete |
| authorId | text FK → users | |
| content | text NOT NULL | |
| created_at | timestamptz | |

### `storm_ticket_labels`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID |
| name | text NOT NULL | |
| color | text | Default "#6b7280" |

## API Routes (mounted at `/api/ticketing`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | / | Yes | List tickets (filterable by status, priority) |
| POST | / | Yes | Create ticket |
| GET | /:id | Yes | Get ticket with comments |
| PATCH | /:id | Yes | Update ticket (status, priority, assignee) |
| DELETE | /:id | Yes | Delete ticket |
| POST | /:id/comments | Yes | Add comment |
| GET | /labels | Yes | List labels |
| POST | /labels | Yes | Create label |

## Client Components
| Component | Path | Description |
|-----------|------|-------------|
| TicketsPage | /support | Ticket list + create form + status filters |
| TicketDetailPage | /support/:id | Ticket detail with comments |

## Exports
```ts
// Server
import { ticketingPlugin } from "@stormeoio/ticketing";
import { tickets, ticketComments, ticketLabels } from "@stormeoio/ticketing";

// Client
import { TicketsPage, TicketDetailPage } from "@stormeoio/ticketing/client";
```

## Requires
- `@stormeoio/auth` — uses `isAuthenticated` middleware and `users` table FK

## Common Customizations

### Add SLA / due dates
1. Edit `schema.ts` → add `dueAt` timestamp column to `storm_tickets`
2. Edit `routes.ts` → include in create/update schemas + add overdue filter
3. Edit `client/TicketsPage.tsx` → show due date badge
4. Run `npm run db:push`

### Assign ticket to user
```ts
await db.update(tickets)
  .set({ assigneeId: userId, status: "in_progress" })
  .where(eq(tickets.id, ticketId));
```

### Filter tickets by status
The GET / endpoint already accepts `?status=open&priority=high` query params.
