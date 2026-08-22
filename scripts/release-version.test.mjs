// @vitest-environment node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { assertStableReleaseVersion } from "./release-version.mjs";

describe("assertStableReleaseVersion", () => {
  it("accepts stable strict SemVer versions", () => {
    expect(assertStableReleaseVersion("0.1.1")).toBe("0.1.1");
  });

  it("rejects malformed, prerelease, and build-metadata versions", () => {
    expect(() => assertStableReleaseVersion("01.2.3")).toThrow("strict SemVer");
    expect(() => assertStableReleaseVersion("1.2.3\n")).toThrow("strict SemVer");
    expect(() => assertStableReleaseVersion("0.2.0-beta.1")).toThrow("explicit npm dist-tag");
    expect(() => assertStableReleaseVersion("2.0.0+build.7")).toThrow("Build-metadata version");
  });

  it("makes the release package checker fail before accepting a prerelease", () => {
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/check-release-package-versions.mjs"), "0.2.0-beta.1"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Prerelease version");
  });
});
