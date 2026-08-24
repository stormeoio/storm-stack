import type { Express } from "express";
import http from "http";
import { StormEventBus } from "../plugin/event-bus";
import type {
  PluginId,
  PluginLifecycle,
  StormContext,
  StormEnv,
  StormEventBus as StormEventBusType,
  StormLogger,
  StormPlugin,
} from "../plugin/types";

export interface TestContextOptions {
  env?: Partial<StormEnv>;
  db?: StormContext["db"];
  logger?: Partial<StormLogger>;
}

const noopLogger: StormLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function createTestContext(opts: TestContextOptions = {}): StormContext {
  const eventBus = new StormEventBus();

  const env: StormEnv = {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    SESSION_SECRET: "test-secret-at-least-32-characters-long",
    NODE_ENV: "test",
    ...opts.env,
  };

  const logger: StormLogger = {
    ...noopLogger,
    ...opts.logger,
  };

  const ctx: StormContext = {
    db: opts.db ?? ({} as StormContext["db"]),
    env,
    logger,
    events: eventBus,
  };

  eventBus.setContext(ctx);
  return ctx;
}

export interface MockPluginOptions {
  id?: PluginId;
  name?: string;
  version?: string;
  requires?: PluginId[];
  lifecycle?: PluginLifecycle;
}

let counter = 0;

export function createMockPlugin(opts: MockPluginOptions = {}): StormPlugin {
  const n = ++counter;
  return {
    id: opts.id ?? (`@stormeoio/test-plugin-${n}` as PluginId),
    name: opts.name ?? `TestPlugin${n}`,
    version: opts.version ?? "1.0.0",
    description: `Mock plugin #${n} for testing`,
    requires: opts.requires,
    lifecycle: opts.lifecycle,
  };
}

export function resetMockCounter(): void {
  counter = 0;
}

export function expectEventEmitted(events: StormEventBusType, eventName: string): void {
  const history = events.getHistory(200);
  const found = history.some((event) => event.name === eventName);
  if (!found) {
    const names = history.map((event) => event.name).join(", ");
    throw new Error(
      `Expected event "${eventName}" to have been emitted. Events seen: [${names || "none"}]`,
    );
  }
}

export function expectEventNotEmitted(events: StormEventBusType, eventName: string): void {
  const history = events.getHistory(200);
  const found = history.some((event) => event.name === eventName);
  if (found) {
    throw new Error(`Expected event "${eventName}" NOT to have been emitted, but it was.`);
  }
}

export function getEmittedEvents(events: StormEventBusType, eventName?: string) {
  const history = events.getHistory(200);
  if (!eventName) return history;
  return history.filter((event) => event.name === eventName);
}

export interface TestResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  text: string;
}

export interface TestRequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
}

function injectToServer(
  app: Express,
  method: string,
  path: string,
  opts: TestRequestOptions = {},
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      const bodyString = opts.body != null ? JSON.stringify(opts.body) : undefined;

      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...opts.headers,
      };

      if (bodyString) {
        headers["content-length"] = Buffer.byteLength(bodyString).toString();
      }

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          method: method.toUpperCase(),
          path,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let body: unknown;
            try {
              body = JSON.parse(text);
            } catch {
              body = text;
            }
            server.close();
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers as Record<string, string | string[] | undefined>,
              body,
              text,
            });
          });
        },
      );

      req.on("error", (error) => {
        server.close();
        reject(error);
      });

      if (bodyString) {
        req.write(bodyString);
      }
      req.end();
    });
  });
}

export function createTestRequest(app: Express) {
  return {
    get: (path: string, opts?: TestRequestOptions) => injectToServer(app, "GET", path, opts),
    post: (path: string, opts?: TestRequestOptions) => injectToServer(app, "POST", path, opts),
    put: (path: string, opts?: TestRequestOptions) => injectToServer(app, "PUT", path, opts),
    patch: (path: string, opts?: TestRequestOptions) => injectToServer(app, "PATCH", path, opts),
    delete: (path: string, opts?: TestRequestOptions) =>
      injectToServer(app, "DELETE", path, opts),
  };
}
