import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", scaffold: "src/scaffold.ts" },
  format: ["cjs"],
  target: "node20",
  sourcemap: false,
  clean: true,
  splitting: false,
  banner: { js: "#!/usr/bin/env node" },
});
