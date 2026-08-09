// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { StormProvider } from "../StormProvider";
import { StormRouter } from "../StormRouter";

const manifest = {
  navItems: [],
  dockItems: [],
  routes: [{ path: "/crm", component: "CrmPage", auth: true }],
  settingsPanels: [],
};

const components = {
  CrmPage: () => <h1>Contacts</h1>,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderProtectedRoute(
  hook: ReturnType<typeof memoryLocation>["hook"],
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StormProvider components={components}>
        <Router hook={hook}>
          <StormRouter loginPath="/login">
            <Route path="/login"><p>Connexion</p></Route>
          </StormRouter>
        </Router>
      </StormProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StormRouter", () => {
  it("attend la résolution de l’auth avant de protéger une route dynamique", async () => {
    const auth = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/storm/manifest") return jsonResponse(manifest);
      if (url === "/api/auth/me") return auth.promise;
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const location = memoryLocation({ path: "/crm", record: true });

    renderProtectedRoute(location.hook);

    expect(await screen.findByText("Chargement…")).toBeTruthy();
    expect(location.history).toEqual(["/crm"]);

    auth.resolve(jsonResponse({
      user: { id: "user-1", email: "fred@example.test" },
    }));

    expect(await screen.findByRole("heading", { name: "Contacts" })).toBeTruthy();
    expect(location.history).toEqual(["/crm"]);
  });

  it("redirige après résolution quand la session est réellement absente", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/storm/manifest") return jsonResponse(manifest);
      if (url === "/api/auth/me") return jsonResponse({ error: "Non authentifié" }, 401);
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const location = memoryLocation({ path: "/crm", record: true });

    renderProtectedRoute(location.hook);

    expect(await screen.findByText("Connexion")).toBeTruthy();
    expect(location.history).toEqual(["/crm", "/login"]);
  });
});
