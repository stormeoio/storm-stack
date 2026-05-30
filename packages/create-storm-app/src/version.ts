import fs from "node:fs";
import path from "node:path";

const FALLBACK_VERSION = "0.1.0";

function readPackageVersion(): string {
  try {
    const packageJsonPath = path.resolve(__dirname, "../package.json");
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

export const VERSION = readPackageVersion();
