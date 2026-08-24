import { describe, expect, it } from "vitest";
import { resolveConsentEndpoints } from "../client/endpoints";

describe("resolveConsentEndpoints", () => {
  it("normalizes the default relative Consent API", () => {
    expect(resolveConsentEndpoints("/api/consent/")).toEqual({
      apiBaseUrl: "/api/consent",
      csrfEndpoint: "/api/storm/csrf",
      allowedOrigins: [],
    });
  });

  it("derives a same-origin absolute bootstrap endpoint", () => {
    expect(resolveConsentEndpoints(
      "https://app.example.test/custom/consent/",
      "https://app.example.test",
    )).toEqual({
      apiBaseUrl: "https://app.example.test/custom/consent",
      csrfEndpoint: "https://app.example.test/custom/storm/csrf",
      allowedOrigins: [],
    });
  });

  it("explicitly trusts the configured cross-origin API", () => {
    expect(resolveConsentEndpoints(
      "https://api.example.test/api/consent",
      "https://app.example.test",
    )).toMatchObject({
      csrfEndpoint: "https://api.example.test/api/storm/csrf",
      allowedOrigins: ["https://api.example.test"],
    });
  });

  it("rejects an empty API base", () => {
    expect(() => resolveConsentEndpoints("///")).toThrow("apiBaseUrl ne peut pas être vide");
  });
});
