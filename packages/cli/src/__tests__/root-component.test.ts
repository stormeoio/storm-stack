import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { injectClientComponents, injectRootComponent, removeRootComponent } from "../injector";
import { resolvePlugin } from "../registry";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(): { root: string; appPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "storm-root-component-"));
  temporaryDirectories.push(root);
  const appPath = path.join(root, "client/src/App.tsx");
  fs.mkdirSync(path.dirname(appPath), { recursive: true });
  fs.writeFileSync(appPath, `import { StormLayout } from "@stormeoio/react";

export default function App() {
  return (
    <>
      <StormLayout appName="Test" />
      {/* storm:root-components */}
    </>
  );
}
`);
  return { root, appPath };
}

function runtimeNamedImportBindings(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "fixture.tsx",
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  const bindings: string[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const importClause = statement.importClause;
    if (!importClause || importClause.isTypeOnly) continue;
    const namedBindings = importClause.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    for (const element of namedBindings.elements) {
      if (!element.isTypeOnly) bindings.push(element.name.text);
    }
  }

  return bindings;
}

function expectNoDuplicateRuntimeNamedImports(source: string): void {
  const bindings = runtimeNamedImportBindings(source);
  const duplicates = [...new Set(bindings.filter((binding, index) => (
    bindings.indexOf(binding) !== index
  )))];
  expect(duplicates).toEqual([]);
}

describe("root component injection", () => {
  it("skips optional client wiring in a server-only project", () => {
    const auth = resolvePlugin("auth");
    const consent = resolvePlugin("consent");
    if (!auth || !consent) throw new Error("Plugin metadata missing");
    const { root } = fixture();
    fs.rmSync(path.join(root, "client"), { recursive: true, force: true });

    expect(injectClientComponents(root, auth, "npm", "plugins")).toMatchObject({
      modified: false,
      configured: true,
      reason: expect.stringContaining("sans client"),
    });
    expect(injectRootComponent(root, consent, "npm", "plugins")).toMatchObject({
      modified: false,
      configured: true,
      reason: expect.stringContaining("sans client"),
    });
  });

  it("adds and removes authenticated ConsentBanner idempotently", () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const { root, appPath } = fixture();

    expect(injectRootComponent(root, consent, "npm", "plugins"))
      .toMatchObject({ modified: true, configured: true });
    expect(injectRootComponent(root, consent, "npm", "plugins"))
      .toMatchObject({ modified: false, configured: true });
    let source = fs.readFileSync(appPath, "utf8");
    expect(source).toContain('import { ConsentBanner } from "@stormeoio/consent/client"');
    expect(source).toContain('import { useStorm } from "@stormeoio/react"');
    expect(source).toContain("const { user } = useStorm()");
    expect(source).toContain("return user ? <ConsentBanner /> : null");
    expect(source).toContain("<StormRootConsentBanner />");
    expect(source).toContain("storm:root-component @stormeoio/consent:start");

    expect(removeRootComponent(root, consent).modified).toBe(true);
    expect(removeRootComponent(root, consent).modified).toBe(false);
    source = fs.readFileSync(appPath, "utf8");
    expect(source).not.toContain("ConsentBanner");
    expect(source).not.toContain("useStorm");
    expect(source).toContain("storm:root-components");
  });

  it("reuses active bindings in commented multiline imports without creating semantic duplicates", () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const { root, appPath } = fixture();
    fs.writeFileSync(appPath, `import {
  StormLayout,
  // The auth hook remains an active binding after this comment.
  useStorm,
  StormRouter,
} from "@stormeoio/react";
import {
  /* The banner is already imported and must not be duplicated. */
  ConsentBanner,
} from "@stormeoio/consent/client";

export default function App() {
  return <StormLayout appName="Test">
      <StormRouter />
      {/* storm:root-components */}
  </StormLayout>;
}
`);

    expect(injectRootComponent(root, consent, "npm", "plugins")).toMatchObject({
      modified: true,
      configured: true,
    });

    const source = fs.readFileSync(appPath, "utf8");
    expect(runtimeNamedImportBindings(source).filter((binding) => binding === "useStorm"))
      .toHaveLength(1);
    expect(runtimeNamedImportBindings(source).filter((binding) => binding === "ConsentBanner"))
      .toHaveLength(1);
    expectNoDuplicateRuntimeNamedImports(source);
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: "App.tsx",
      reportDiagnostics: true,
    });
    expect(
      transpiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error),
    ).toEqual([]);
  });

  it("uses the same comment-aware binding analysis for the client component map", () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const { root } = fixture();
    const componentsPath = path.join(root, "client/src/storm-components.ts");
    const before = `import {
  /* Keep the existing client binding. */
  ConsentBanner,
} from "@stormeoio/consent/client";

export const STORM_COMPONENTS = {
  ConsentBanner: ConsentBanner,
};
`;
    fs.writeFileSync(componentsPath, before, "utf8");

    expect(injectClientComponents(root, consent, "npm", "plugins")).toMatchObject({
      modified: false,
      configured: true,
    });
    expect(fs.readFileSync(componentsPath, "utf8")).toBe(before);
  });

  it("detects a client binding from another source even when a line comment precedes it", () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const { root } = fixture();
    const componentsPath = path.join(root, "client/src/storm-components.ts");
    const before = `import {
  // This active binding belongs to a user module.
  ConsentBanner,
} from "custom-client";

export const STORM_COMPONENTS = {
};
`;
    fs.writeFileSync(componentsPath, before, "utf8");

    expect(injectClientComponents(root, consent, "npm", "plugins")).toMatchObject({
      modified: false,
      configured: false,
      reason: expect.stringContaining("custom-client"),
    });
    expect(fs.readFileSync(componentsPath, "utf8")).toBe(before);
  });

  it("leaves App.tsx byte-for-byte unchanged when wiring fails after import preparation", () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const { root, appPath } = fixture();
    const before = `import {
  StormLayout,
  StormRouter,
} from "@stormeoio/react";

export default function Shell() {
  return <StormLayout appName="Test">
      <StormRouter />
      {/* storm:root-components */}
  </StormLayout>;
}
`;
    fs.writeFileSync(appPath, before);

    expect(injectRootComponent(root, consent, "npm", "plugins")).toMatchObject({
      modified: false,
      configured: false,
      reason: expect.stringContaining("App introuvable"),
    });
    expect(fs.readFileSync(appPath, "utf8")).toBe(before);
  });

  it("fails safely when the generated marker is absent", () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const { root, appPath } = fixture();
    fs.writeFileSync(appPath, "export default function App() { return null; }\n");

    expect(injectRootComponent(root, consent, "npm", "plugins")).toMatchObject({
      modified: false,
      reason: expect.stringContaining("manuellement"),
    });
  });

  it("removes a customized Consent block generated by create-storm-app", () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const { root, appPath } = fixture();
    fs.writeFileSync(appPath, `import { StormLayout, StormRouter } from "@stormeoio/react";
import { useStorm } from "@stormeoio/react"; // storm:root-auth-import @stormeoio/consent
import { ConsentBanner } from "@stormeoio/consent/client"; // storm:root-component-import @stormeoio/consent

/* storm:root-auth @stormeoio/consent:start */
function StormRootConsentBanner() {
  const { user } = useStorm();
  return user ? <ConsentBanner policyVersion="2026-08" /> : null;
}
/* storm:root-auth @stormeoio/consent:end */

export default function App() {
  return (
    <>
      <StormLayout appName="Test"><StormRouter /></StormLayout>
      {/* storm:root-components */}
      {/* storm:root-component @stormeoio/consent:start */}
      <StormRootConsentBanner />
      {/* storm:root-component @stormeoio/consent:end */}
    </>
  );
}
`);

    expect(removeRootComponent(root, consent).modified).toBe(true);
    const source = fs.readFileSync(appPath, "utf8");
    expect(source).not.toContain("ConsentBanner");
    expect(source).not.toContain("useStorm");
    expect(source).toContain("StormLayout, StormRouter");
  });

  it("preserves a pre-existing useStorm binding and unrelated user logic", () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const { root, appPath } = fixture();
    fs.writeFileSync(appPath, `import { useStorm } from "@stormeoio/react";

export default function App(): JSX.Element {
  const { user } = useStorm();
  console.log(user);
  return <>
      {/* storm:root-components */}
  </>;
}
`);

    expect(injectRootComponent(root, consent, "npm", "plugins").modified).toBe(true);
    expect(removeRootComponent(root, consent).modified).toBe(true);
    const source = fs.readFileSync(appPath, "utf8");
    expect(source).toContain('import { useStorm } from "@stormeoio/react"');
    expect(source).toContain("const { user } = useStorm()");
    expect(source).toContain("console.log(user)");
    expect(source).not.toContain("ConsentBanner");
  });

  it("does not confuse aliased imports with the exact bindings used by the wrapper", () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const { root, appPath } = fixture();
    fs.writeFileSync(appPath, `import { StormLayout, useStorm as existingStormHook } from "@stormeoio/react";
import { ConsentBanner as ExistingConsentBanner } from "@stormeoio/consent/client";

void existingStormHook;
void ExistingConsentBanner;

export default function App() {
  return <>
      <StormLayout appName="Test" />
      {/* storm:root-components */}
  </>;
}
`);

    expect(injectRootComponent(root, consent, "npm", "plugins").modified).toBe(true);
    const source = fs.readFileSync(appPath, "utf8");
    expect(source).toContain('import { useStorm } from "@stormeoio/react";');
    expect(source).toContain('import { ConsentBanner } from "@stormeoio/consent/client";');
    expect(source).toContain("const { user } = useStorm()");
    expect(source).toContain("return user ? <ConsentBanner /> : null");
  });

  it("fails closed when a type-only import already owns the runtime binding name", () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const { root, appPath } = fixture();
    const before = `import type { useStorm } from "@stormeoio/react";

export default function App() {
  return <>
      {/* storm:root-components */}
  </>;
}
`;
    fs.writeFileSync(appPath, before, "utf8");

    expect(injectRootComponent(root, consent, "npm", "plugins")).toMatchObject({
      modified: false,
      configured: false,
      reason: expect.stringContaining("useStorm"),
    });
    expect(fs.readFileSync(appPath, "utf8")).toBe(before);
  });

  it("refuses injection without writing when useStorm is bound to another module", () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const { root, appPath } = fixture();
    const before = fs.readFileSync(appPath, "utf8").replace(
      'import { StormLayout } from "@stormeoio/react";',
      'import { StormLayout } from "@stormeoio/react";\nimport { useStorm } from "custom-hooks";',
    );
    fs.writeFileSync(appPath, before);

    expect(injectRootComponent(root, consent, "npm", "plugins")).toMatchObject({
      modified: false,
      reason: expect.stringContaining("useStorm"),
    });
    expect(fs.readFileSync(appPath, "utf8")).toBe(before);
  });

  it("refuses a partial removal when an owned end marker is missing", () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const { root, appPath } = fixture();
    expect(injectRootComponent(root, consent, "npm", "plugins").modified).toBe(true);
    const before = fs.readFileSync(appPath, "utf8").replace(
      "      {/* storm:root-component @stormeoio/consent:end */}\n",
      "",
    );
    fs.writeFileSync(appPath, before);

    expect(removeRootComponent(root, consent)).toMatchObject({
      modified: false,
      blocked: true,
      reason: expect.stringContaining("incomplet"),
    });
    expect(fs.readFileSync(appPath, "utf8")).toBe(before);
  });

  it("blocks removal when only owned imports remain", () => {
    const consent = resolvePlugin("consent");
    if (!consent) throw new Error("Consent plugin metadata missing");
    const { root, appPath } = fixture();
    const before = fs.readFileSync(appPath, "utf8").replace(
      'import { StormLayout } from "@stormeoio/react";',
      'import { StormLayout } from "@stormeoio/react";\nimport { ConsentBanner } from "@stormeoio/consent/client"; // storm:root-component-import @stormeoio/consent',
    );
    fs.writeFileSync(appPath, before);

    expect(removeRootComponent(root, consent)).toMatchObject({
      modified: false,
      blocked: true,
      reason: expect.stringContaining("incomplet"),
    });
    expect(fs.readFileSync(appPath, "utf8")).toBe(before);
  });
});
