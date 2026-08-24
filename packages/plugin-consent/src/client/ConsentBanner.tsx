import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { csrfFetch } from "@stormeoio/core/csrf-client";
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
  withdrawnAt: string | null;
}

interface ConsentStateResponse {
  consent: ConsentState | null;
  policyVersion: string;
}

interface ConsentMutationResponse {
  consent: ConsentState;
}

const DEFAULT_API_BASE_URL = "/api/consent";
const DEFAULT_POLICY_VERSION = "1.0";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Une erreur est survenue";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConsentState(value: unknown): value is ConsentState {
  return isRecord(value)
    && value.necessary === true
    && typeof value.analytics === "boolean"
    && typeof value.marketing === "boolean"
    && typeof value.policyVersion === "string"
    && value.policyVersion.trim().length > 0
    && (value.withdrawnAt === null
      || (typeof value.withdrawnAt === "string" && value.withdrawnAt.length > 0));
}

function isConsentStateResponse(value: unknown): value is ConsentStateResponse {
  return isRecord(value)
    && typeof value.policyVersion === "string"
    && value.policyVersion.trim().length > 0
    && (value.consent === null || isConsentState(value.consent));
}

function isConsentSaveResponse(value: unknown): value is ConsentMutationResponse {
  return isRecord(value)
    && isConsentState(value.consent)
    && value.consent.withdrawnAt === null;
}

function isConsentWithdrawalResponse(value: unknown): value is ConsentMutationResponse {
  return isRecord(value)
    && isConsentState(value.consent)
    && value.consent.analytics === false
    && value.consent.marketing === false
    && typeof value.consent.withdrawnAt === "string";
}

async function readJson<T>(
  response: Response,
  isExpectedResponse: (value: unknown) => value is T,
): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const serverError = isRecord(body)
      && typeof body.error === "string"
      && body.error.trim().length > 0
      ? body.error
      : "Le serveur ne répond pas";
    throw new Error(serverError);
  }
  if (!isExpectedResponse(body)) {
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
  const endpointControllerRef = useRef<AbortController | null>(null);

  const loadConsent = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setSaving(false);
    setError("");
    setConsent(null);
    setAnalytics(false);
    setMarketing(false);
    setEditing(true);
    setActivePolicyVersion(policyVersion);
    try {
      const response = await fetch(`${endpoints.apiBaseUrl}/state`, {
        credentials: "include",
        signal,
      });
      const body = await readJson(response, isConsentStateResponse);
      if (signal.aborted) return;
      const serverPolicyVersion = body.policyVersion;
      setConsent(body.consent);
      setActivePolicyVersion(serverPolicyVersion);
      setAnalytics(body.consent?.analytics ?? false);
      setMarketing(body.consent?.marketing ?? false);
      setEditing(body.consent === null || body.consent.policyVersion !== serverPolicyVersion);
    } catch (loadError) {
      if (signal.aborted) return;
      setError(errorMessage(loadError));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [endpoints.apiBaseUrl, policyVersion]);

  useEffect(() => {
    const controller = new AbortController();
    endpointControllerRef.current = controller;
    void loadConsent(controller.signal);
    return () => {
      controller.abort();
      if (endpointControllerRef.current === controller) {
        endpointControllerRef.current = null;
      }
    };
  }, [loadConsent]);

  const savePreferences = async (nextAnalytics: boolean, nextMarketing: boolean) => {
    const controller = endpointControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    const { signal } = controller;
    setSaving(true);
    setError("");
    try {
      const response = await csrfFetch(`${endpoints.apiBaseUrl}/preferences`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal,
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
      const body = await readJson(response, isConsentSaveResponse);
      if (signal.aborted) return;
      setConsent(body.consent);
      setAnalytics(body.consent.analytics);
      setMarketing(body.consent.marketing);
      setEditing(false);
    } catch (saveError) {
      if (signal.aborted) return;
      setError(errorMessage(saveError));
    } finally {
      if (!signal.aborted) setSaving(false);
    }
  };

  const withdrawConsent = async () => {
    const controller = endpointControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    const { signal } = controller;
    setSaving(true);
    setError("");
    try {
      const response = await csrfFetch(`${endpoints.apiBaseUrl}/withdraw`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({}),
      }, {
        endpoint: endpoints.csrfEndpoint,
        allowedOrigins: endpoints.allowedOrigins,
      });
      const body = await readJson(response, isConsentWithdrawalResponse);
      if (signal.aborted) return;
      setConsent(body.consent);
      setAnalytics(false);
      setMarketing(false);
      setEditing(false);
    } catch (withdrawError) {
      if (signal.aborted) return;
      setError(errorMessage(withdrawError));
    } finally {
      if (!signal.aborted) setSaving(false);
    }
  };

  const containerClassName = [
    "fixed inset-x-4 bottom-4 z-50 mx-auto max-w-3xl rounded-xl border border-gray-200 bg-white p-5 text-gray-900 shadow-lg",
    className,
  ].filter(Boolean).join(" ");

  if (loading) {
    return (
      <aside className={containerClassName} aria-live="polite" aria-busy="true">
        <p className="text-base text-gray-600">Chargement de vos préférences…</p>
      </aside>
    );
  }

  if (consent && !editing) {
    const withdrawn = typeof consent.withdrawnAt === "string";
    return (
      <aside
        className={containerClassName}
        aria-live="polite"
        data-proof-consent-state={withdrawn ? "withdrawn" : "saved"}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-base text-gray-700">
            {withdrawn
              ? "Votre consentement a été retiré."
              : "Vos préférences de cookies sont enregistrées."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              onClick={() => setEditing(true)}
            >
              Gérer mes choix
            </button>
            {!withdrawn && (
              <button
                type="button"
                disabled={saving}
                className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                onClick={() => void withdrawConsent()}
              >
                {saving ? "Retrait…" : "Retirer mon consentement"}
              </button>
            )}
          </div>
        </div>
        {error && <p className="mt-3 text-base text-red-700" role="alert">{error}</p>}
      </aside>
    );
  }

  return (
    <aside className={containerClassName} aria-label="Préférences de cookies">
      <h2 className="text-base font-semibold">Vos choix de confidentialité</h2>
      <p className="mt-1 text-base text-gray-600">
        Les cookies nécessaires restent actifs. Vous choisissez les autres usages.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="flex items-center gap-2 text-base text-gray-700">
          <input type="checkbox" checked disabled />
          Nécessaires
        </label>
        <label className="flex items-center gap-2 text-base text-gray-700">
          <input
            type="checkbox"
            checked={analytics}
            onChange={(event) => setAnalytics(event.target.checked)}
          />
          Mesure d’audience
        </label>
        <label className="flex items-center gap-2 text-base text-gray-700">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(event) => setMarketing(event.target.checked)}
          />
          Marketing
        </label>
      </div>

      {error && <p className="mt-3 text-base text-red-700" role="alert">{error}</p>}

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
