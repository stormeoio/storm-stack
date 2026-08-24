export interface ConsentEndpoints {
  apiBaseUrl: string;
  csrfEndpoint: string;
  allowedOrigins: string[];
}

function csrfPath(consentPath: string): string {
  const normalizedPath = consentPath.replace(/\/+$/, "");
  const apiPrefix = normalizedPath.endsWith("/consent")
    ? normalizedPath.slice(0, -"/consent".length)
    : normalizedPath.slice(0, normalizedPath.lastIndexOf("/"));
  return `${apiPrefix || "/api"}/storm/csrf`;
}

export function resolveConsentEndpoints(
  value: string,
  currentOrigin?: string,
): ConsentEndpoints {
  const normalized = value.replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("apiBaseUrl ne peut pas être vide");
  }

  if (!/^https?:\/\//i.test(normalized)) {
    return {
      apiBaseUrl: normalized,
      csrfEndpoint: csrfPath(normalized),
      allowedOrigins: [],
    };
  }

  const apiUrl = new URL(normalized);
  const csrfUrl = new URL(apiUrl.href);
  csrfUrl.pathname = csrfPath(apiUrl.pathname);
  csrfUrl.search = "";
  csrfUrl.hash = "";

  return {
    apiBaseUrl: apiUrl.href.replace(/\/$/, ""),
    csrfEndpoint: csrfUrl.href,
    allowedOrigins: apiUrl.origin === currentOrigin ? [] : [apiUrl.origin],
  };
}
