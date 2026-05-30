import fs from "fs";
import path from "path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { findProjectRoot } from "../config";

interface CreatePluginOptions {
  yes?: boolean;
}

export async function createPluginCommand(nameArg?: string, opts: CreatePluginOptions = {}): Promise<void> {
  // ── Gather info ─────────────────────────────────────────────────────────

  let pluginName = nameArg;
  let orgScope = "";
  let description = "";
  let requiresAuth = true;

  if (!pluginName && !opts.yes) {
    const input = await p.text({
      message: "Nom du plugin (kebab-case)",
      placeholder: "my-plugin",
      validate: (v) => {
        if (!/^[a-z][a-z0-9-]*$/.test(v)) return "Utilisez uniquement des lettres minuscules, chiffres et tirets";
      },
    });
    if (p.isCancel(input)) { p.cancel("Annulé."); return; }
    pluginName = input as string;
  }

  if (!pluginName) {
    p.log.error("Nom de plugin requis : " + pc.cyan("storm create-plugin <name>"));
    return;
  }

  if (!opts.yes) {
    const scope = await p.text({
      message: "Scope npm (organisation)",
      placeholder: "@my-org",
      defaultValue: "@stormstack",
    });
    if (p.isCancel(scope)) { p.cancel("Annulé."); return; }
    orgScope = (scope as string).replace(/^@?/, "@");

    const desc = await p.text({
      message: "Description",
      placeholder: `Plugin ${pluginName}`,
      defaultValue: `Plugin ${pluginName}`,
    });
    if (p.isCancel(desc)) { p.cancel("Annulé."); return; }
    description = desc as string;

    const auth = await p.confirm({
      message: "Dépend de @stormstack/auth ?",
      initialValue: true,
    });
    if (p.isCancel(auth)) { p.cancel("Annulé."); return; }
    requiresAuth = auth as boolean;
  } else {
    orgScope = "@stormstack";
    description = `Plugin ${pluginName}`;
  }

  // ── Determine target directory ──────────────────────────────────────────

  const root = findProjectRoot() ?? process.cwd();
  const isMonorepo = fs.existsSync(path.join(root, "packages"));
  const targetDir = isMonorepo
    ? path.join(root, "packages", `plugin-${pluginName}`)
    : path.join(root, `plugin-${pluginName}`);

  if (fs.existsSync(targetDir)) {
    p.log.error(`Le répertoire ${pc.dim(targetDir)} existe déjà.`);
    return;
  }

  // ── Scaffold ────────────────────────────────────────────────────────────

  const spinner = p.spinner();
  spinner.start("Génération du plugin...");

  const fullId = `${orgScope}/${pluginName}`;
  const exportName = toCamelCase(pluginName) + "Plugin";
  const tableName = pluginName.replace(/-/g, "_");

  const files: Record<string, string> = {
    "src/index.ts": renderPluginIndex(fullId, pluginName, exportName, description, requiresAuth, tableName),
    "src/schema.ts": renderPluginSchema(tableName),
    "src/routes.ts": renderPluginRoutes(tableName),
    "package.json": renderPackageJson(fullId, description, requiresAuth),
    "tsup.config.ts": renderTsupConfig(),
    "tsconfig.json": renderTsConfig(),
    "README.md": renderReadme(fullId, pluginName, description, exportName, requiresAuth),
  };

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(targetDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
  }

  spinner.stop(`${pc.green("✓")} Plugin ${pc.cyan(fullId)} généré`);

  p.log.info(`Répertoire : ${pc.dim(path.relative(process.cwd(), targetDir))}`);
  p.log.info("");
  p.log.info(pc.bold("Prochaines étapes :"));
  p.log.info(`  ${pc.cyan("1.")} cd ${path.relative(process.cwd(), targetDir)}`);
  p.log.info(`  ${pc.cyan("2.")} npm install`);
  p.log.info(`  ${pc.cyan("3.")} npm run build`);
  p.log.info(`  ${pc.cyan("4.")} Éditez src/index.ts, schema.ts, routes.ts`);
  p.log.info(`  ${pc.cyan("5.")} storm publish ${pluginName} --dry-run`);
  p.log.info("");
  p.log.info(`${pc.dim("Consultez")} ${pc.cyan("https://stormstack.dev/docs/creating-plugins")} ${pc.dim("pour le guide complet.")}`);
}

// ── Template renderers ──────────────────────────────────────────────────────

function renderPluginIndex(id: string, shortName: string, exportName: string, description: string, requiresAuth: boolean, tableName: string): string {
  return `import type { StormPlugin } from "@stormstack/core";
import { z } from "zod";
import { ${tableName}s } from "./schema";
import { create${toPascalCase(shortName)}Routes } from "./routes";

export { ${tableName}s } from "./schema";

export const ${exportName}: StormPlugin = {
  id: "${id}",
  name: "${toPascalCase(shortName)}",
  version: "0.1.0",
  description: "${description}",
  tags: ["${shortName}"],
  pricing: "free",
  ${requiresAuth ? `requires: ["@stormstack/auth"],` : `requires: [],`}

  schema: {
    tables: { ${tableName}s },
  },

  configSchema: z.object({
    enabled: z.boolean().default(true).describe("Activer le plugin"),
    maxItems: z.number().min(1).max(10000).default(100).describe("Nombre max d'éléments"),
  }),

  events: {
    emits: ["${shortName}.created", "${shortName}.updated", "${shortName}.deleted"],
  },

  routes: ({ ctx, isAuthenticated }) =>
    create${toPascalCase(shortName)}Routes(ctx, isAuthenticated),

  client: {
    navItems: [
      { id: "${shortName}", label: "${toPascalCase(shortName)}", icon: "Puzzle", path: "/${shortName}" },
    ],
    routes: [
      { path: "/${shortName}", component: "${toPascalCase(shortName)}Page", auth: ${requiresAuth} },
    ],
  },
};
`;
}

function renderPluginSchema(tableName: string): string {
  return `import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const ${tableName}s = pgTable("${tableName}s", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  tenantId: text("tenant_id").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
`;
}

function renderPluginRoutes(tableName: string): string {
  const pascalName = toPascalCase(tableName.replace(/_/g, "-"));
  return `import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { ${tableName}s } from "./schema";
import type { StormContext } from "@stormstack/core";
import type { RequestHandler } from "express";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
});

export function create${pascalName}Routes(ctx: StormContext, isAuthenticated: RequestHandler): Router {
  const router = Router();
  const { db, events } = ctx;

  router.get("/", isAuthenticated, async (req, res) => {
    const rows = await db.select().from(${tableName}s)
      .where(eq(${tableName}s.tenantId, req.tenant!.tenantId))
      .orderBy(desc(${tableName}s.createdAt))
      .limit(100);
    res.json({ items: rows });
  });

  router.post("/", isAuthenticated, async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const [row] = await db.insert(${tableName}s)
      .values({
        ...parsed.data,
        tenantId: req.tenant!.tenantId,
        createdBy: req.user!.id,
      })
      .returning();
    res.status(201).json({ item: row });

    events.emit("${tableName.replace(/_/g, "-")}.created", {
      itemId: row!.id,
      tenantId: req.tenant!.tenantId,
    }, "${tableName}").catch(() => {});
  });

  router.get("/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    const [row] = await db.select().from(${tableName}s)
      .where(and(eq(${tableName}s.id, id), eq(${tableName}s.tenantId, req.tenant!.tenantId)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Introuvable" }); return; }
    res.json({ item: row });
  });

  router.patch("/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    const parsed = createSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const [row] = await db.update(${tableName}s)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(${tableName}s.id, id), eq(${tableName}s.tenantId, req.tenant!.tenantId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Introuvable" }); return; }
    res.json({ item: row });
  });

  router.delete("/:id", isAuthenticated, async (req, res) => {
    const id = req.params["id"] as string;
    await db.delete(${tableName}s)
      .where(and(eq(${tableName}s.id, id), eq(${tableName}s.tenantId, req.tenant!.tenantId)));
    res.json({ ok: true });
  });

  return router;
}
`;
}

function renderPackageJson(id: string, description: string, requiresAuth: boolean): string {
  const shortName = id.split("/")[1]!;
  const deps: Record<string, string> = {
    "drizzle-orm": "^0.36.4",
    "zod": "^3.22.0",
  };
  const peerDeps: Record<string, string> = {
    "@stormstack/core": "^0.1.0",
  };
  if (requiresAuth) {
    peerDeps["@stormstack/auth"] = "^0.1.0";
  }

  return JSON.stringify({
    name: id,
    version: "0.1.0",
    description,
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.mjs",
        require: "./dist/index.js",
      },
    },
    scripts: {
      build: "tsup",
      dev: "tsup --watch",
      typecheck: "tsc --noEmit",
    },
    publishConfig: {
      access: "public",
      registry: "https://registry.npmjs.org/",
    },
    peerDependencies: peerDeps,
    dependencies: deps,
    devDependencies: {
      "@types/node": "^20.0.0",
      tsup: "^8.0.0",
      typescript: "^5.4.0",
    },
    license: "MIT",
    keywords: ["storm-stack", "plugin", shortName],
    files: ["dist", "README.md"],
  }, null, 2) + "\n";
}

function renderTsupConfig(): string {
  return `import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: [/^[^./]/],
});
`;
}

function renderTsConfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ES2022"],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: "dist",
      rootDir: "src",
      declaration: true,
      declarationMap: true,
      sourceMap: true,
    },
    include: ["src/**/*.ts"],
    exclude: ["node_modules", "dist"],
  }, null, 2) + "\n";
}

function renderReadme(id: string, shortName: string, description: string, exportName: string, requiresAuth: boolean): string {
  return `# ${id}

${description}

## Install

\`\`\`bash
storm add ${shortName}
# or copy source:
storm add ${shortName} --copy
\`\`\`

## Usage

\`\`\`ts
import { ${exportName} } from "${id}";
import { registry } from "@stormstack/core";

registry.register(${exportName});
\`\`\`

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | \`/api/${shortName}\` | List items |
| POST | \`/api/${shortName}\` | Create item |
| GET | \`/api/${shortName}/:id\` | Get item |
| PATCH | \`/api/${shortName}/:id\` | Update item |
| DELETE | \`/api/${shortName}/:id\` | Delete item |

## Events

- \`${shortName}.created\` — emitted after item creation
- \`${shortName}.updated\` — emitted after item update
- \`${shortName}.deleted\` — emitted after item deletion

${requiresAuth ? "## Requirements\n\n- `@stormstack/auth` (peer dependency)\n" : ""}
## License

MIT
`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel[0]!.toUpperCase() + camel.slice(1);
}
