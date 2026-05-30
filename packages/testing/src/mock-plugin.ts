import type { StormPlugin, PluginLifecycle, PluginId } from "@stormstack/core";

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
    id: opts.id ?? (`@stormstack/test-plugin-${n}` as PluginId),
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
