// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StormAdmin } from "../StormAdmin";
import { StormContext } from "../context";
import type { StormManifest } from "../types";

const pluginId = "@stormeoio/demo";
const manifest: StormManifest = {
  navItems: [],
  dockItems: [],
  routes: [],
  settingsPanels: [],
  configSchemas: {
    [pluginId]: {
      enabled: {
        key: "enabled",
        type: "boolean",
        label: "Activé",
        required: true,
        default: false,
      },
    },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function renderAdmin(apiBase?: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <StormContext.Provider value={{
        manifest,
        isLoading: false,
        components: {},
        user: { id: "admin-1", email: "admin@example.test", role: "admin" },
      }}>
        <StormAdmin apiBase={apiBase} />
      </StormContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  document.cookie = "storm_csrf=; Max-Age=0; path=/";
  vi.unstubAllGlobals();
});

describe("StormAdmin", () => {
  it.each([
    ["le serveur généré", undefined, "/api"],
    ["une API distante", "https://api.example.test/api/", "https://api.example.test/api"],
  ])(
    "bootstrappe et renouvelle le jeton CSRF avec %s",
    async (_label, apiBase, expectedApiBase) => {
      const csrfEndpoint = `${expectedApiBase}/storm/csrf`;
      const configEndpoint = `${expectedApiBase}/storm/config/${encodeURIComponent(pluginId)}`;
      const csrfTokens = ["bootstrap-token", "refreshed-token"];
      const bootstrapCalls: string[] = [];
      const patchCalls: Array<{ token: string | null; credentials?: RequestCredentials }> = [];

      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url === `${expectedApiBase}/storm/plugins` && method === "GET") {
          return jsonResponse({ plugins: [] });
        }
        if (url === `${expectedApiBase}/storm/config` && method === "GET") {
          return jsonResponse({ configs: { [pluginId]: { enabled: false } } });
        }
        if (url === csrfEndpoint && method === "GET") {
          const token = csrfTokens[bootstrapCalls.length];
          bootstrapCalls.push(url);
          return jsonResponse({ csrfToken: token });
        }
        if (url === configEndpoint && method === "PATCH") {
          patchCalls.push({
            token: new Headers(init?.headers).get("X-Storm-CSRF"),
            credentials: init?.credentials,
          });
          return patchCalls.length === 1
            ? jsonResponse({ error: "CSRF validation failed" }, 403)
            : jsonResponse({ ok: true });
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      renderAdmin(apiBase);
      fireEvent.click(screen.getByRole("button", { name: "Configuration" }));
      fireEvent.click(await screen.findByRole("button", { name: "Enregistrer" }));

      expect(await screen.findByText("Enregistré")).toBeTruthy();
      expect(bootstrapCalls).toEqual([csrfEndpoint, csrfEndpoint]);
      expect(patchCalls).toEqual([
        { token: "bootstrap-token", credentials: "include" },
        { token: "refreshed-token", credentials: "include" },
      ]);
      expect(fetchMock).toHaveBeenCalledWith(
        configEndpoint,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ enabled: false }),
        }),
      );
    },
  );

  it("ne monte pas le formulaire de configuration avant le chargement réussi", async () => {
    const configResponse = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/storm/plugins") return jsonResponse({ plugins: [] });
      if (url === "/api/storm/config") return configResponse.promise;
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: "Configuration" }));

    expect(screen.getByText("Chargement…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();

    await act(async () => {
      configResponse.resolve(jsonResponse({ configs: { [pluginId]: { enabled: true } } }));
    });

    expect(await screen.findByRole("button", { name: "Enregistrer" })).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it.each([
    {
      tab: "Configuration",
      endpoint: "/api/storm/config",
      status: 401,
      serverError: "Non authentifié",
      expectedMessage: "Votre session a expiré. Reconnectez-vous.",
      absentText: "Enregistrer",
    },
    {
      tab: "Événements",
      endpoint: "/api/storm/events?limit=100",
      status: 403,
      serverError: "Accès refusé",
      expectedMessage: "Accès administrateur refusé.",
      absentText: "Aucun événement déclaré",
    },
  ])(
    "affiche l’état HTTP $status pour $tab sans fabriquer de données",
    async ({ tab, endpoint, status, serverError, expectedMessage, absentText }) => {
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const url = String(input);
        if (url === "/api/storm/plugins") return jsonResponse({ plugins: [] });
        if (url === endpoint) return jsonResponse({ error: serverError }, status);
        throw new Error(`Unexpected fetch: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      renderAdmin();
      fireEvent.click(screen.getByRole("button", { name: tab }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(expectedMessage);
      expect(alert.getAttribute("data-http-status")).toBe(String(status));
      expect(screen.queryByText(absentText)).toBeNull();
    },
  );
});
