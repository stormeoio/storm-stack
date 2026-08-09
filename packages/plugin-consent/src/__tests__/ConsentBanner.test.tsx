// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { ConsentBanner } from "../client/ConsentBanner";
import type { ConsentBannerProps } from "../client/ConsentBanner";

interface ExpectedConsentBannerProps {
  apiBaseUrl?: string;
  policyVersion?: string;
  className?: string;
}

interface ConsentFixture {
  consent: {
    necessary: true;
    analytics: boolean;
    marketing: boolean;
    policyVersion: string;
    withdrawnAt: string | null;
  } | null;
  policyVersion: string;
}

type ConsentPreferenceFixture = NonNullable<ConsentFixture["consent"]>;

function consentPreference(
  overrides: Partial<ConsentPreferenceFixture> = {},
): ConsentPreferenceFixture {
  return {
    necessary: true,
    analytics: true,
    marketing: false,
    policyVersion: "2026-08",
    withdrawnAt: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockConsentState(fixture: ConsentFixture) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(fixture));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setCsrfCookie(): void {
  document.cookie = "storm_csrf=proof.token; path=/";
}

afterEach(() => {
  cleanup();
  document.cookie = "storm_csrf=; Max-Age=0; path=/";
  vi.unstubAllGlobals();
});

describe("ConsentBanner", () => {
  it("conserve exactement les trois props publiques de la version 0.1.0", () => {
    expectTypeOf<ConsentBannerProps>().toEqualTypeOf<ExpectedConsentBannerProps>();
  });

  it("affiche les choix quand aucun consentement n’existe", async () => {
    mockConsentState({ consent: null, policyVersion: "1.0" });

    render(<ConsentBanner />);

    expect(await screen.findByRole("heading", { name: "Vos choix de confidentialité" }))
      .toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Nécessaires" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Mesure d’audience" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Marketing" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enregistrer mes choix" })).toBeTruthy();
  });

  it("affiche l’état enregistré quand le consentement couvre la politique active", async () => {
    mockConsentState({
      consent: consentPreference(),
      policyVersion: "2026-08",
    });

    render(<ConsentBanner />);

    const saved = await screen.findByText("Vos préférences de cookies sont enregistrées.");
    expect(saved.closest("aside")?.getAttribute("data-proof-consent-state")).toBe("saved");
    expect(screen.getByRole("button", { name: "Gérer mes choix" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retirer mon consentement" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Vos choix de confidentialité" })).toBeNull();
  });

  it("retire le consentement via CSRF et affiche l’état retiré", async () => {
    setCsrfCookie();
    const withdrawnAt = "2026-08-09T01:02:03.000Z";
    const withdrawn = consentPreference({
      analytics: false,
      withdrawnAt,
    });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        consent: consentPreference(),
        policyVersion: "2026-08",
      }))
      .mockResolvedValueOnce(jsonResponse({ consent: withdrawn }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ConsentBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Retirer mon consentement" }));

    const message = await screen.findByText("Votre consentement a été retiré.");
    expect(message.closest("aside")?.getAttribute("data-proof-consent-state")).toBe("withdrawn");
    expect(screen.queryByRole("button", { name: "Retirer mon consentement" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/consent/withdraw");
    const init = fetchMock.mock.calls[1]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("{}");
    expect(new Headers(init?.headers).get("X-Storm-CSRF")).toBe("proof.token");
  });

  it("affiche une erreur de retrait sans annoncer un faux succès", async () => {
    setCsrfCookie();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        consent: consentPreference(),
        policyVersion: "2026-08",
      }))
      .mockResolvedValueOnce(jsonResponse({ error: "Retrait indisponible" }, 503));
    vi.stubGlobal("fetch", fetchMock);

    render(<ConsentBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Retirer mon consentement" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Retrait indisponible");
    const saved = screen.getByText("Vos préférences de cookies sont enregistrées.");
    expect(saved.closest("aside")?.getAttribute("data-proof-consent-state")).toBe("saved");
    expect(screen.queryByText("Votre consentement a été retiré.")).toBeNull();
  });

  it("affiche directement un retrait existant et permet de gérer les choix", async () => {
    mockConsentState({
      consent: consentPreference({
        analytics: false,
        withdrawnAt: "2026-08-09T01:02:03.000Z",
      }),
      policyVersion: "2026-08",
    });

    render(<ConsentBanner />);

    const message = await screen.findByText("Votre consentement a été retiré.");
    expect(message.closest("aside")?.getAttribute("data-proof-consent-state")).toBe("withdrawn");
    expect(screen.getByRole("button", { name: "Gérer mes choix" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retirer mon consentement" })).toBeNull();
  });

  it("revient à l’état enregistré après une nouvelle sauvegarde", async () => {
    setCsrfCookie();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        consent: consentPreference({
          analytics: false,
          withdrawnAt: "2026-08-09T01:02:03.000Z",
        }),
        policyVersion: "2026-08",
      }))
      .mockResolvedValueOnce(jsonResponse({
        consent: consentPreference({ analytics: false, withdrawnAt: null }),
      }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ConsentBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Gérer mes choix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer mes choix" }));

    const saved = await screen.findByText("Vos préférences de cookies sont enregistrées.");
    expect(saved.closest("aside")?.getAttribute("data-proof-consent-state")).toBe("saved");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/consent/preferences");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PUT");
  });

  it("rouvre les choix quand le serveur publie une nouvelle politique", async () => {
    mockConsentState({
      consent: consentPreference(),
      policyVersion: "2026-09",
    });

    render(<ConsentBanner />);

    expect(await screen.findByRole("heading", { name: "Vos choix de confidentialité" }))
      .toBeTruthy();
    expect(screen.queryByText("Vos préférences de cookies sont enregistrées.")).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Mesure d’audience" }) as HTMLInputElement).checked)
      .toBe(true);
    expect((screen.getByRole("checkbox", { name: "Marketing" }) as HTMLInputElement).checked)
      .toBe(false);
  });
});
