// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
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
    expect(screen.getByText("Les cookies nécessaires restent actifs. Vous choisissez les autres usages.").className)
      .toContain("text-base");
    expect(screen.getByText("Nécessaires").closest("label")?.className).toContain("text-base");
  });

  it("affiche l’erreur serveur quand le chargement initial échoue", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: "État du consentement indisponible" }, 503),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ConsentBanner />);

    expect((await screen.findByRole("alert")).textContent)
      .toContain("État du consentement indisponible");
    expect(screen.queryByText("Vos préférences de cookies sont enregistrées.")).toBeNull();
  });

  it("refuse une réponse initiale invalide sans fabriquer d’état", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not-json", { status: 200 }),
    ));

    render(<ConsentBanner />);

    expect((await screen.findByRole("alert")).textContent)
      .toContain("Réponse du serveur invalide");
    expect(screen.queryByText("Vos préférences de cookies sont enregistrées.")).toBeNull();
  });

  it("refuse un objet initial qui ne respecte pas la forme du contrat", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ state: null, version: "2026-08" }),
    ));

    render(<ConsentBanner />);

    expect((await screen.findByRole("alert")).textContent)
      .toContain("Réponse du serveur invalide");
    expect(screen.queryByText("Vos préférences de cookies sont enregistrées.")).toBeNull();
  });

  it("refuse les types incorrects dans le consentement initial", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      consent: {
        necessary: true,
        analytics: "oui",
        marketing: false,
        policyVersion: "2026-08",
        withdrawnAt: null,
      },
      policyVersion: "2026-08",
    })));

    render(<ConsentBanner />);

    expect((await screen.findByRole("alert")).textContent)
      .toContain("Réponse du serveur invalide");
    expect(screen.queryByText("Vos préférences de cookies sont enregistrées.")).toBeNull();
  });

  it("affiche l’état enregistré quand le consentement couvre la politique active", async () => {
    mockConsentState({
      consent: consentPreference(),
      policyVersion: "2026-08",
    });

    render(<ConsentBanner />);

    const saved = await screen.findByText("Vos préférences de cookies sont enregistrées.");
    expect(saved.className).toContain("text-base");
    expect(saved.closest("aside")?.getAttribute("data-proof-consent-state")).toBe("saved");
    expect(screen.getByRole("button", { name: "Gérer mes choix" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retirer mon consentement" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Vos choix de confidentialité" })).toBeNull();
  });

  it("efface l’état de l’ancien backend si le nouvel endpoint échoue", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        consent: consentPreference(),
        policyVersion: "2026-08",
      }))
      .mockResolvedValueOnce(jsonResponse({ error: "Nouveau backend indisponible" }, 503));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<ConsentBanner apiBaseUrl="/api/consent" />);
    expect(await screen.findByText("Vos préférences de cookies sont enregistrées.")).toBeTruthy();

    rerender(<ConsentBanner apiBaseUrl="/api/tenant-consent" />);

    expect((await screen.findByRole("alert")).textContent)
      .toContain("Nouveau backend indisponible");
    expect(screen.queryByText("Vos préférences de cookies sont enregistrées.")).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Mesure d’audience" }) as HTMLInputElement).checked)
      .toBe(false);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/tenant-consent/state");
  });

  it("ignore une sauvegarde de l’ancien backend résolue après le chargement du nouveau", async () => {
    setCsrfCookie();
    const saveFromBackendA = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/consent/state") {
        return jsonResponse({ consent: null, policyVersion: "2026-08" });
      }
      if (url === "/api/consent/preferences") {
        return saveFromBackendA.promise;
      }
      if (url === "/api/tenant-consent/state") {
        return jsonResponse({
          consent: consentPreference({
            analytics: false,
            marketing: false,
            policyVersion: "2026-09",
            withdrawnAt: "2026-09-01T00:00:00.000Z",
          }),
          policyVersion: "2026-09",
        });
      }
      throw new Error(`URL inattendue: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<ConsentBanner apiBaseUrl="/api/consent" />);
    fireEvent.click(await screen.findByRole("button", { name: "Tout accepter" }));
    await waitFor(() => expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/consent/preferences"));

    rerender(<ConsentBanner apiBaseUrl="/api/tenant-consent" />);
    expect(await screen.findByText("Votre consentement a été retiré.")).toBeTruthy();
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    expect((screen.getByRole("button", { name: "Gérer mes choix" }) as HTMLButtonElement).disabled)
      .toBe(false);

    await act(async () => {
      saveFromBackendA.resolve(jsonResponse({
        consent: consentPreference({ analytics: true, marketing: true }),
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByText("Votre consentement a été retiré.")).toBeTruthy();
    expect(screen.queryByText("Vos préférences de cookies sont enregistrées.")).toBeNull();
  });

  it("ignore un retrait de l’ancien backend résolu après le chargement du nouveau", async () => {
    setCsrfCookie();
    const withdrawalFromBackendA = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/consent/state") {
        return jsonResponse({
          consent: consentPreference(),
          policyVersion: "2026-08",
        });
      }
      if (url === "/api/consent/withdraw") {
        return withdrawalFromBackendA.promise;
      }
      if (url === "/api/tenant-consent/state") {
        return jsonResponse({
          consent: consentPreference({
            analytics: false,
            marketing: true,
            policyVersion: "2026-09",
          }),
          policyVersion: "2026-09",
        });
      }
      throw new Error(`URL inattendue: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<ConsentBanner apiBaseUrl="/api/consent" />);
    fireEvent.click(await screen.findByRole("button", { name: "Retirer mon consentement" }));
    await waitFor(() => expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/consent/withdraw"));

    rerender(<ConsentBanner apiBaseUrl="/api/tenant-consent" />);
    expect(await screen.findByText("Vos préférences de cookies sont enregistrées.")).toBeTruthy();
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    expect((screen.getByRole("button", { name: "Gérer mes choix" }) as HTMLButtonElement).disabled)
      .toBe(false);

    await act(async () => {
      withdrawalFromBackendA.resolve(jsonResponse({
        consent: consentPreference({
          analytics: false,
          marketing: false,
          withdrawnAt: "2026-08-31T23:59:59.000Z",
        }),
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByText("Vos préférences de cookies sont enregistrées.")).toBeTruthy();
    expect(screen.queryByText("Votre consentement a été retiré.")).toBeNull();
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

  it("refuse une réponse de retrait qui ne contient pas un consentement valide", async () => {
    setCsrfCookie();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        consent: consentPreference(),
        policyVersion: "2026-08",
      }))
      .mockResolvedValueOnce(jsonResponse({ consent: { withdrawnAt: true } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ConsentBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Retirer mon consentement" }));

    expect((await screen.findByRole("alert")).textContent)
      .toContain("Réponse du serveur invalide");
    expect(screen.getByText("Vos préférences de cookies sont enregistrées.")).toBeTruthy();
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

  it("conserve les choix et n’annonce aucun succès si la sauvegarde est refusée", async () => {
    setCsrfCookie();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ consent: null, policyVersion: "2026-08" }))
      .mockResolvedValueOnce(jsonResponse({
        error: "La politique de confidentialité a changé",
      }, 409));
    vi.stubGlobal("fetch", fetchMock);

    render(<ConsentBanner />);
    const analytics = await screen.findByRole("checkbox", { name: "Mesure d’audience" });
    fireEvent.click(analytics);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer mes choix" }));

    expect((await screen.findByRole("alert")).textContent)
      .toContain("La politique de confidentialité a changé");
    expect((analytics as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("heading", { name: "Vos choix de confidentialité" })).toBeTruthy();
    expect(screen.queryByText("Vos préférences de cookies sont enregistrées.")).toBeNull();
  });

  it("refuse consent:null après une sauvegarde réussie au niveau HTTP", async () => {
    setCsrfCookie();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ consent: null, policyVersion: "2026-08" }))
      .mockResolvedValueOnce(jsonResponse({ consent: null }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ConsentBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Enregistrer mes choix" }));

    expect((await screen.findByRole("alert")).textContent)
      .toContain("Réponse du serveur invalide");
    expect(screen.getByRole("heading", { name: "Vos choix de confidentialité" })).toBeTruthy();
    expect(screen.queryByText("Vos préférences de cookies sont enregistrées.")).toBeNull();
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
