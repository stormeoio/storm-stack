import http from "node:http";
import express, { type Express, type RequestHandler } from "express";
import type { StormContext } from "@stormstack/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsentRoutes } from "../routes";
import { consentPreferences, type ConsentPreference } from "../schema";

interface TestResponse {
  status: number;
  body: unknown;
  cacheControl: string | null;
}

function createPreference(overrides: Partial<ConsentPreference> = {}): ConsentPreference {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "user-1",
    necessary: true,
    analytics: false,
    marketing: false,
    policyVersion: "1.0",
    createdAt: new Date("2026-08-09T00:00:00.000Z"),
    updatedAt: new Date("2026-08-09T00:00:00.000Z"),
    ...overrides,
  };
}

function createDbHarness(initial: ConsentPreference | null = null) {
  let preference = initial;
  let pendingValues: Record<string, unknown> = {};
  let pendingUpdate: Record<string, unknown> = {};

  const limit = vi.fn(async () => preference ? [preference] : []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const returning = vi.fn(async () => {
    if (preference) {
      preference = { ...preference, ...pendingUpdate };
    } else {
      preference = createPreference(pendingValues as Partial<ConsentPreference>);
    }
    return [preference];
  });
  const onConflictDoUpdate = vi.fn((options: { set: Record<string, unknown> }) => {
    pendingUpdate = options.set;
    return { returning };
  });
  const values = vi.fn((input: Record<string, unknown>) => {
    pendingValues = input;
    return { onConflictDoUpdate };
  });
  const insert = vi.fn(() => ({ values }));

  const db = { select, insert } as unknown as StormContext["db"];
  return {
    db,
    select,
    insert,
    values,
    onConflictDoUpdate,
    getPreference: () => preference,
  };
}

function createContext(db: StormContext["db"]): StormContext {
  return {
    db,
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SESSION_SECRET: "test-secret-at-least-32-characters-long",
      NODE_ENV: "test",
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    events: {
      emit: vi.fn(async () => {}),
    } as unknown as StormContext["events"],
  };
}

function authenticatedMiddleware(): RequestHandler {
  return (req, _res, next) => {
    req.user = { id: "user-1", email: "fred@example.test", role: "member" };
    next();
  };
}

function createApp(
  ctx: StormContext,
  isAuthenticated: RequestHandler,
  getPolicyVersion: () => string = () => "1.0",
): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/consent", createConsentRoutes(ctx, isAuthenticated, getPolicyVersion));
  return app;
}

async function request(
  app: Express,
  method: "GET" | "PUT",
  path: string,
  body?: unknown,
): Promise<TestResponse> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Port de test indisponible");

    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    return {
      status: response.status,
      body: await response.json(),
      cacheControl: response.headers.get("cache-control"),
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

afterEach(() => vi.restoreAllMocks());

describe("routes consentement", () => {
  it("renvoie un état absent", async () => {
    const harness = createDbHarness();
    const app = createApp(createContext(harness.db), authenticatedMiddleware());

    const response = await request(app, "GET", "/api/consent/state");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ consent: null, policyVersion: "1.0" });
    expect(response.cacheControl).toBe("private, no-store");
    expect(harness.select).toHaveBeenCalledOnce();
  });

  it("renvoie l’état existant de l’utilisateur authentifié", async () => {
    const existing = createPreference({ analytics: true, policyVersion: "2026-08" });
    const harness = createDbHarness(existing);
    const app = createApp(createContext(harness.db), authenticatedMiddleware());

    const response = await request(app, "GET", "/api/consent/state");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      consent: {
        userId: "user-1",
        necessary: true,
        analytics: true,
        marketing: false,
        policyVersion: "2026-08",
      },
    });
  });

  it("refuse un corps invalide et impose necessary à true", async () => {
    const harness = createDbHarness();
    const app = createApp(createContext(harness.db), authenticatedMiddleware());

    const response = await request(app, "PUT", "/api/consent/preferences", {
      necessary: false,
      analytics: true,
      marketing: false,
      policyVersion: "1.0",
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Préférences de consentement invalides" });
    expect(harness.insert).not.toHaveBeenCalled();
  });

  it("crée puis met à jour les préférences par upsert", async () => {
    const harness = createDbHarness();
    let policyVersion = "1.0";
    const app = createApp(
      createContext(harness.db),
      authenticatedMiddleware(),
      () => policyVersion,
    );

    const created = await request(app, "PUT", "/api/consent/preferences", {
      necessary: true,
      analytics: true,
      marketing: false,
      policyVersion: "1.0",
    });
    policyVersion = "2026-08";
    const updated = await request(app, "PUT", "/api/consent/preferences", {
      necessary: true,
      analytics: false,
      marketing: true,
      policyVersion: "2026-08",
    });

    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ consent: { analytics: true, marketing: false } });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      consent: {
        userId: "user-1",
        necessary: true,
        analytics: false,
        marketing: true,
        policyVersion: "2026-08",
      },
    });
    expect(harness.values).toHaveBeenCalledTimes(2);
    expect(harness.onConflictDoUpdate).toHaveBeenCalledTimes(2);
    expect(harness.values).toHaveBeenLastCalledWith(expect.objectContaining({
      userId: "user-1",
      necessary: true,
    }));
    expect(harness.onConflictDoUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      target: consentPreferences.userId,
    }));
    expect(harness.getPreference()).toMatchObject({ analytics: false, marketing: true });
  });

  it("impose la version de politique configurée côté serveur", async () => {
    const harness = createDbHarness();
    const app = createApp(
      createContext(harness.db),
      authenticatedMiddleware(),
      () => "2026-08",
    );

    const stale = await request(app, "PUT", "/api/consent/preferences", {
      necessary: true,
      analytics: true,
      marketing: false,
      policyVersion: "1.0",
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ policyVersion: "2026-08" });
    expect(harness.insert).not.toHaveBeenCalled();

    const accepted = await request(app, "PUT", "/api/consent/preferences", {
      necessary: true,
      analytics: true,
      marketing: false,
    });
    expect(accepted.status).toBe(200);
    expect(harness.getPreference()).toMatchObject({ policyVersion: "2026-08" });
  });

  it("applique le middleware d’authentification aux deux routes", async () => {
    const harness = createDbHarness();
    const auth = vi.fn<RequestHandler>((_req, res) => {
      res.status(401).json({ error: "Non authentifié" });
    });
    const app = createApp(createContext(harness.db), auth);

    const getResponse = await request(app, "GET", "/api/consent/state");
    const putResponse = await request(app, "PUT", "/api/consent/preferences", {
      necessary: true,
      analytics: false,
      marketing: false,
      policyVersion: "1.0",
    });

    expect(getResponse.status).toBe(401);
    expect(putResponse.status).toBe(401);
    expect(auth).toHaveBeenCalledTimes(2);
    expect(harness.select).not.toHaveBeenCalled();
    expect(harness.insert).not.toHaveBeenCalled();
  });
});
