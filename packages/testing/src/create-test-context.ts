import type { StormContext, StormEnv, StormLogger } from "@stormstack/core";
import { StormEventBus } from "@stormstack/core";

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
