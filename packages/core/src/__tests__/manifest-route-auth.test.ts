import fs from "fs";
import os from "os";
import path from "path";
import express, { type Express, type RequestHandler } from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createTestRequest } from "./test-utils";
import { bootstrapPlugins } from "../plugin/bootstrap";
import { initConfigStore } from "../plugin/config-store";
import { eventBus } from "../plugin/event-bus";
import {
  mountManifestRoute,
  type ManifestRouteGuards,
} from "../plugin/manifest-route";
import { registry } from "../plugin/registry";
import type { StormContext } from "../plugin/types";

const TEST_PLUGIN_ID = "@stormstack/manifest-auth-test";
const USER_HEADERS = {
  "x-test-user-id": "user-1",
  "x-test-user-role": "member",
};
const ADMIN_HEADERS = {
  "x-test-user-id": "admin-1",
  "x-test-user-role": "admin",
};

const databaseBackedAdminGuard: RequestHandler = (req, res, next) => {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }
  next();
};

let projectRoot: string;
let testContext: StormContext;

function createApp(guards?: ManifestRouteGuards): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("x-test-user-id");
    if (id) {
      req.user = {
        id,
        email: `${id}@example.test`,
        role: req.header("x-test-user-role") ?? "member",
      };
    }
    next();
  });
  app.use("/api/storm", mountManifestRoute("/api", guards));
  return app;
}

beforeAll(() => {
  if (!registry.has(TEST_PLUGIN_ID)) {
    registry.register({
      id: TEST_PLUGIN_ID,
      name: "Manifest auth test",
      version: "1.0.0",
      description: "Plugin used to exercise manifest administration guards",
      configSchema: z.object({
        enabled: z.boolean().default(false),
        label: z.string().default("initial"),
      }),
      client: {
        routes: [{ path: "/manifest-auth-test", component: "ManifestAuthTest" }],
      },
      events: {
        emits: ["manifest-auth-test.updated"],
      },
    });
  }
});

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "storm-manifest-auth-"));
  fs.writeFileSync(path.join(projectRoot, "storm-config.json"), "{}", "utf8");
  initConfigStore(projectRoot);
  eventBus.clear();

  testContext = {
    db: {} as StormContext["db"],
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SESSION_SECRET: "test-secret-at-least-32-characters-long",
      NODE_ENV: "test",
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    events: eventBus,
  };
  eventBus.setContext(testContext);
});

afterEach(() => {
  eventBus.clear();
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

afterAll(() => {
  eventBus.clear();
});

describe("public Storm discovery routes", () => {
  it("keeps manifest, plugin metadata and catalog publicly readable", async () => {
    const request = createTestRequest(createApp());
    const manifest = await request.get("/api/storm/manifest");
    const plugins = await request.get("/api/storm/plugins");
    const catalog = await request.get("/api/storm/catalog");

    expect(manifest.status).toBe(200);
    expect(manifest.body).toMatchObject({
      routes: expect.arrayContaining([
        expect.objectContaining({ path: "/manifest-auth-test" }),
      ]),
    });
    expect(plugins.status).toBe(200);
    expect(catalog.status).toBe(200);
  });
});

describe("protected Storm configuration reads", () => {
  it("keeps an existing bootstrapped app fail-closed until it injects requireAdmin", async () => {
    const jwtAdminAuthentication: RequestHandler = (req, _res, next) => {
      req.user = { id: "jwt-admin", email: "jwt-admin@example.test", role: "admin" };
      next();
    };
    const appWithoutGuard = express();
    appWithoutGuard.use(express.json());
    await bootstrapPlugins({
      app: appWithoutGuard,
      ctx: testContext,
      projectRoot,
      isAuthenticated: jwtAdminAuthentication,
    });
    const requestWithoutGuard = createTestRequest(appWithoutGuard);

    expect((await requestWithoutGuard.get("/api/storm/config")).status).toBe(503);
    expect((await requestWithoutGuard.get("/api/storm/events")).status).toBe(503);
    expect(
      (await requestWithoutGuard.patch(
        `/api/storm/config/${encodeURIComponent(TEST_PLUGIN_ID)}`,
        { body: { enabled: true, label: "must-not-be-written" } },
      )).status,
    ).toBe(503);

    const appWithGuard = express();
    appWithGuard.use(express.json());
    await bootstrapPlugins({
      app: appWithGuard,
      ctx: testContext,
      projectRoot,
      isAuthenticated: jwtAdminAuthentication,
      requireAdmin: databaseBackedAdminGuard,
    });
    const requestWithGuard = createTestRequest(appWithGuard);

    const configBeforeWrite = await requestWithGuard.get(
      `/api/storm/config/${encodeURIComponent(TEST_PLUGIN_ID)}`,
    );
    expect(configBeforeWrite.body).toMatchObject({
      config: { enabled: false, label: "initial" },
    });
    expect((await requestWithGuard.get("/api/storm/events")).status).toBe(200);
    expect(
      (await requestWithGuard.patch(
        `/api/storm/config/${encodeURIComponent(TEST_PLUGIN_ID)}`,
        { body: { enabled: true, label: "guarded-write" } },
      )).status,
    ).toBe(200);
  });

  it("returns 401 without an authenticated user", async () => {
    const request = createTestRequest(createApp());

    expect((await request.get("/api/storm/config")).status).toBe(401);
    expect(
      (await request.get(`/api/storm/config/${encodeURIComponent(TEST_PLUGIN_ID)}`)).status,
    ).toBe(401);
  });

  it("fails closed without an injected admin guard, even for a JWT-derived admin claim", async () => {
    const request = createTestRequest(createApp());

    const allConfigs = await request.get("/api/storm/config", { headers: ADMIN_HEADERS });
    const pluginConfig = await request.get(
      `/api/storm/config/${encodeURIComponent(TEST_PLUGIN_ID)}`,
      { headers: ADMIN_HEADERS },
    );

    expect(allConfigs.status).toBe(503);
    expect(allConfigs.body).toEqual({
      error: "Administration Storm indisponible : requireAdmin n'est pas configuré",
      code: "STORM_ADMIN_GUARD_REQUIRED",
    });
    expect(pluginConfig.status).toBe(503);
  });

  it("returns 403 when an injected admin policy denies the authenticated user", async () => {
    const request = createTestRequest(createApp({ requireAdmin: databaseBackedAdminGuard }));

    expect((await request.get("/api/storm/config", { headers: USER_HEADERS })).status).toBe(403);
    expect(
      (await request.get(`/api/storm/config/${encodeURIComponent(TEST_PLUGIN_ID)}`, {
        headers: USER_HEADERS,
      })).status,
    ).toBe(403);
  });

  it("allows an injected admin policy to read configuration", async () => {
    const request = createTestRequest(createApp({ requireAdmin: databaseBackedAdminGuard }));

    const allConfigs = await request.get("/api/storm/config", { headers: ADMIN_HEADERS });
    const pluginConfig = await request.get(
      `/api/storm/config/${encodeURIComponent(TEST_PLUGIN_ID)}`,
      { headers: ADMIN_HEADERS },
    );

    expect(allConfigs.status).toBe(200);
    expect(allConfigs.body).toMatchObject({
      configs: {
        [TEST_PLUGIN_ID]: { enabled: false, label: "initial" },
      },
    });
    expect(pluginConfig.status).toBe(200);
    expect(pluginConfig.body).toMatchObject({
      pluginId: TEST_PLUGIN_ID,
      config: { enabled: false, label: "initial" },
    });
  });
});

describe("Storm administration authorization", () => {
  it("returns 401 for unauthenticated config mutations and event history", async () => {
    const request = createTestRequest(createApp());

    expect(
      (await request.patch(`/api/storm/config/${encodeURIComponent(TEST_PLUGIN_ID)}`, {
        body: { enabled: true, label: "updated" },
      })).status,
    ).toBe(401);
    expect((await request.get("/api/storm/events")).status).toBe(401);
  });

  it("fails closed before config writes or event reads without an injected admin guard", async () => {
    const request = createTestRequest(createApp());

    const mutation = await request.patch(
      `/api/storm/config/${encodeURIComponent(TEST_PLUGIN_ID)}`,
      {
        headers: ADMIN_HEADERS,
        body: { enabled: true, label: "must-not-be-written" },
      },
    );
    const events = await request.get("/api/storm/events", { headers: ADMIN_HEADERS });

    expect(mutation.status).toBe(503);
    expect(events.status).toBe(503);

    const guardedRequest = createTestRequest(createApp({
      requireAdmin: databaseBackedAdminGuard,
    }));
    const config = await guardedRequest.get(
      `/api/storm/config/${encodeURIComponent(TEST_PLUGIN_ID)}`,
      { headers: ADMIN_HEADERS },
    );
    expect(config.body).toMatchObject({
      config: { enabled: false, label: "initial" },
    });
  });

  it("returns 403 when an injected admin policy denies config mutations and event history", async () => {
    const request = createTestRequest(createApp({ requireAdmin: databaseBackedAdminGuard }));

    expect(
      (await request.patch(`/api/storm/config/${encodeURIComponent(TEST_PLUGIN_ID)}`, {
        headers: USER_HEADERS,
        body: { enabled: true, label: "updated" },
      })).status,
    ).toBe(403);
    expect((await request.get("/api/storm/events", { headers: USER_HEADERS })).status).toBe(403);
  });

  it("allows an injected admin policy to mutate configuration and inspect event history", async () => {
    await eventBus.emit(
      "manifest-auth-test.updated",
      { pluginId: TEST_PLUGIN_ID },
      TEST_PLUGIN_ID,
    );
    const request = createTestRequest(createApp({ requireAdmin: databaseBackedAdminGuard }));

    const mutation = await request.patch(
      `/api/storm/config/${encodeURIComponent(TEST_PLUGIN_ID)}`,
      {
        headers: ADMIN_HEADERS,
        body: { enabled: true, label: "updated" },
      },
    );
    const events = await request.get("/api/storm/events", { headers: ADMIN_HEADERS });

    expect(mutation.status).toBe(200);
    expect(mutation.body).toMatchObject({
      pluginId: TEST_PLUGIN_ID,
      config: { enabled: true, label: "updated" },
    });
    expect(events.status).toBe(200);
    expect(events.body).toMatchObject({
      history: expect.arrayContaining([
        expect.objectContaining({
          name: "manifest-auth-test.updated",
          source: TEST_PLUGIN_ID,
        }),
      ]),
    });
  });

  it("supports injected authentication and administration policies", async () => {
    const isAuthenticated = vi.fn<RequestHandler>((_req, _res, next) => next());
    const requireAdmin = vi.fn<RequestHandler>((_req, _res, next) => next());
    const request = createTestRequest(createApp({ isAuthenticated, requireAdmin }));

    const response = await request.patch(
      `/api/storm/config/${encodeURIComponent(TEST_PLUGIN_ID)}`,
      { body: { enabled: true, label: "custom-policy" } },
    );

    expect(response.status).toBe(200);
    expect(isAuthenticated).toHaveBeenCalledOnce();
    expect(requireAdmin).toHaveBeenCalledOnce();
  });
});
