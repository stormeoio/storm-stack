import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { requiredFixtureCommandIds } from "./proof-model.mjs";
import { REPOSITORY_ROOT, fixtureDefinitions } from "./proof-two-client-update-helpers.mjs";
import {
  BrowseCli,
  assertBrowseWritablePath,
  authenticationInspectionScript,
  businessInspectionScript,
  injectPageErrorInitScript,
  loginInspectionScript,
  networkFailures,
  pageErrorInitScript,
  parseBrowseJson,
  validateBusinessEvidence,
  validateCrmEvidence,
  verifyFixtureUi,
} from "./proof-two-client-update-browser.mjs";

const temporaryDirectories = [];

function temporaryDirectory() {
  const base = process.platform === "darwin" ? "/private/tmp" : os.tmpdir();
  const directory = mkdtempSync(path.join(base, "storm-proof-browser-unit-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function businessEvidence(definition, phase) {
  const withdrawn = phase === "target" || phase === "target-warm";
  return {
    pathname: definition.route,
    expectedRoute: definition.route,
    appNameVisible: true,
    authenticatedUserVisible: true,
    heading: definition.hasCrm ? "Documents clients" : "Projets actifs",
    sentinelAttribute: definition.sentinelText,
    sentinelVisible: true,
    borderLeftWidth: "4px",
    borderLeftStyle: "solid",
    borderLeftColor: definition.hasCrm ? "rgb(21, 94, 117)" : "rgb(71, 85, 105)",
    consentText: withdrawn
      ? "Votre consentement a été retiré."
      : "Vos préférences de cookies sont enregistrées.",
    consentStateAttribute: withdrawn ? "withdrawn" : "saved",
    consentHttpStatus: 200,
    consentPolicyVersion: definition.policyVersion,
    consentWithdrawnAt: withdrawn ? "2026-08-09T00:00:00.000Z" : null,
    pageErrors: [],
    pageNotFound: false,
  };
}

function crmEvidence() {
  return {
    pathname: "/crm",
    heading: "Contacts",
    appNameVisible: true,
    pageNotFound: false,
    pluginError: false,
    pageErrors: [],
  };
}

class FakeBrowser {
  constructor(definition, phase, overrides = {}) {
    this.definition = definition;
    this.phase = phase;
    this.overrides = overrides;
    this.commands = [];
    this.closed = false;
  }

  open(url) {
    this.commands.push(["open", url]);
    return 7;
  }

  command(tabId, command, args = []) {
    this.commands.push([command, tabId, ...args]);
    if (command === "js") {
      const value = args[0].includes("loginReady")
        ? { pathname: "/login", loginReady: true, pageErrors: [], ...this.overrides.login }
        : args[0].includes("authenticatedEmailVisible")
        ? {
            pathname: "/",
            authenticatedEmail: `proof-${this.definition.name}@example.test`,
            authenticatedEmailVisible: true,
            pageErrors: [],
            ...this.overrides.authentication,
          }
        : args[0].includes("consentResponse")
          ? { ...businessEvidence(this.definition, this.phase), ...this.overrides.business }
          : { ...crmEvidence(), ...this.overrides.crm };
      return JSON.stringify(value);
    }
    if (command === "console" && args[0] === "--errors") return "(no console errors)";
    if (command === "network" && args.length === 0) {
      return this.overrides.network ?? [
        `GET http://127.0.0.1:${this.definition.clientPort}/api/auth/me \u2192 401 (3ms, 50B)`,
        `GET http://127.0.0.1:${this.definition.clientPort}/api/consent/state \u2192 200 (2ms, 120B)`,
      ].join("\n");
    }
    if (command === "screenshot") {
      writeFileSync(args[0], "proof screenshot", "utf8");
    }
    return "ok";
  }

  close(tabId) {
    this.commands.push(["close", tabId]);
    this.closed = true;
  }
}

function fakeHarness() {
  const root = temporaryDirectory();
  const logs = path.join(root, "logs");
  mkdirSync(logs, { recursive: true });
  return {
    options: { workDir: root },
    paths: { logs },
    commands: [],
    recordSyntheticCommand(command) {
      this.commands.push(command);
    },
  };
}

describe("proof browser evidence", () => {
  it("requires and wires UI evidence for every Phase C lifecycle", () => {
    expect(requiredFixtureCommandIds("alpha").filter((id) => id.includes(":verify-ui-")))
      .toEqual([
        "alpha:verify-ui-baseline",
        "alpha:verify-ui-target",
        "alpha:verify-ui-rollback",
        "alpha:verify-ui-rollback-before-warm",
        "alpha:verify-ui-target-warm",
      ]);
    const fixtureSource = readFileSync(
      path.join(REPOSITORY_ROOT, "scripts/proof-two-client-update-fixtures.mjs"),
      "utf8",
    );
    const orchestratorSource = readFileSync(
      path.join(REPOSITORY_ROOT, "scripts/proof-two-client-update.mjs"),
      "utf8",
    );
    expect(fixtureSource).toContain("await verifyFixtureUi(harness, definition, \"rollback\", uiCommandId);");
    expect(fixtureSource).toContain("`${definition.name}:verify-ui-rollback-before-warm`");
    expect(fixtureSource).toContain("`${definition.name}:verify-ui-${phase}`");
    for (const phase of ["baseline", "target", "target-warm"]) {
      expect(orchestratorSource).toMatch(
        new RegExp(`journalVerification\\([\\s\\S]{0,160}?definition,\\s*\"${phase}\"`),
      );
    }
  });

  it("pins every browse command to its tab without global active-tab state", () => {
    const calls = [];
    const runner = (binary, args) => {
      calls.push([binary, ...args]);
      if (args[0] === "newtab") {
        return { status: 0, stdout: '{"tabId":9,"url":"http://127.0.0.1/login"}\n', stderr: "" };
      }
      return { status: 0, stdout: "ok\n", stderr: "" };
    };
    const browser = new BrowseCli({ binary: "/proof/browse", runner });
    const tabId = browser.open("http://127.0.0.1/login");
    browser.command(tabId, "goto", ["http://127.0.0.1/projects"]);
    browser.close(tabId);
    expect(calls).toEqual([
      ["/proof/browse", "newtab", "http://127.0.0.1/login", "--json"],
      ["/proof/browse", "goto", "http://127.0.0.1/projects", "--tab-id", "9"],
      ["/proof/browse", "closetab", "--tab-id", "9"],
    ]);
  });

  it("parses JSON after a bounded browse startup notice", () => {
    expect(parseBrowseJson("[browse] Starting server...\n{\"tabId\":4,\"url\":null}\n"))
      .toEqual({ tabId: 4, url: null });
  });

  it("parses pretty-printed JSON after a bounded browse startup notice", () => {
    const evidence = {
      pathname: "/login",
      loginReady: true,
      pageErrors: [],
    };
    expect(parseBrowseJson(
      `[browse] Starting server...\n${JSON.stringify(evidence, null, 2)}\n`,
    )).toEqual(evidence);
  });

  it("installs page-error capture before the generated React module", () => {
    const html = [
      "<body>",
      '    <div id="root"></div>',
      '    <script type="module" src="/src/main.tsx"></script>',
      "</body>",
    ].join("\n");
    const instrumented = injectPageErrorInitScript(html);
    expect(instrumented).toContain("data-storm-proof-page-errors");
    expect(instrumented.indexOf("data-storm-proof-page-errors"))
      .toBeLessThan(instrumented.indexOf('type="module"'));
    expect(instrumented).toContain("unhandledrejection");
  });

  it("rejects macOS mktemp paths outside /private/tmp before screenshot", () => {
    expect(assertBrowseWritablePath("/private/tmp/storm-proof/log.png", {
      platform: "darwin",
      repositoryRoot: "/proof/repository",
    })).toBe("/private/tmp/storm-proof/log.png");
    expect(() => assertBrowseWritablePath("/var/folders/random/storm-proof/log.png", {
      platform: "darwin",
      repositoryRoot: "/proof/repository",
    })).toThrow("use /private/tmp/storm-proof-XXXXXX");
    expect(assertBrowseWritablePath("/tmp/storm-proof/log.png", {
      platform: "linux",
      repositoryRoot: "/proof/repository",
    })).toBe("/tmp/storm-proof/log.png");
  });

  it("keeps CI and local proof artifacts in browse-writable temporary roots", () => {
    const workflow = readFileSync(
      path.join(REPOSITORY_ROOT, ".github/workflows/proof-two-client-update.yml"),
      "utf8",
    );
    const documentation = readFileSync(
      path.join(REPOSITORY_ROOT, "docs/PHASE_C_PROOF.md"),
      "utf8",
    );
    expect(workflow).not.toContain("${{ runner.temp }}/storm-proof");
    expect(workflow).toContain("/tmp/storm-stack-phase-c-${{ github.run_id }}-${{ github.run_attempt }}/work");
    expect(workflow).toContain("/tmp/storm-stack-phase-c-${{ github.run_id }}-${{ github.run_attempt }}/output");
    expect(documentation).toContain("mktemp -d /private/tmp/storm-stack-phase-c.XXXXXX");
    expect(documentation).toContain("mktemp -d /tmp/storm-stack-phase-c.XXXXXX");
  });

  it("allows only the anonymous auth probe among HTTP failures", () => {
    const output = [
      "GET http://127.0.0.1:46003/api/auth/me \u2192 401 (2ms, 20B)",
      "GET http://127.0.0.1:46003/api/consent/state \u2192 500 (2ms, 20B)",
      "GET http://127.0.0.1:46003/missing.js \u2192 404 (2ms, 20B)",
    ].join("\n");
    expect(networkFailures(output)).toEqual([
      "GET http://127.0.0.1:46003/api/consent/state \u2192 500 (2ms, 20B)",
      "GET http://127.0.0.1:46003/missing.js \u2192 404 (2ms, 20B)",
    ]);
  });

  it("locks the saved and withdrawn DOM contracts", () => {
    const [alpha, beta] = fixtureDefinitions("browser-contract", 47_000);
    expect(validateBusinessEvidence(businessEvidence(alpha, "baseline"), alpha, "baseline"))
      .toBe(true);
    expect(validateBusinessEvidence(businessEvidence(alpha, "rollback"), alpha, "rollback"))
      .toBe(true);
    expect(validateBusinessEvidence(businessEvidence(beta, "target"), beta, "target"))
      .toBe(true);
    expect(validateBusinessEvidence(businessEvidence(beta, "target-warm"), beta, "target-warm"))
      .toBe(true);
    expect(validateCrmEvidence(crmEvidence())).toBe(true);
  });

  it("rejects a React page that lies about the target consent state", () => {
    const [, beta] = fixtureDefinitions("browser-contract", 47_000);
    const evidence = { ...businessEvidence(beta, "target"), consentStateAttribute: "saved" };
    expect(() => validateBusinessEvidence(evidence, beta, "target"))
      .toThrow("consent DOM state");
  });

  it("builds scripts with a DOM sentinel, computed theme and page-error capture", () => {
    const [alpha] = fixtureDefinitions("browser-contract", 47_000);
    expect(businessInspectionScript(alpha)).toContain("getComputedStyle(business)");
    expect(businessInspectionScript(alpha)).toContain("data-proof-consent-state");
    expect(loginInspectionScript()).toContain("loginReady");
    expect(authenticationInspectionScript(alpha)).toContain("proof-alpha@example.test");
    expect(pageErrorInitScript()).toContain("unhandledrejection");
  });

  it("drives login, business, CRM and journals hashed screenshot evidence", async () => {
    const [, beta] = fixtureDefinitions("browser-contract", 47_000);
    const browser = new FakeBrowser(beta, "target");
    const harness = fakeHarness();
    const evidence = await verifyFixtureUi(
      harness,
      beta,
      "target",
      "beta:verify-ui-target",
      { browser },
    );

    expect(browser.closed).toBe(true);
    expect(browser.commands.slice(0, 5)).toEqual([
      ["open", "http://127.0.0.1:47013/login"],
      ["cookie", 7, "storm_token="],
      ["cookie", 7, "storm_csrf="],
      ["console", 7, "--clear"],
      ["network", 7, "--clear"],
    ]);
    expect(browser.commands).toContainEqual(["fill", 7, "input[type=email]", "proof-beta@example.test"]);
    const loginClick = browser.commands.findIndex(([command]) => command === "click");
    expect(browser.commands[loginClick + 1]).toEqual(["wait", 7, "main h1.text-xl"]);
    expect(browser.commands).toContainEqual(["goto", 7, "http://127.0.0.1:47013/documents"]);
    expect(browser.commands).toContainEqual(["goto", 7, "http://127.0.0.1:47013/crm"]);
    expect(browser.commands.some(([command, , script]) => (
      command === "js" && script.includes("unhandledrejection")
    ))).toBe(false);
    expect(evidence.login).toEqual({ pathname: "/login", loginReady: true, pageErrors: [] });
    expect(evidence.business.consentStateAttribute).toBe("withdrawn");
    expect(evidence.crm.heading).toBe("Contacts");
    expect(evidence.consoleSummary).toBe("(no console errors)");
    expect(evidence.networkSummary).toContain("/api/consent/state");
    expect(evidence.screenshot.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(harness.commands).toHaveLength(1);
    expect(harness.commands[0]).toMatchObject({
      id: "beta:verify-ui-target",
      fixture: "beta",
      exitCode: 0,
      required: true,
    });
  });

  it("fails closed and still closes the tab on an unexpected HTTP error", async () => {
    const [alpha] = fixtureDefinitions("browser-contract", 47_000);
    const browser = new FakeBrowser(alpha, "baseline", {
      network: "GET http://127.0.0.1:47003/api/consent/state \u2192 503 (2ms, 20B)",
    });
    const harness = fakeHarness();
    await expect(verifyFixtureUi(
      harness,
      alpha,
      "baseline",
      "alpha:verify-ui-baseline",
      { browser },
    )).rejects.toThrow("network contains failed requests");
    expect(browser.closed).toBe(true);
    expect(harness.commands[0].exitCode).toBe(1);
  });

  it("fails before login when the initial application load raised a page error", async () => {
    const [alpha] = fixtureDefinitions("browser-contract", 47_000);
    const browser = new FakeBrowser(alpha, "baseline", {
      login: { pageErrors: [{ kind: "error", message: "initial render failed" }] },
    });
    const harness = fakeHarness();
    await expect(verifyFixtureUi(
      harness,
      alpha,
      "baseline",
      "alpha:verify-ui-baseline",
      { browser },
    )).rejects.toThrow("login initial page errors");
    expect(browser.closed).toBe(true);
    expect(harness.commands[0].exitCode).toBe(1);
  });
});
