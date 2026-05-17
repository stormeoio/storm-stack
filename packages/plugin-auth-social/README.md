# @stormstack/auth-social

OAuth2 social login for Storm Stack — Google, GitHub, and GitLab. No passport dependency.

## Installation

```bash
npm install @stormstack/auth-social
```

## Usage

```ts
import { createSocialAuthPlugin } from "@stormstack/auth-social";
import { registry } from "@stormstack/core";

const socialAuth = createSocialAuthPlugin({
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    callbackUrl: "http://localhost:3000/api/auth-social/google/callback",
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    callbackUrl: "http://localhost:3000/api/auth-social/github/callback",
  },
});

registry.register(socialAuth);
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth-social/:provider` | Redirect to OAuth provider |
| GET | `/api/auth-social/:provider/callback` | Handle OAuth callback |

Supported providers: `google`, `github`, `gitlab`.

## Requires

- `@stormstack/auth` (for user creation and JWT)

## License

MIT
