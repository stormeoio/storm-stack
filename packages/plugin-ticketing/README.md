# @stormeoio/ticketing

Support ticketing plugin for Storm Stack — tickets, comments, and labels.

## Installation

```bash
npm install @stormeoio/ticketing
```

## Usage

```ts
import { ticketingPlugin } from "@stormeoio/ticketing";
import { registry } from "@stormeoio/core";

registry.register(ticketingPlugin);
```

## API Routes

### Tickets

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ticketing` | List tickets (filter: `?status=open`) |
| POST | `/api/ticketing` | Create ticket |
| GET | `/api/ticketing/:id` | Get ticket + comments |
| PATCH | `/api/ticketing/:id` | Update ticket |
| DELETE | `/api/ticketing/:id` | Delete ticket |

### Comments

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ticketing/:id/comments` | Add comment |
| PATCH | `/api/ticketing/:id/comments/:commentId` | Edit comment |
| DELETE | `/api/ticketing/:id/comments/:commentId` | Delete comment |

### Labels

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ticketing/labels` | List labels |
| POST | `/api/ticketing/labels` | Create label |
| DELETE | `/api/ticketing/labels/:id` | Delete label |

## Requires

- `@stormeoio/auth`

## License

MIT
