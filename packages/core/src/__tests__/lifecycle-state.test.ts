import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  initLifecycleState,
  isPluginInstalled,
  markPluginInstalled,
  markPluginUninstalled,
  getInstalledPluginIds,
} from "../plugin/lifecycle-state";

const TMP = path.resolve(__dirname, "../../.test-lifecycle");

describe("lifecycle-state", () => {
  beforeEach(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    initLifecycleState(TMP);
  });
  afterEach(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("starts empty when no state file exists", () => {
    expect(getInstalledPluginIds()).toEqual([]);
    expect(isPluginInstalled("@stormeoio/auth")).toBe(false);
  });

  it("marks a plugin as installed", () => {
    markPluginInstalled("@stormeoio/auth");

    expect(isPluginInstalled("@stormeoio/auth")).toBe(true);
    expect(getInstalledPluginIds()).toEqual(["@stormeoio/auth"]);
  });

  it("persists state to disk", () => {
    markPluginInstalled("@stormeoio/auth");
    markPluginInstalled("@stormeoio/crm");

    const raw = JSON.parse(fs.readFileSync(path.join(TMP, "storm-lifecycle.json"), "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.installed).toEqual(["@stormeoio/auth", "@stormeoio/crm"]);
  });

  it("reloads state from disk", () => {
    fs.writeFileSync(
      path.join(TMP, "storm-lifecycle.json"),
      JSON.stringify({ version: 1, installed: ["@stormeoio/crm"] }),
    );

    initLifecycleState(TMP);
    expect(isPluginInstalled("@stormeoio/crm")).toBe(true);
    expect(isPluginInstalled("@stormeoio/auth")).toBe(false);
  });

  it("marks a plugin as uninstalled", () => {
    markPluginInstalled("@stormeoio/auth");
    markPluginInstalled("@stormeoio/crm");

    markPluginUninstalled("@stormeoio/auth");
    expect(isPluginInstalled("@stormeoio/auth")).toBe(false);
    expect(getInstalledPluginIds()).toEqual(["@stormeoio/crm"]);
  });

  it("is idempotent on double install", () => {
    markPluginInstalled("@stormeoio/auth");
    markPluginInstalled("@stormeoio/auth");
    expect(getInstalledPluginIds()).toEqual(["@stormeoio/auth"]);
  });

  it("handles corrupt state file gracefully", () => {
    fs.writeFileSync(path.join(TMP, "storm-lifecycle.json"), "not json{{{");
    initLifecycleState(TMP);
    expect(getInstalledPluginIds()).toEqual([]);
  });
});
