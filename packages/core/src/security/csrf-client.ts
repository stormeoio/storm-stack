export const CSRF_COOKIE_NAME = "storm_csrf";
export const CSRF_HEADER_NAME = "X-Storm-CSRF";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CROSS_ORIGIN_ERROR = "Refusing to send CSRF credentials to a cross-origin URL";
const CSRF_ERROR = "CSRF validation failed";
const NON_REPLAYABLE_BODY_ERROR = "Unable to retry CSRF request with a non-replayable body";

interface PendingBootstrap {
  endpoint: string;
  fetchImplementation: typeof globalThis.fetch;
  promise: Promise<string>;
}

const pendingBootstraps: PendingBootstrap[] = [];

export interface CsrfClientOptions {
  /** Token bootstrap route. */
  endpoint?: string;
  /** Injectable fetch implementation, primarily for runtimes and tests. */
  fetch?: typeof globalThis.fetch;
  /** Additional exact origins explicitly trusted to receive CSRF credentials. */
  allowedOrigins?: readonly string[];
}

function currentCookies(): string {
  return typeof document === "undefined" ? "" : document.cookie;
}

export function readCsrfCookie(cookieSource: string = currentCookies()): string | null {
  for (const part of cookieSource.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0 || part.slice(0, separatorIndex).trim() !== CSRF_COOKIE_NAME) {
      continue;
    }

    try {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    } catch {
      return null;
    }
  }

  return null;
}

function getFetch(fetchImplementation?: typeof globalThis.fetch): typeof globalThis.fetch {
  const resolved = fetchImplementation ?? globalThis.fetch;
  if (!resolved) {
    throw new Error("Fetch API is not available");
  }
  return resolved;
}

function csrfTokenFromResponse(value: unknown): string | null {
  if (
    typeof value === "object"
    && value !== null
    && "csrfToken" in value
    && typeof value.csrfToken === "string"
    && value.csrfToken.length > 0
  ) {
    return value.csrfToken;
  }
  return null;
}

function currentOrigin(): string | null {
  if (typeof globalThis.location === "undefined") {
    return null;
  }

  const { origin } = globalThis.location;
  return origin && origin !== "null" ? origin : null;
}

function targetUrl(input: RequestInfo | URL): URL | null {
  const value = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : typeof Request !== "undefined" && input instanceof Request
        ? input.url
        : null;

  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    const origin = currentOrigin();
    if (!origin) {
      return null;
    }

    try {
      return new URL(value, origin);
    } catch {
      return null;
    }
  }
}

function assertTrustedTarget(
  input: RequestInfo | URL,
  allowedOrigins: readonly string[] | undefined,
): void {
  const url = targetUrl(input);
  if (!url) {
    return;
  }

  const origin = currentOrigin();
  if (url.origin === origin || allowedOrigins?.includes(url.origin)) {
    return;
  }

  throw new Error(CROSS_ORIGIN_ERROR);
}

async function bootstrapCsrfToken(
  endpoint: string,
  fetchImplementation: typeof globalThis.fetch,
  preferResponseToken = false,
): Promise<string> {
  const response = await fetchImplementation(endpoint, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Unable to obtain CSRF token (${response.status})`);
  }

  let responseToken: string | null = null;
  try {
    responseToken = csrfTokenFromResponse(await response.json());
  } catch {
    // A readable cookie remains the source of truth when the response has no JSON body.
  }

  const token = preferResponseToken
    ? responseToken ?? readCsrfCookie()
    : readCsrfCookie() ?? responseToken;
  if (!token) {
    throw new Error("CSRF endpoint did not provide a token");
  }

  return token;
}

async function obtainCsrfToken(
  options: CsrfClientOptions,
  forceBootstrap: boolean,
): Promise<string> {
  const existingToken = readCsrfCookie();
  if (!forceBootstrap && existingToken) {
    return existingToken;
  }

  const fetchImplementation = getFetch(options.fetch);
  const endpoint = options.endpoint ?? "/api/storm/csrf";
  assertTrustedTarget(endpoint, options.allowedOrigins);

  const pending = pendingBootstraps.find((candidate) => (
    candidate.endpoint === endpoint && candidate.fetchImplementation === fetchImplementation
  ));
  if (pending) {
    return pending.promise;
  }

  let promise: Promise<string>;
  promise = (async () => {
    try {
      return await bootstrapCsrfToken(endpoint, fetchImplementation, forceBootstrap);
    } finally {
      const index = pendingBootstraps.findIndex((candidate) => candidate.promise === promise);
      if (index >= 0) {
        pendingBootstraps.splice(index, 1);
      }
    }
  })();
  pendingBootstraps.push({ endpoint, fetchImplementation, promise });

  return promise;
}

export async function ensureCsrfToken(options: CsrfClientOptions = {}): Promise<string> {
  return obtainCsrfToken(options, false);
}

async function isCsrfRejection(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const value = await response.clone().json() as unknown;
    return typeof value === "object"
      && value !== null
      && "error" in value
      && value.error === CSRF_ERROR;
  } catch {
    return false;
  }
}

export async function csrfFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: CsrfClientOptions = {},
): Promise<Response> {
  const fetchImplementation = getFetch(options.fetch);
  const inputMethod = typeof Request !== "undefined" && input instanceof Request
    ? input.method
    : undefined;
  const method = (init.method ?? inputMethod ?? "GET").toUpperCase();

  if (SAFE_METHODS.has(method)) {
    return fetchImplementation(input, init);
  }

  assertTrustedTarget(input, options.allowedOrigins);
  const token = await ensureCsrfToken({ ...options, fetch: fetchImplementation });
  const headers = new Headers(
    init.headers
      ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined),
  );
  headers.set(CSRF_HEADER_NAME, token);

  const requestInit = {
    ...init,
    credentials: init.credentials ?? "include",
    headers,
  };
  const retryInput = typeof Request !== "undefined" && input instanceof Request
    ? input.clone()
    : input;
  const response = await fetchImplementation(input, requestInit);
  if (!(await isCsrfRejection(response))) return response;

  if (
    init.body
    && typeof ReadableStream !== "undefined"
    && init.body instanceof ReadableStream
  ) {
    throw new Error(NON_REPLAYABLE_BODY_ERROR);
  }

  const refreshedToken = await obtainCsrfToken({ ...options, fetch: fetchImplementation }, true);
  const retryHeaders = new Headers(headers);
  retryHeaders.set(CSRF_HEADER_NAME, refreshedToken);
  return fetchImplementation(retryInput, { ...requestInit, headers: retryHeaders });
}
