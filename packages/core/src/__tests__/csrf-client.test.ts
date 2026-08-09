import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CSRF_HEADER_NAME,
  csrfFetch,
  ensureCsrfToken,
  readCsrfCookie,
} from "../security/csrf-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readCsrfCookie", () => {
  it("reads and decodes the Storm CSRF cookie", () => {
    expect(readCsrfCookie("theme=dark; storm_csrf=nonce.signature%3D; locale=fr"))
      .toBe("nonce.signature=");
  });

  it("returns null for a missing or malformed cookie", () => {
    expect(readCsrfCookie("theme=dark")).toBeNull();
    expect(readCsrfCookie("storm_csrf=%E0%A4%A")).toBeNull();
  });
});

describe("ensureCsrfToken", () => {
  it("returns the existing cookie without fetching", async () => {
    vi.stubGlobal("document", { cookie: "storm_csrf=existing.token" });
    const fetchMock = vi.fn<typeof fetch>();

    await expect(ensureCsrfToken({ fetch: fetchMock })).resolves.toBe("existing.token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bootstraps the token with credentials included", async () => {
    vi.stubGlobal("document", { cookie: "" });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ csrfToken: "issued.token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(ensureCsrfToken({ endpoint: "/custom/csrf", fetch: fetchMock }))
      .resolves.toBe("issued.token");
    expect(fetchMock).toHaveBeenCalledWith("/custom/csrf", {
      method: "GET",
      credentials: "include",
    });
  });

  it("shares one in-flight bootstrap across concurrent callers", async () => {
    vi.stubGlobal("document", { cookie: "" });
    let resolveBootstrap!: (response: Response) => void;
    const bootstrapResponse = new Promise<Response>((resolve) => {
      resolveBootstrap = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => bootstrapResponse);

    const calls = Promise.all([
      ensureCsrfToken({ fetch: fetchMock }),
      ensureCsrfToken({ fetch: fetchMock }),
      ensureCsrfToken({ fetch: fetchMock }),
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    resolveBootstrap(new Response(JSON.stringify({ csrfToken: "shared.token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(calls).resolves.toEqual(["shared.token", "shared.token", "shared.token"]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refuses a cross-origin bootstrap endpoint unless its origin is explicitly trusted", async () => {
    vi.stubGlobal("location", { origin: "https://app.example.com" });
    vi.stubGlobal("document", { cookie: "" });
    const fetchMock = vi.fn<typeof fetch>();

    await expect(ensureCsrfToken({
      endpoint: "https://attacker.example/csrf",
      fetch: fetchMock,
    })).rejects.toThrow("Refusing to send CSRF credentials to a cross-origin URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails when the endpoint rejects or provides no token", async () => {
    vi.stubGlobal("document", { cookie: "" });
    const rejectedFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(ensureCsrfToken({ fetch: rejectedFetch }))
      .rejects.toThrow("Unable to obtain CSRF token (503)");

    const emptyFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(ensureCsrfToken({ fetch: emptyFetch }))
      .rejects.toThrow("CSRF endpoint did not provide a token");
  });
});

describe("csrfFetch", () => {
  it("passes safe requests through without bootstrapping or changing init", async () => {
    vi.stubGlobal("document", { cookie: "" });
    const response = new Response(null, { status: 204 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    const init: RequestInit = { headers: { Accept: "application/json" } };

    await expect(csrfFetch("/api/state", init, { fetch: fetchMock })).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/state", init);
  });

  it.each(["HEAD", "OPTIONS"])(
    "passes the safe %s method through without bootstrapping",
    async (method) => {
      vi.stubGlobal("document", { cookie: "" });
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

      await csrfFetch("/api/state", { method }, { fetch: fetchMock });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith("/api/state", { method });
    },
  );

  it("adds the cookie token and preserves existing headers on unsafe requests", async () => {
    vi.stubGlobal("document", { cookie: "storm_csrf=cookie.token" });
    const response = new Response(null, { status: 204 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);

    await csrfFetch("/api/preferences", {
      method: "put",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }, { fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestInit = fetchMock.mock.calls[0]![1]!;
    const headers = new Headers(requestInit.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get(CSRF_HEADER_NAME)).toBe("cookie.token");
    expect(requestInit.credentials).toBe("include");
  });

  it("protects a non-standard PURGE request", async () => {
    vi.stubGlobal("document", { cookie: "storm_csrf=purge.token" });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    await csrfFetch("/api/cache", { method: "PURGE" }, { fetch: fetchMock });

    const requestInit = fetchMock.mock.calls[0]![1]!;
    expect(new Headers(requestInit.headers).get(CSRF_HEADER_NAME)).toBe("purge.token");
    expect(requestInit.credentials).toBe("include");
  });

  it("refuses an absolute cross-origin unsafe request by default", async () => {
    vi.stubGlobal("location", { origin: "https://app.example.com" });
    vi.stubGlobal("document", { cookie: "storm_csrf=private.token" });
    const fetchMock = vi.fn<typeof fetch>();

    await expect(csrfFetch("https://attacker.example/api/preferences", {
      method: "POST",
    }, { fetch: fetchMock })).rejects.toThrow(
      "Refusing to send CSRF credentials to a cross-origin URL",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows an absolute same-origin unsafe request", async () => {
    vi.stubGlobal("location", { origin: "https://app.example.com" });
    vi.stubGlobal("document", { cookie: "storm_csrf=same-origin.token" });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    await csrfFetch("https://app.example.com/api/preferences", {
      method: "POST",
    }, { fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestInit = fetchMock.mock.calls[0]![1]!;
    expect(new Headers(requestInit.headers).get(CSRF_HEADER_NAME)).toBe("same-origin.token");
  });

  it("allows a cross-origin target only when its exact origin is explicitly trusted", async () => {
    vi.stubGlobal("location", { origin: "https://app.example.com" });
    vi.stubGlobal("document", { cookie: "storm_csrf=trusted.token" });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    await csrfFetch("https://api.example.com/preferences", {
      method: "POST",
    }, {
      fetch: fetchMock,
      allowedOrigins: ["https://api.example.com"],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestInit = fetchMock.mock.calls[0]![1]!;
    expect(new Headers(requestInit.headers).get(CSRF_HEADER_NAME)).toBe("trusted.token");
    expect(requestInit.credentials).toBe("include");
  });

  it("bootstraps once then sends an unsafe request with the returned token", async () => {
    vi.stubGlobal("document", { cookie: "" });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "fresh.token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await csrfFetch("/api/preferences", { method: "PATCH" }, { fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/storm/csrf",
      { method: "GET", credentials: "include" },
    ]);
    const mutationInit = fetchMock.mock.calls[1]![1]!;
    expect(new Headers(mutationInit.headers).get(CSRF_HEADER_NAME)).toBe("fresh.token");
  });

  it("re-bootstraps once and retries a stable CSRF rejection with the fresh token", async () => {
    vi.stubGlobal("document", { cookie: "storm_csrf=stale.token" });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "CSRF validation failed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "fresh.token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(csrfFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "fred@example.test", password: "secret" }),
    }, { fetch: fetchMock })).resolves.toMatchObject({ status: 204 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).get(CSRF_HEADER_NAME)).toBe("stale.token");
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/storm/csrf",
      { method: "GET", credentials: "include" },
    ]);
    expect(new Headers(fetchMock.mock.calls[2]![1]!.headers).get(CSRF_HEADER_NAME)).toBe("fresh.token");
  });

  it("clones a Request input before sending so its body remains replayable", async () => {
    vi.stubGlobal("location", { origin: "https://app.example.com" });
    vi.stubGlobal("document", { cookie: "storm_csrf=stale.token" });
    const receivedBodies: string[] = [];
    let mutationCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (input instanceof Request) {
        receivedBodies.push(await input.text());
        mutationCount += 1;
        return mutationCount === 1
          ? new Response(JSON.stringify({ error: "CSRF validation failed" }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            })
          : new Response(null, { status: 204 });
      }

      return new Response(JSON.stringify({ csrfToken: "fresh.token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const request = new Request("https://app.example.com/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analytics: true }),
    });

    await expect(csrfFetch(request, {}, { fetch: fetchMock }))
      .resolves.toMatchObject({ status: 204 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(receivedBodies).toEqual([
      JSON.stringify({ analytics: true }),
      JSON.stringify({ analytics: true }),
    ]);
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).get(CSRF_HEADER_NAME))
      .toBe("stale.token");
    expect(new Headers(fetchMock.mock.calls[2]![1]!.headers).get(CSRF_HEADER_NAME))
      .toBe("fresh.token");
  });

  it("does not retry an unrelated 403 or retry a CSRF rejection more than once", async () => {
    vi.stubGlobal("document", { cookie: "storm_csrf=stale.token" });
    const forbidden = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "Accès refusé" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(csrfFetch("/api/admin", { method: "POST" }, { fetch: forbidden }))
      .resolves.toMatchObject({ status: 403 });
    expect(forbidden).toHaveBeenCalledOnce();

    const staleTwice = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "CSRF validation failed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "fresh.token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "CSRF validation failed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }));
    await expect(csrfFetch("/api/preferences", { method: "PUT" }, { fetch: staleTwice }))
      .resolves.toMatchObject({ status: 403 });
    expect(staleTwice).toHaveBeenCalledTimes(3);
  });
});
