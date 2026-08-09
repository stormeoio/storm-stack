// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsentBanner } from "../client/ConsentBanner";

interface ConsentFixture {
  consent: {
    necessary: true;
    analytics: boolean;
    marketing: boolean;
    policyVersion: string;
  } | null;
  policyVersion: string;
}

function mockConsentState(fixture: ConsentFixture): void {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ConsentBanner", () => {
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
      consent: {
        necessary: true,
        analytics: true,
        marketing: false,
        policyVersion: "2026-08",
      },
      policyVersion: "2026-08",
    });

    render(<ConsentBanner />);

    const saved = await screen.findByText("Vos préférences de cookies sont enregistrées.");
    expect(saved.closest("aside")?.getAttribute("data-proof-consent-state")).toBe("saved");
    expect(screen.getByRole("button", { name: "Gérer mes choix" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Vos choix de confidentialité" })).toBeNull();
  });

  it("rouvre les choix quand le serveur publie une nouvelle politique", async () => {
    mockConsentState({
      consent: {
        necessary: true,
        analytics: true,
        marketing: false,
        policyVersion: "2026-08",
      },
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
