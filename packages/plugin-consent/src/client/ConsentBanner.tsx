import { useCallback, useEffect, useMemo, useState } from "react";
import { csrfFetch } from "@stormstack/core/csrf-client";
import { resolveConsentEndpoints } from "./endpoints";

export interface ConsentBannerProps {
  apiBaseUrl?: string;
  policyVersion?: string;
  className?: string;
}

interface ConsentState {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  policyVersion: string;
}

interface ConsentStateResponse {
  consent: ConsentState | null;
  policyVersion: string;
}

const DEFAULT_API_BASE_URL = "/api/consent";
const DEFAULT_POLICY_VERSION = "1.0";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Une erreur est survenue";
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(body?.error ?? "Le serveur ne répond pas");
  }
  if (!body) {
    throw new Error("Réponse du serveur invalide");
  }
  return body;
}

export function ConsentBanner({
  apiBaseUrl = DEFAULT_API_BASE_URL,
  policyVersion = DEFAULT_POLICY_VERSION,
  className = "",
}: ConsentBannerProps) {
  const endpoints = useMemo(
    () => resolveConsentEndpoints(
      apiBaseUrl,
      typeof window === "undefined" ? undefined : window.location.origin,
    ),
    [apiBaseUrl],
  );
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [activePolicyVersion, setActivePolicyVersion] = useState(policyVersion);

  const loadConsent = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${endpoints.apiBaseUrl}/state`, {
        credentials: "include",
        signal,
      });
      const body = await readJson<ConsentStateResponse>(response);
      const serverPolicyVersion = body.policyVersion || policyVersion;
      setConsent(body.consent);
      setActivePolicyVersion(serverPolicyVersion);
      setAnalytics(body.consent?.analytics ?? false);
      setMarketing(body.consent?.marketing ?? false);
      setEditing(body.consent === null || body.consent.policyVersion !== serverPolicyVersion);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(errorMessage(loadError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [endpoints.apiBaseUrl, policyVersion]);

  useEffect(() => {
    const controller = new AbortController();
    void loadConsent(controller.signal);
    return () => controller.abort();
  }, [loadConsent]);

  const savePreferences = async (nextAnalytics: boolean, nextMarketing: boolean) => {
    setSaving(true);
    setError("");
    try {
      const response = await csrfFetch(`${endpoints.apiBaseUrl}/preferences`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          necessary: true,
          analytics: nextAnalytics,
          marketing: nextMarketing,
          policyVersion: activePolicyVersion,
        }),
      }, {
        endpoint: endpoints.csrfEndpoint,
        allowedOrigins: endpoints.allowedOrigins,
      });
      const body = await readJson<{ consent: ConsentState }>(response);
      setConsent(body.consent);
      setAnalytics(body.consent.analytics);
      setMarketing(body.consent.marketing);
      setEditing(false);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const containerClassName = [
    "fixed inset-x-4 bottom-4 z-50 mx-auto max-w-3xl rounded-xl border border-gray-200 bg-white p-5 text-gray-900 shadow-lg",
    className,
  ].filter(Boolean).join(" ");

  if (loading) {
    return (
      <aside className={containerClassName} aria-live="polite" aria-busy="true">
        <p className="text-sm text-gray-600">Chargement de vos préférences…</p>
      </aside>
    );
  }

  if (consent && !editing) {
    return (
      <aside className={containerClassName} aria-live="polite" data-proof-consent-state="saved">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-700">Vos préférences de cookies sont enregistrées.</p>
          <button
            type="button"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
            onClick={() => setEditing(true)}
          >
            Gérer mes choix
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className={containerClassName} aria-label="Préférences de cookies">
      <h2 className="text-base font-semibold">Vos choix de confidentialité</h2>
      <p className="mt-1 text-sm text-gray-600">
        Les cookies nécessaires restent actifs. Vous choisissez les autres usages.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked disabled />
          Nécessaires
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={analytics}
            onChange={(event) => setAnalytics(event.target.checked)}
          />
          Mesure d’audience
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(event) => setMarketing(event.target.checked)}
          />
          Marketing
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => void savePreferences(analytics, marketing)}
        >
          {saving ? "Enregistrement…" : "Enregistrer mes choix"}
        </button>
        <button
          type="button"
          disabled={saving}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
          onClick={() => void savePreferences(false, false)}
        >
          Nécessaires uniquement
        </button>
        <button
          type="button"
          disabled={saving}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
          onClick={() => void savePreferences(true, true)}
        >
          Tout accepter
        </button>
      </div>
    </aside>
  );
}
