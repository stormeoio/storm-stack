import { describe, expect, it } from "vitest";
import { resolveLatestVersion } from "../commands/update";
import { resolvePlugin } from "../registry";
import { VERSION } from "../version";

describe("storm update version resolution", () => {
  it("follows the packaged CLI release train", () => {
    const plugin = resolvePlugin("auth");
    if (!plugin) throw new Error("Auth plugin metadata missing");

    expect(resolveLatestVersion(plugin)).toBe(VERSION);
  });
});
