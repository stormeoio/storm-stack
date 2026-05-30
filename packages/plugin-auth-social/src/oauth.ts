export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export interface OAuthProviderDef {
  authUrl: string;
  tokenUrl: string;
  userUrl: string;
  scopes: string[];
  parseUser: (data: Record<string, unknown>) => { id: string; email: string; name: string };
}

export const PROVIDERS: Record<string, OAuthProviderDef> = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    scopes: ["openid", "email", "profile"],
    parseUser: (d) => ({
      id: String(d["sub"]),
      email: String(d["email"]),
      name: String(d["name"] ?? d["email"]),
    }),
  },
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userUrl: "https://api.github.com/user",
    scopes: ["read:user", "user:email"],
    parseUser: (d) => ({
      id: String(d["id"]),
      email: String(d["email"] ?? `${d["login"]}@github.local`),
      name: String(d["name"] ?? d["login"]),
    }),
  },
  gitlab: {
    authUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    userUrl: "https://gitlab.com/api/v4/user",
    scopes: ["read_user", "email"],
    parseUser: (d) => ({
      id: String(d["id"]),
      email: String(d["email"]),
      name: String(d["name"] ?? d["username"]),
    }),
  },
};

export function buildAuthUrl(
  provider: OAuthProviderDef,
  config: OAuthProviderConfig,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: "code",
    scope: provider.scopes.join(" "),
    state,
  });
  return `${provider.authUrl}?${params}`;
}

export async function exchangeCode(
  provider: OAuthProviderDef,
  config: OAuthProviderConfig,
  code: string
): Promise<string> {
  const resp = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
      grant_type: "authorization_code",
    }),
  });
  const data = (await resp.json()) as Record<string, unknown>;
  if (!data["access_token"]) throw new Error("OAuth token exchange failed");
  return String(data["access_token"]);
}

export async function fetchOAuthUser(
  provider: OAuthProviderDef,
  accessToken: string
): Promise<{ id: string; email: string; name: string }> {
  const resp = await fetch(provider.userUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const data = (await resp.json()) as Record<string, unknown>;
  return provider.parseUser(data);
}
