import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  ProofBlockedError,
  REPOSITORY_ROOT,
  assertPathWithin,
  boundedOutput,
  nowIso,
  replaceOnce,
  sanitizeId,
  sha256File,
} from "./proof-two-client-update-helpers.mjs";

const LOGIN_PASSWORD = "Proof-password-2026!";
const AUTH_COOKIE_NAME = "storm_token";
const CSRF_COOKIE_NAME = "storm_csrf";
const SAVED_TEXT = "Vos préférences de cookies sont enregistrées.";
const WITHDRAWN_TEXT = "Votre consentement a été retiré.";

const PHASE_EXPECTATIONS = Object.freeze({
  baseline: { consentState: "saved", consentText: SAVED_TEXT, withdrawn: false },
  rollback: { consentState: "saved", consentText: SAVED_TEXT, withdrawn: false },
  target: { consentState: "withdrawn", consentText: WITHDRAWN_TEXT, withdrawn: true },
  "target-warm": { consentState: "withdrawn", consentText: WITHDRAWN_TEXT, withdrawn: true },
});

const THEME_COLORS = Object.freeze({
  alpha: "rgb(71, 85, 105)",
  beta: "rgb(21, 94, 117)",
});

function executable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveBrowseBinary(environment = process.env) {
  const explicit = environment.PROOF_BROWSE_BIN?.trim();
  if (explicit) {
    const absolute = path.resolve(explicit);
    if (!executable(absolute)) {
      throw new ProofBlockedError(
        `PROOF_BROWSE_BIN is not executable: ${absolute}`,
        "browser-preflight",
      );
    }
    return realpathSync(absolute);
  }

  const candidates = [
    path.join(REPOSITORY_ROOT, ".claude/skills/gstack/browse/dist/browse"),
    path.join(homedir(), ".claude/skills/gstack/browse/dist/browse"),
    path.join(homedir(), ".agents/skills/gstack/browse/dist/browse"),
    path.join(homedir(), ".codex/skills/gstack/browse/dist/browse"),
  ];
  const match = candidates.find(executable);
  if (!match) {
    throw new ProofBlockedError(
      "gstack /browse is required; install it or set PROOF_BROWSE_BIN",
      "browser-preflight",
    );
  }
  return realpathSync(match);
}

function processOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

export class BrowseCli {
  constructor({ binary, cwd = REPOSITORY_ROOT, runner = spawnSync } = {}) {
    this.binary = binary ?? resolveBrowseBinary();
    this.cwd = cwd;
    this.runner = runner;
  }

  run(args, options = {}) {
    const result = this.runner(this.binary, args, {
      cwd: this.cwd,
      env: process.env,
      encoding: "utf8",
      timeout: options.timeoutMs ?? 30_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      const reason = result.error?.message ?? boundedOutput(processOutput(result)).trim();
      throw new Error(`browse ${args[0]} failed: ${reason || `exit ${result.status}`}`);
    }
    return result.stdout ?? "";
  }

  open(url) {
    const output = this.run(["newtab", url, "--json"]);
    const parsed = parseBrowseJson(output, "newtab");
    if (!Number.isInteger(parsed.tabId) || parsed.tabId < 1) {
      throw new Error(`browse newtab returned an invalid tab id: ${output}`);
    }
    return parsed.tabId;
  }

  command(tabId, command, args = [], options = {}) {
    return this.run([command, ...args, "--tab-id", String(tabId)], options);
  }

  close(tabId) {
    return this.command(tabId, "closetab");
  }
}

export function parseBrowseJson(output, label = "browse") {
  const trimmed = output.trim();
  const lines = trimmed.split("\n");
  const candidates = [
    trimmed,
    ...lines.slice(1).map((_, index) => lines.slice(index + 1).join("\n").trim()),
    ...lines.map((line) => line.trim()).filter(Boolean).reverse(),
  ];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // gstack can print startup notices before a pretty-printed JSON result.
    }
  }
  throw new Error(`${label} did not return JSON: ${boundedOutput(output)}`);
}

export function networkFailures(output) {
  const failures = [];
  for (const line of output.split("\n")) {
    const status = line.match(/\u2192\s+(\d{3})\b/);
    if (!status || Number(status[1]) < 400) continue;
    const request = line.match(/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(https?:\/\/\S+)\s+\u2192/);
    let expectedAnonymousProbe = false;
    if (request && Number(status[1]) === 401) {
      try {
        expectedAnonymousProbe = new URL(request[1]).pathname === "/api/auth/me";
      } catch {
        expectedAnonymousProbe = false;
      }
    }
    if (!expectedAnonymousProbe) failures.push(line.trim());
  }
  return failures;
}

export function pageErrorInitScript() {
  return `(() => {
    window.__stormProofPageErrors = [];
    const record = (kind, value) => {
      if (window.__stormProofPageErrors.length >= 20) return;
      const message = value instanceof Error ? value.stack ?? value.message : String(value ?? "Unknown error");
      window.__stormProofPageErrors.push({ kind, message: message.slice(0, 2000) });
    };
    window.addEventListener("error", (event) => record("error", event.error ?? event.message));
    window.addEventListener("unhandledrejection", (event) => record("unhandledrejection", event.reason));
  })();`;
}

export function injectPageErrorInitScript(html) {
  const moduleScript = '    <script type="module" src="/src/main.tsx"></script>';
  const source = pageErrorInitScript()
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n");
  const instrumentation = [
    '    <script data-storm-proof-page-errors="true">',
    source,
    "    </script>",
    moduleScript,
  ].join("\n");
  return replaceOnce(html, moduleScript, instrumentation, "client module script");
}

function canonicalPathForComparison(filePath) {
  let ancestor = path.resolve(filePath);
  const missing = [];
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    missing.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const canonicalAncestor = existsSync(ancestor) ? realpathSync(ancestor) : ancestor;
  return path.join(canonicalAncestor, ...missing);
}

export function assertBrowseWritablePath(candidatePath, options = {}) {
  const candidate = path.resolve(candidatePath);
  const canonicalCandidate = canonicalPathForComparison(candidate);
  const runtimePlatform = options.platform ?? process.platform;
  const allowedRoots = [options.repositoryRoot ?? REPOSITORY_ROOT];
  if (runtimePlatform === "darwin") allowedRoots.push("/private/tmp");
  if (runtimePlatform === "linux") allowedRoots.push("/tmp");
  const normalizedRoots = allowedRoots.map((root) => (
    existsSync(root) ? realpathSync(root) : path.resolve(root)
  ));
  if (normalizedRoots.some((root) => canonicalCandidate.startsWith(`${root}${path.sep}`))) {
    return candidate;
  }
  const recommendation = runtimePlatform === "darwin"
    ? "use /private/tmp/storm-proof-XXXXXX or a dedicated ignored child of the repository"
    : "use /tmp/storm-proof-XXXXXX or a dedicated ignored child of the repository";
  throw new ProofBlockedError(
    `Screenshot path is outside gstack /browse writable roots: ${candidate}; ${recommendation}`,
    "browser-preflight",
  );
}

export function loginInspectionScript() {
  return `
await Promise.resolve();
return {
  pathname: window.location.pathname,
  loginReady: Boolean(document.querySelector("input[type=email]")),
  pageErrors: Array.isArray(window.__stormProofPageErrors) ? window.__stormProofPageErrors : [],
};`;
}

export function authenticationInspectionScript(definition) {
  return `
await Promise.resolve();
return {
  pathname: window.location.pathname,
  authenticatedEmail: ${JSON.stringify(`proof-${definition.name}@example.test`)},
  authenticatedEmailVisible: document.body.innerText.includes(${JSON.stringify(`proof-${definition.name}@example.test`)}),
  pageErrors: Array.isArray(window.__stormProofPageErrors) ? window.__stormProofPageErrors : [],
};`;
}

export function businessInspectionScript(definition) {
  return `
const business = document.querySelector(".proof-business-page");
const businessStyle = business ? getComputedStyle(business) : null;
const consentAside = [...document.querySelectorAll("aside")].find((element) => {
  const text = element.textContent ?? "";
  return text.includes(${JSON.stringify(SAVED_TEXT)}) || text.includes(${JSON.stringify(WITHDRAWN_TEXT)});
});
const consentResponse = await fetch("/api/consent/state", { credentials: "include" });
const consentBody = await consentResponse.json().catch(() => null);
return {
  pathname: window.location.pathname,
  expectedRoute: ${JSON.stringify(definition.route)},
  appNameVisible: document.body.innerText.includes(${JSON.stringify(definition.displayName)}),
  authenticatedUserVisible: document.body.innerText.includes(${JSON.stringify(`proof-${definition.name}@example.test`)}),
  heading: business?.querySelector("h1")?.textContent?.trim() ?? null,
  sentinelAttribute: business?.getAttribute("data-proof-sentinel") ?? null,
  sentinelVisible: business?.textContent?.includes(${JSON.stringify(definition.sentinelText)}) ?? false,
  borderLeftWidth: businessStyle?.borderLeftWidth ?? null,
  borderLeftStyle: businessStyle?.borderLeftStyle ?? null,
  borderLeftColor: businessStyle?.borderLeftColor ?? null,
  consentText: consentAside?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
  consentStateAttribute: consentAside?.getAttribute("data-proof-consent-state") ?? null,
  consentHttpStatus: consentResponse.status,
  consentPolicyVersion: consentBody?.consent?.policyVersion ?? null,
  consentWithdrawnAt: consentBody?.consent?.withdrawnAt ?? null,
  pageErrors: Array.isArray(window.__stormProofPageErrors) ? window.__stormProofPageErrors : [],
  pageNotFound: document.body.innerText.includes("Page introuvable."),
};`;
}

export function crmInspectionScript() {
  return `
await Promise.resolve();
return {
  pathname: window.location.pathname,
  heading: document.querySelector("h1")?.textContent?.trim() ?? null,
  appNameVisible: document.body.innerText.includes("Beta Portal"),
  pageNotFound: document.body.innerText.includes("Page introuvable."),
  pluginError: document.body.innerText.includes("Erreur de chargement du plugin"),
  pageErrors: Array.isArray(window.__stormProofPageErrors) ? window.__stormProofPageErrors : [],
};`;
}

function assertEqual(actual, expected, label) {
  const equal = typeof actual === "object" && actual !== null
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : actual === expected;
  if (!equal) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function validateBusinessEvidence(evidence, definition, phase) {
  const expected = PHASE_EXPECTATIONS[phase];
  if (!expected) throw new Error(`Unsupported UI proof phase: ${phase}`);
  assertEqual(evidence.pathname, definition.route, "business pathname");
  assertEqual(evidence.expectedRoute, definition.route, "business expected route");
  assertEqual(evidence.appNameVisible, true, "custom app name visibility");
  assertEqual(evidence.authenticatedUserVisible, true, "authenticated user visibility");
  assertEqual(
    evidence.heading,
    definition.hasCrm ? "Documents clients" : "Projets actifs",
    "business heading",
  );
  assertEqual(evidence.sentinelAttribute, definition.sentinelText, "business sentinel attribute");
  assertEqual(evidence.sentinelVisible, true, "business sentinel text");
  assertEqual(evidence.borderLeftWidth, "4px", "theme border width");
  assertEqual(evidence.borderLeftStyle, "solid", "theme border style");
  assertEqual(evidence.borderLeftColor, THEME_COLORS[definition.name], "theme border color");
  assertEqual(evidence.consentHttpStatus, 200, "consent browser HTTP status");
  assertEqual(evidence.consentPolicyVersion, definition.policyVersion, "consent policy version");
  assertEqual(evidence.consentStateAttribute, expected.consentState, "consent DOM state");
  if (!evidence.consentText?.includes(expected.consentText)) {
    throw new Error(`consent DOM text does not include ${JSON.stringify(expected.consentText)}`);
  }
  assertEqual(Boolean(evidence.consentWithdrawnAt), expected.withdrawn, "consent withdrawnAt state");
  assertEqual(evidence.pageErrors, [], "business page errors");
  assertEqual(evidence.pageNotFound, false, "business 404 state");
  return true;
}

export function validateCrmEvidence(evidence) {
  assertEqual(evidence.pathname, "/crm", "CRM pathname");
  assertEqual(evidence.heading, "Contacts", "CRM heading");
  assertEqual(evidence.appNameVisible, true, "CRM app name visibility");
  assertEqual(evidence.pageNotFound, false, "CRM 404 state");
  assertEqual(evidence.pluginError, false, "CRM plugin error state");
  assertEqual(evidence.pageErrors, [], "CRM page errors");
  return true;
}

function inspectJson(browser, tabId, script, label) {
  return parseBrowseJson(browser.command(tabId, "js", [script]), label);
}

export async function verifyFixtureUi(
  harness,
  definition,
  phase,
  commandId,
  dependencies = {},
) {
  const expectation = PHASE_EXPECTATIONS[phase];
  if (!expectation) throw new Error(`Unsupported UI proof phase: ${phase}`);
  const browser = dependencies.browser ?? new BrowseCli({ cwd: REPOSITORY_ROOT });
  const startedAt = nowIso();
  const startedMs = Date.now();
  const origin = `http://127.0.0.1:${definition.clientPort}`;
  const screenshotPath = assertBrowseWritablePath(
    assertPathWithin(
      harness.options.workDir,
      path.join(harness.paths.logs, `${sanitizeId(commandId)}.png`),
    ),
  );
  let tabId;
  let evidence;
  let failure;

  try {
    tabId = browser.open(`${origin}/login`);
    // Cookies are scoped by hostname, not port. Start each generated app with
    // an empty session so Alpha and Beta cannot reuse each other's JWT/CSRF.
    browser.command(tabId, "cookie", [`${AUTH_COOKIE_NAME}=`]);
    browser.command(tabId, "cookie", [`${CSRF_COOKIE_NAME}=`]);
    browser.command(tabId, "console", ["--clear"]);
    browser.command(tabId, "network", ["--clear"]);
    browser.command(tabId, "wait", ["input[type=email]"]);
    const login = inspectJson(
      browser,
      tabId,
      loginInspectionScript(),
      `${definition.name}/${phase} login UI`,
    );
    assertEqual(login.pathname, "/login", "login pathname");
    assertEqual(login.loginReady, true, "login form readiness");
    assertEqual(login.pageErrors, [], "login initial page errors");
    browser.command(tabId, "fill", ["input[type=email]", `proof-${definition.name}@example.test`]);
    browser.command(tabId, "fill", ["input[type=password]", LOGIN_PASSWORD]);
    browser.command(tabId, "click", ["button[type=submit]"]);
    browser.command(tabId, "wait", ["main h1.text-xl"]);
    const authentication = inspectJson(
      browser,
      tabId,
      authenticationInspectionScript(definition),
      `${definition.name}/${phase} authenticated UI`,
    );
    assertEqual(authentication.pathname, "/", "post-login pathname");
    assertEqual(authentication.authenticatedEmailVisible, true, "post-login authenticated email");
    assertEqual(authentication.pageErrors, [], "authenticated initial page errors");
    browser.command(tabId, "goto", [`${origin}${definition.route}`]);
    browser.command(tabId, "wait", [".proof-business-page"]);
    browser.command(tabId, "wait", ["--networkidle"]);

    const business = inspectJson(
      browser,
      tabId,
      businessInspectionScript(definition),
      `${definition.name}/${phase} business UI`,
    );
    validateBusinessEvidence(business, definition, phase);
    browser.command(tabId, "screenshot", [screenshotPath, "--viewport"]);

    let crm = null;
    if (definition.hasCrm) {
      browser.command(tabId, "goto", [`${origin}/crm`]);
      browser.command(tabId, "wait", ["h1"]);
      browser.command(tabId, "wait", ["--networkidle"]);
      crm = inspectJson(browser, tabId, crmInspectionScript(), `${definition.name}/${phase} CRM UI`);
      validateCrmEvidence(crm);
    }

    const consoleErrors = browser.command(tabId, "console", ["--errors"]);
    const network = browser.command(tabId, "network");
    const failedRequests = networkFailures(network);
    if (!consoleErrors.includes("(no console errors)")) {
      throw new Error(`Browser console contains errors or warnings:\n${boundedOutput(consoleErrors)}`);
    }
    if (failedRequests.length > 0) {
      throw new Error(`Browser network contains failed requests:\n${failedRequests.join("\n")}`);
    }

    if (!existsSync(screenshotPath)) throw new Error(`UI screenshot is missing: ${screenshotPath}`);
    evidence = {
      driver: "gstack/browse",
      phase,
      login,
      authentication,
      business,
      ...(crm ? { crm } : {}),
      consoleSummary: boundedOutput(consoleErrors).trim(),
      networkSummary: boundedOutput(network).trim(),
      allowedNetworkFailure: "401 GET /api/auth/me before authenticated UI is visible",
      failedRequests,
      screenshot: { path: screenshotPath, sha256: sha256File(screenshotPath) },
    };
  } catch (error) {
    failure = error;
  } finally {
    if (tabId !== undefined) {
      try {
        browser.close(tabId);
      } catch (closeError) {
        failure ??= closeError;
      }
    }
  }

  const detail = failure
    ? `${failure instanceof Error ? failure.stack ?? failure.message : String(failure)}\n`
    : `${JSON.stringify(evidence, null, 2)}\n`;
  harness.recordSyntheticCommand({
    id: commandId,
    fixture: definition.name,
    command: `gstack /browse authenticated DOM proof (${phase})`,
    startedAt,
    startedMs,
    exitCode: failure ? 1 : 0,
    required: true,
    detail,
  });
  if (failure) throw failure;
  return evidence;
}
