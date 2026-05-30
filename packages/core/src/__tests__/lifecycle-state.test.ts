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
    expect(isPluginInstalled("@stormstack/auth")).toBe(false);
  });

  it("marks a plugin as installed", () => {
    markPluginInstalled("@stormstack/auth");

    expect(isPluginInstalled("@stormstack/auth")).toBe(true);
    expect(getInstalledPluginIds()).toEqual(["@stormstack/auth"]);
  });

  it("persists state to disk", () => {
    markPluginInstalled("@stormstack/auth");
    markPluginInstalled("@stormstack/crm");

    const raw = JSON.parse(fs.readFileSync(path.join(TMP, "storm-lifecycle.json"), "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.installed).toEqual(["@stormstack/auth", "@stormstack/crm"]);
  });

  it("reloads state from disk", () => {
    fs.writeFileSync(
      path.join(TMP, "storm-lifecycle.json"),
      JSON.stringify({ version: 1, installed: ["@stormstack/crm"] }),
    );

    initLifecycleState(TMP);
    expect(isPluginInstalled("@stormstack/crm")).toBe(true);
    expect(isPluginInstalled("@stormstack/auth")).toBe(false);
  });

  it("marks a plugin as uninstalled", () => {
    markPluginInstalled("@stormstack/auth");
    markPluginInstalled("@stormstack/crm");

    markPluginUninstalled("@stormstack/auth");
    expect(isPluginInstalled("@stormstack/auth")).toBe(false);
    expect(getInstalledPluginIds()).toEqual(["@stormstack/crm"]);
  });

  it("is idempotent on double install", () => {
    markPluginInstalled("@stormstack/auth");
    markPluginInstalled("@stormstack/auth");
    expect(getInstalledPluginIds()).toEqual(["@stormstack/auth"]);
  });

  it("handles corrupt state file gracefully", () => {
    fs.writeFileSync(path.join(TMP, "storm-lifecycle.json"), "not json{{{");
    initLifecycleState(TMP);
    expect(getInstalledPluginIds()).toEqual([]);
  });
});
