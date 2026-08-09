import { createHmac } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CSRF_COOKIE_NAME,
  CSRF_ERROR,
  CSRF_HEADER_NAME,
  createCsrfProtection,
} from "../security/csrf";

const SECRET = "storm-stack-test-session-secret-with-more-than-32-characters";
const ALLOWED_ORIGIN = "https://app.example.com";

interface IssuedToken {
  cookie: string;
  token: string;
}

describe("createCsrfProtection", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    const csrf = createCsrfProtection({
      secret: SECRET,
      allowedOrigins: [ALLOWED_ORIGIN],
      secure: false,
    });

    app.get("/api/storm/csrf", csrf.issueToken);
    app.use(csrf.protect);
    app.all("/protected", (_req, res) => {
      res.json({ ok: true });
    });

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  async function issueToken(): Promise<IssuedToken> {
    const response = await fetch(`${baseUrl}/api/storm/csrf`);
    const body = await response.json() as { csrfToken: string };
    const setCookie = response.headers.get("set-cookie");
    if (!setCookie) {
      throw new Error("Expected CSRF Set-Cookie header");
    }

    return {
      cookie: setCookie.split(";", 1)[0]!,
      token: body.csrfToken,
    };
  }

  async function unsafeRequest(
    method: string,
    options: {
      origin?: string;
      referer?: string;
      cookie?: string;
      header?: string;
    } = {},
  ): Promise<Response> {
    const headers = new Headers();
    if (options.origin) headers.set("Origin", options.origin);
    if (options.referer) headers.set("Referer", options.referer);
    if (options.cookie) headers.set("Cookie", options.cookie);
    if (options.header) headers.set(CSRF_HEADER_NAME, options.header);
    return fetch(`${baseUrl}/protected`, { method, headers });
  }

  async function expectStableRejection(response: Response): Promise<void> {
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: CSRF_ERROR });
  }

  it.each(["GET", "HEAD", "OPTIONS"])(
    "lets the safe %s method through without an origin or token",
    async (method) => {
      const response = await fetch(`${baseUrl}/protected`, { method });

      expect(response.status).toBe(200);
      if (method !== "HEAD") {
        await expect(response.json()).resolves.toEqual({ ok: true });
      }
    },
  );

  it("issues a readable cookie containing a correctly signed token", async () => {
    const { cookie, token } = await issueToken();
    const [nonce, signature] = token.split(".");
    const expectedSignature = createHmac("sha256", SECRET).update(nonce!).digest("base64url");

    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(signature).toBe(expectedSignature);
    expect(cookie).toBe(`${CSRF_COOKIE_NAME}=${token}`);

    const response = await fetch(`${baseUrl}/api/storm/csrf`);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("HttpOnly");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reuses an existing valid signed cookie instead of rotating it", async () => {
    const issued = await issueToken();
    const response = await fetch(`${baseUrl}/api/storm/csrf`, {
      headers: { Cookie: issued.cookie },
    });

    await expect(response.json()).resolves.toEqual({ csrfToken: issued.token });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("replaces an invalid CSRF cookie", async () => {
    const response = await fetch(`${baseUrl}/api/storm/csrf`, {
      headers: { Cookie: `${CSRF_COOKIE_NAME}=invalid.signature` },
    });
    const body = await response.json() as { csrfToken: string };

    expect(body.csrfToken).not.toBe("invalid.signature");
    expect(response.headers.get("set-cookie")).toContain(`${CSRF_COOKIE_NAME}=`);
  });

  it("rejects an unsafe request when both Origin and Referer are absent", async () => {
    const issued = await issueToken();
    await expectStableRejection(await unsafeRequest("POST", {
      cookie: issued.cookie,
      header: issued.token,
    }));
  });

  it("does not fall back to Referer when Origin is present but invalid", async () => {
    const issued = await issueToken();
    await expectStableRejection(await unsafeRequest("POST", {
      origin: "https://attacker.example",
      referer: `${ALLOWED_ORIGIN}/settings`,
      cookie: issued.cookie,
      header: issued.token,
    }));
  });

  it("accepts a valid Referer origin when Origin is absent", async () => {
    const issued = await issueToken();
    const response = await unsafeRequest("POST", {
      referer: `${ALLOWED_ORIGIN}/settings?tab=privacy`,
      cookie: issued.cookie,
      header: issued.token,
    });

    expect(response.status).toBe(200);
  });

  it.each([
    { label: "cookie", cookie: undefined, header: "token" },
    { label: "header", cookie: `${CSRF_COOKIE_NAME}=token`, header: undefined },
    { label: "matching cookie/header", cookie: `${CSRF_COOKIE_NAME}=token-a`, header: "token-b" },
  ])("rejects a missing or divergent $label", async ({ cookie, header }) => {
    await expectStableRejection(await unsafeRequest("POST", {
      origin: ALLOWED_ORIGIN,
      cookie,
      header,
    }));
  });

  it("rejects a matching cookie/header with an invalid signature", async () => {
    const issued = await issueToken();
    const invalidToken = `${issued.token.slice(0, -1)}${issued.token.endsWith("a") ? "b" : "a"}`;

    await expectStableRejection(await unsafeRequest("POST", {
      origin: ALLOWED_ORIGIN,
      cookie: `${CSRF_COOKIE_NAME}=${invalidToken}`,
      header: invalidToken,
    }));
  });

  it("protects a non-standard PURGE request", async () => {
    const issued = await issueToken();

    await expectStableRejection(await unsafeRequest("PURGE", {
      origin: ALLOWED_ORIGIN,
      cookie: issued.cookie,
    }));
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "PURGE"] as const)(
    "accepts a valid %s request",
    async (method) => {
      const issued = await issueToken();
      const response = await unsafeRequest(method, {
        origin: ALLOWED_ORIGIN,
        cookie: issued.cookie,
        header: issued.token,
      });

      expect(response.status).toBe(200);
    },
  );

  it("fails fast when SESSION_SECRET is empty", () => {
    expect(() => createCsrfProtection({ secret: "", allowedOrigins: [ALLOWED_ORIGIN] }))
      .toThrow("CSRF secret must not be empty");
  });
});
