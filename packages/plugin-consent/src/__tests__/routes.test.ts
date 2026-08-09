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
    withdrawnAt: null,
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

function createContext(
  db: StormContext["db"],
  emit = vi.fn(async (_event: string, _payload: unknown, _source: string) => {}),
): StormContext {
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
      emit,
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
  method: "GET" | "POST" | "PUT",
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

  it("renvoie l’état retiré avec son horodatage", async () => {
    const existing = createPreference({
      policyVersion: "2026-08",
      withdrawnAt: new Date("2026-08-09T01:02:03.000Z"),
    });
    const harness = createDbHarness(existing);
    const app = createApp(
      createContext(harness.db),
      authenticatedMiddleware(),
      () => "2026-08",
    );

    const response = await request(app, "GET", "/api/consent/state");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      consent: {
        necessary: true,
        analytics: false,
        marketing: false,
        policyVersion: "2026-08",
        withdrawnAt: "2026-08-09T01:02:03.000Z",
      },
      policyVersion: "2026-08",
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

  it("remet withdrawnAt à null lors de l’enregistrement de nouveaux choix", async () => {
    const harness = createDbHarness(createPreference({
      analytics: false,
      marketing: false,
      withdrawnAt: new Date("2026-08-09T01:02:03.000Z"),
    }));
    const app = createApp(createContext(harness.db), authenticatedMiddleware());

    const response = await request(app, "PUT", "/api/consent/preferences", {
      necessary: true,
      analytics: true,
      marketing: false,
      policyVersion: "1.0",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ consent: { withdrawnAt: null } });
    expect(harness.values).toHaveBeenLastCalledWith(expect.objectContaining({ withdrawnAt: null }));
    expect(harness.onConflictDoUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      set: expect.objectContaining({ withdrawnAt: null }),
    }));
    expect(harness.getPreference()?.withdrawnAt).toBeNull();
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

  it("retire une préférence absente avec la politique autoritaire du serveur", async () => {
    const harness = createDbHarness();
    const emit = vi.fn(async (_event: string, _payload: unknown, _source: string) => {});
    const app = createApp(
      createContext(harness.db, emit),
      authenticatedMiddleware(),
      () => "2026-08",
    );

    const response = await request(app, "POST", "/api/consent/withdraw", {});

    expect(response.status).toBe(200);
    expect(response.cacheControl).toBe("private, no-store");
    expect(response.body).toMatchObject({
      consent: {
        userId: "user-1",
        necessary: true,
        analytics: false,
        marketing: false,
        policyVersion: "2026-08",
        withdrawnAt: expect.any(String),
      },
    });
    expect(harness.values).toHaveBeenLastCalledWith(expect.objectContaining({
      userId: "user-1",
      necessary: true,
      analytics: false,
      marketing: false,
      policyVersion: "2026-08",
      withdrawnAt: expect.any(Date),
    }));
    expect(emit).toHaveBeenCalledWith(
      "consent.withdrawn",
      expect.objectContaining({
        userId: "user-1",
        policyVersion: "2026-08",
        withdrawnAt: expect.any(String),
      }),
      "@stormstack/consent",
    );
  });

  it("rend le retrait restrictif et répétable par upsert", async () => {
    const harness = createDbHarness(createPreference({
      analytics: true,
      marketing: true,
      policyVersion: "ancienne-politique",
    }));
    const app = createApp(
      createContext(harness.db),
      authenticatedMiddleware(),
      () => "politique-active",
    );

    const first = await request(app, "POST", "/api/consent/withdraw", {});
    const second = await request(app, "POST", "/api/consent/withdraw", {});

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(harness.insert).toHaveBeenCalledTimes(2);
    expect(harness.onConflictDoUpdate).toHaveBeenCalledTimes(2);
    expect(harness.getPreference()).toMatchObject({
      necessary: true,
      analytics: false,
      marketing: false,
      policyVersion: "politique-active",
      withdrawnAt: expect.any(Date),
    });
  });

  it("refuse tout champ dans le corps strict du retrait", async () => {
    const harness = createDbHarness();
    const emit = vi.fn(async (_event: string, _payload: unknown, _source: string) => {});
    const app = createApp(createContext(harness.db, emit), authenticatedMiddleware());

    const response = await request(app, "POST", "/api/consent/withdraw", {
      policyVersion: "version-cliente-interdite",
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Demande de retrait invalide" });
    expect(harness.insert).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("applique le middleware d’authentification aux trois routes", async () => {
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
    const withdrawResponse = await request(app, "POST", "/api/consent/withdraw", {});

    expect(getResponse.status).toBe(401);
    expect(putResponse.status).toBe(401);
    expect(withdrawResponse.status).toBe(401);
    expect(auth).toHaveBeenCalledTimes(3);
    expect(harness.select).not.toHaveBeenCalled();
    expect(harness.insert).not.toHaveBeenCalled();
  });
});
