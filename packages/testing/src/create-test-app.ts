import express, { type Express, type RequestHandler } from "express";
import type { StormPlugin, StormContext } from "@stormstack/core";
import { registry, bootstrapPlugins, eventBus } from "@stormstack/core";
import { createTestContext, type TestContextOptions } from "./create-test-context";
import { createTestRequest } from "./test-request";
import fs from "fs";
import path from "path";
import os from "os";

export interface TestAppOptions extends TestContextOptions {
  plugins: StormPlugin[];
  apiPrefix?: string;
  isAuthenticated?: RequestHandler;
  requireAdmin?: RequestHandler;
}

export interface TestApp {
  app: Express;
  ctx: StormContext;
  request: ReturnType<typeof createTestRequest>;
  cleanup: () => void;
}

export async function createTestApp(opts: TestAppOptions): Promise<TestApp> {
  const { plugins, apiPrefix = "/api", isAuthenticated, requireAdmin } = opts;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storm-test-"));

  const ctx = createTestContext(opts);
  const app = express();
  app.use(express.json());

  for (const plugin of plugins) {
    if (!registry.has(plugin.id)) {
      registry.register(plugin);
    }
  }

  await bootstrapPlugins({
    app,
    ctx,
    apiPrefix,
    projectRoot: tmpDir,
    isAuthenticated,
    requireAdmin,
  });

  const request = createTestRequest(app);

  const cleanup = () => {
    eventBus.clear();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return { app, ctx, request, cleanup };
}
