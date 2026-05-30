# @stormstack/testing

Testing utilities for Storm Stack plugins: test contexts, Express test apps, request helpers, mock plugins, and event assertions.

## Installation

```bash
npm install -D @stormstack/testing vitest
```

## Usage

```ts
import { describe, expect, it } from "vitest";
import { createTestApp, createMockPlugin, expectEventEmitted } from "@stormstack/testing";

describe("my plugin", () => {
  it("boots and emits events", async () => {
    const plugin = createMockPlugin({
      id: "acme/test-plugin",
      lifecycle: {
        onBoot: async ({ events }) => {
          await events.emit("acme.booted", { ok: true }, "acme/test-plugin");
        },
      },
    });

    const { ctx, cleanup } = await createTestApp({ plugins: [plugin] });

    expectEventEmitted(ctx.events, "acme.booted");
    cleanup();
  });
});
```

## Helpers

| Export | Description |
|--------|-------------|
| `createTestContext` | Creates a `StormContext` with test env, logger, and event bus |
| `createTestApp` | Boots plugins into an isolated Express app |
| `createTestRequest` | HTTP helpers for `get`, `post`, `put`, `patch`, and `delete` |
| `createMockPlugin` | Minimal `StormPlugin` factory for lifecycle and dependency tests |
| `resetMockCounter` | Resets generated mock plugin names |
| `expectEventEmitted` | Throws if an event was not emitted |
| `expectEventNotEmitted` | Throws if an event was emitted |
| `getEmittedEvents` | Reads event history, optionally filtered by name |

## License

MIT
