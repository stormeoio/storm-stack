import { describe, expect, it } from "vitest";
import { detectInstalledPluginIds } from "../commands/init";

describe("storm init", () => {
  it("detects scoped plugins, collapses subpaths, and ignores core", () => {
    const content = `
      import { createStormApp } from "@stormeoio/core";
      import { authPlugin } from "@stormeoio/auth";
      import { authRoutes } from "@stormeoio/auth/routes";
      import { crmPlugin } from '@stormeoio/crm';
      import { externalPlugin } from "@example/external";
    `;

    expect(detectInstalledPluginIds(content)).toEqual([
      "@stormeoio/auth",
      "@stormeoio/crm",
    ]);
  });
});
