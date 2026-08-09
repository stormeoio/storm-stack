import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyPluginSource } from "../commands/add";
import { resolvePlugin } from "../registry";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("plugin copy mode", () => {
  it("copies every ConsentBanner dependency, including its endpoint resolver", async () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "storm-consent-copy-"));
    temporaryDirectories.push(projectRoot);
    const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");

    await copyPluginSource(projectRoot, "plugins", consent, repositoryRoot);

    const copiedClient = path.join(projectRoot, "plugins/consent/client");
    expect(fs.existsSync(path.join(copiedClient, "ConsentBanner.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(copiedClient, "endpoints.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(copiedClient, "ConsentBanner.tsx"), "utf8"))
      .toContain('from "./endpoints"');
  });
});
