import { describe, it, expect, afterEach } from "vitest";
import {
  createTestContext,
  createMockPlugin,
  resetMockCounter,
  expectEventEmitted,
  expectEventNotEmitted,
  getEmittedEvents,
} from "@stormstack/testing";

afterEach(() => resetMockCounter());

describe("createTestContext", () => {
  it("creates a context with default values", () => {
    const ctx = createTestContext();

    expect(ctx.env.NODE_ENV).toBe("test");
    expect(ctx.env.DATABASE_URL).toContain("test");
    expect(ctx.env.SESSION_SECRET).toBeTruthy();
    expect(ctx.db).toBeDefined();
    expect(ctx.events).toBeDefined();
    expect(ctx.logger).toBeDefined();
  });

  it("accepts env overrides", () => {
    const ctx = createTestContext({
      env: { NODE_ENV: "development", CUSTOM_VAR: "hello" },
    });

    expect(ctx.env.NODE_ENV).toBe("development");
    expect(ctx.env.CUSTOM_VAR).toBe("hello");
    expect(ctx.env.DATABASE_URL).toContain("test");
  });

  it("accepts a custom db", () => {
    const fakeDb = { query: () => [] } as unknown as ReturnType<typeof createTestContext>["db"];
    const ctx = createTestContext({ db: fakeDb });
    expect(ctx.db).toBe(fakeDb);
  });

  it("event bus is functional", async () => {
    const ctx = createTestContext();
    const received: string[] = [];

    ctx.events.on("test.event", async (event) => {
      received.push(event.name);
    });

    await ctx.events.emit("test.event", {});
    expect(received).toEqual(["test.event"]);
  });
});

describe("createMockPlugin", () => {
  it("creates a plugin with defaults", () => {
    const plugin = createMockPlugin();

    expect(plugin.id).toContain("@stormstack/test-plugin-");
    expect(plugin.name).toContain("TestPlugin");
    expect(plugin.version).toBe("1.0.0");
    expect(plugin.description).toContain("Mock plugin");
  });

  it("accepts overrides", () => {
    const plugin = createMockPlugin({
      id: "@stormstack/my-custom",
      name: "MyCustom",
      version: "2.0.0",
    });

    expect(plugin.id).toBe("@stormstack/my-custom");
    expect(plugin.name).toBe("MyCustom");
    expect(plugin.version).toBe("2.0.0");
  });

  it("accepts lifecycle hooks", () => {
    const onBoot = async () => {};
    const plugin = createMockPlugin({ lifecycle: { onBoot } });

    expect(plugin.lifecycle?.onBoot).toBe(onBoot);
  });

  it("increments counter for unique IDs", () => {
    const a = createMockPlugin();
    const b = createMockPlugin();
    expect(a.id).not.toBe(b.id);
  });
});

describe("event assertions", () => {
  it("expectEventEmitted passes when event was emitted", async () => {
    const ctx = createTestContext();
    await ctx.events.emit("plugin.booted", { pluginId: "test" });

    expect(() => expectEventEmitted(ctx.events, "plugin.booted")).not.toThrow();
  });

  it("expectEventEmitted throws when event was not emitted", () => {
    const ctx = createTestContext();

    expect(() => expectEventEmitted(ctx.events, "plugin.booted")).toThrow(
      /Expected event "plugin.booted" to have been emitted/,
    );
  });

  it("expectEventNotEmitted passes when event was not emitted", () => {
    const ctx = createTestContext();

    expect(() => expectEventNotEmitted(ctx.events, "plugin.booted")).not.toThrow();
  });

  it("expectEventNotEmitted throws when event was emitted", async () => {
    const ctx = createTestContext();
    await ctx.events.emit("plugin.booted", { pluginId: "test" });

    expect(() => expectEventNotEmitted(ctx.events, "plugin.booted")).toThrow(
      /NOT to have been emitted/,
    );
  });

  it("getEmittedEvents filters by name", async () => {
    const ctx = createTestContext();
    await ctx.events.emit("plugin.booted", { pluginId: "a" });
    await ctx.events.emit("plugin.config.updated", { pluginId: "b", config: {} });
    await ctx.events.emit("plugin.booted", { pluginId: "c" });

    const booted = getEmittedEvents(ctx.events, "plugin.booted");
    expect(booted).toHaveLength(2);
    expect(booted[0]!.payload.pluginId).toBe("a");
    expect(booted[1]!.payload.pluginId).toBe("c");
  });

  it("getEmittedEvents returns all when no filter", async () => {
    const ctx = createTestContext();
    await ctx.events.emit("plugin.booted", { pluginId: "a" });
    await ctx.events.emit("plugin.config.updated", { pluginId: "b", config: {} });

    const all = getEmittedEvents(ctx.events);
    expect(all).toHaveLength(2);
  });
});
