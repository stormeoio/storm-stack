import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { csrfFetch } from "@stormstack/core/csrf-client";
import { useStorm } from "./context";
import { resolveIcon } from "./icon-resolver";
import { StormConfigForm } from "./StormConfigForm";
import { clsx } from "clsx";
import type { FieldDescriptor, StormManifest } from "./types";

export interface StormAdminProps {
  apiBase?: string;
}

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  pricing: string;
}

interface CatalogEntry extends PluginInfo {
  shortName: string;
  status: "installed" | "available" | "coming-soon";
  requires: string[];
  envVars: Record<string, { description: string; required: boolean; example?: string }>;
  category: string;
}

interface EventEntry {
  name: string;
  timestamp: string;
  source?: string;
  payload: Record<string, unknown>;
}

type AdminTab = "overview" | "config" | "events" | "catalog";

interface AdminEndpoints {
  apiBase: string;
  csrfEndpoint: string;
  allowedOrigins: string[];
}

class AdminHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminHttpError";
  }
}

async function adminHttpError(response: Response, fallback: string): Promise<AdminHttpError> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  const serverMessage = typeof body?.error === "string" && body.error.trim()
    ? body.error
    : null;

  if (response.status === 401) {
    return new AdminHttpError(401, "Votre session a expiré. Reconnectez-vous.");
  }
  if (response.status === 403) {
    return new AdminHttpError(403, "Accès administrateur refusé.");
  }
  return new AdminHttpError(
    response.status,
    serverMessage ?? `${fallback} (HTTP ${response.status})`,
  );
}

function AdminErrorState({ error, fallback }: { error: unknown; fallback: string }) {
  const status = error instanceof AdminHttpError ? error.status : undefined;
  const message = error instanceof Error ? error.message : fallback;
  return (
    <div
      role="alert"
      data-http-status={status}
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {message}
    </div>
  );
}

function resolveAdminEndpoints(apiBase: string): AdminEndpoints {
  const normalizedApiBase = apiBase.replace(/\/+$/, "");
  const csrfEndpoint = `${normalizedApiBase}/storm/csrf`;

  if (!/^https?:\/\//i.test(normalizedApiBase)) {
    return { apiBase: normalizedApiBase, csrfEndpoint, allowedOrigins: [] };
  }

  const apiUrl = new URL(normalizedApiBase);
  const currentOrigin = typeof window === "undefined" ? undefined : window.location.origin;
  return {
    apiBase: normalizedApiBase,
    csrfEndpoint,
    allowedOrigins: apiUrl.origin === currentOrigin ? [] : [apiUrl.origin],
  };
}

export function StormAdmin({ apiBase = "/api" }: StormAdminProps) {
  const { manifest } = useStorm();
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const endpoints = useMemo(() => resolveAdminEndpoints(apiBase), [apiBase]);

  const tabs: { id: AdminTab; label: string; icon: string }[] = [
    { id: "overview", label: "Plugins", icon: "Package" },
    { id: "config", label: "Configuration", icon: "Settings" },
    { id: "events", label: "Événements", icon: "Activity" },
    { id: "catalog", label: "Catalogue", icon: "Search" },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Administration Storm Stack</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {tabs.map((tab) => {
          const Icon = resolveIcon(tab.icon);
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                activeTab === tab.id
                  ? "border-storm-600 text-storm-700"
                  : "border-transparent text-gray-500 hover:text-gray-700",
              )}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && <OverviewTab apiBase={endpoints.apiBase} />}
      {activeTab === "config" && <ConfigTab endpoints={endpoints} manifest={manifest} />}
      {activeTab === "events" && <EventsTab apiBase={endpoints.apiBase} />}
      {activeTab === "catalog" && <CatalogTab apiBase={endpoints.apiBase} />}
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ apiBase }: { apiBase: string }) {
  const { data: plugins, isLoading } = useQuery<PluginInfo[]>({
    queryKey: ["storm", "admin", "plugins"],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/storm/plugins`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch plugins");
      const data = await res.json() as { plugins: PluginInfo[] };
      return data.plugins;
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return <div className="text-sm text-gray-500">Chargement…</div>;
  }

  if (!plugins || plugins.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-sm">Aucun plugin installé.</p>
        <p className="text-gray-400 text-xs mt-1">
          Utilisez <code className="bg-gray-100 px-1 rounded">storm add</code> pour installer des plugins.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-500 mb-4">
        {plugins.length} plugin{plugins.length > 1 ? "s" : ""} installé{plugins.length > 1 ? "s" : ""}
      </div>
      <div className="grid gap-3">
        {plugins.map((plugin) => (
          <PluginCard key={plugin.id} plugin={plugin} />
        ))}
      </div>
    </div>
  );
}

function PluginCard({ plugin }: { plugin: PluginInfo }) {
  const Icon = resolveIcon("Package");
  return (
    <div className="flex items-start gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 transition-colors">
      <div className="p-2 bg-storm-50 rounded-lg text-storm-600">
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{plugin.name}</h3>
          <span className="text-xs text-gray-400 font-mono">v{plugin.version}</span>
          <span className={clsx(
            "px-2 py-0.5 text-xs rounded-full font-medium",
            plugin.pricing === "free"
              ? "bg-green-50 text-green-700"
              : plugin.pricing === "premium"
                ? "bg-amber-50 text-amber-700"
                : "bg-purple-50 text-purple-700",
          )}>
            {plugin.pricing}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{plugin.description}</p>
        <div className="flex gap-1.5 mt-2">
          {plugin.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div className="text-xs text-gray-400 font-mono shrink-0">{plugin.id}</div>
    </div>
  );
}

// ── Config Tab ───────────────────────────────────────────────────────────────

function ConfigTab({
  endpoints,
  manifest,
}: {
  endpoints: AdminEndpoints;
  manifest: StormManifest;
}) {
  const qc = useQueryClient();
  const { apiBase, csrfEndpoint, allowedOrigins } = endpoints;
  const schemas: Record<string, Record<string, FieldDescriptor>> = manifest.configSchemas ?? {};
  const pluginIds = Object.keys(schemas);
  const [activePlugin, setActivePlugin] = useState<string>(pluginIds[0] ?? "");

  const { data: configs, isLoading, error } = useQuery({
    queryKey: ["storm", "config", apiBase],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/storm/config`, { credentials: "include" });
      if (!res.ok) throw await adminHttpError(res, "Impossible de charger la configuration");
      const data = await res.json() as { configs: Record<string, Record<string, unknown>> };
      return data.configs;
    },
    enabled: pluginIds.length > 0,
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ pluginId, values }: { pluginId: string; values: Record<string, unknown> }) => {
      const res = await csrfFetch(`${apiBase}/storm/config/${encodeURIComponent(pluginId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      }, {
        endpoint: csrfEndpoint,
        allowedOrigins,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; details?: string[] };
        throw new Error(body.details?.join(", ") ?? body.error ?? "Save failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storm", "config", apiBase] });
    },
  });

  const handleSave = useCallback(async (pluginId: string, values: Record<string, unknown>) => {
    await saveMutation.mutateAsync({ pluginId, values });
  }, [saveMutation]);

  if (pluginIds.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-sm">Aucun plugin configurable.</p>
        <p className="text-gray-400 text-xs mt-1">
          Les plugins avec un <code className="bg-gray-100 px-1 rounded">configSchema</code> apparaîtront ici.
        </p>
      </div>
    );
  }

  if (error) {
    return <AdminErrorState error={error} fallback="Impossible de charger la configuration" />;
  }

  if (isLoading || !configs) {
    return <div className="text-sm text-gray-500">Chargement…</div>;
  }

  return (
    <div className="flex gap-6">
      <div className="w-48 shrink-0">
        <nav className="space-y-1">
          {pluginIds.map((id) => {
            const shortName = id.replace("@stormstack/", "");
            const label = shortName.charAt(0).toUpperCase() + shortName.slice(1);
            return (
              <button
                key={id}
                onClick={() => setActivePlugin(id)}
                className={clsx(
                  "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  activePlugin === id
                    ? "bg-storm-50 text-storm-700"
                    : "text-gray-600 hover:bg-gray-100",
                )}
              >
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex-1 max-w-xl">
        {activePlugin && schemas[activePlugin] && (
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">
              {activePlugin.replace("@stormstack/", "").replace(/^\w/, (c) => c.toUpperCase())}
            </h2>
            <StormConfigForm
              key={activePlugin}
              pluginId={activePlugin}
              fields={schemas[activePlugin]!}
              values={configs[activePlugin] ?? {}}
              onSave={handleSave}
              saving={saveMutation.isPending}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Events Tab ───────────────────────────────────────────────────────────────

function EventsTab({ apiBase }: { apiBase: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["storm", "admin", "events", apiBase],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/storm/events?limit=100`, { credentials: "include" });
      if (!res.ok) throw await adminHttpError(res, "Impossible de charger les événements");
      return res.json() as Promise<{
        emitters: Record<string, string[]>;
        listeners: Record<string, string[]>;
        history: EventEntry[];
      }>;
    },
    refetchInterval: 5000,
    staleTime: 3000,
  });

  if (error) {
    return <AdminErrorState error={error} fallback="Impossible de charger les événements" />;
  }

  if (isLoading || !data) {
    return <div className="text-sm text-gray-500">Chargement…</div>;
  }

  const { emitters, listeners, history } = data;

  return (
    <div className="space-y-6">
      {/* Event topology */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Émetteurs</h3>
          {Object.keys(emitters).length === 0 ? (
            <p className="text-xs text-gray-400">Aucun événement déclaré</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(emitters).map(([pluginId, events]) => (
                <div key={pluginId}>
                  <div className="text-xs font-medium text-gray-600">
                    {pluginId.replace("@stormstack/", "")}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {events.map((e) => (
                      <span key={e} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-xs rounded font-mono">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Écouteurs</h3>
          {Object.keys(listeners).length === 0 ? (
            <p className="text-xs text-gray-400">Aucun handler enregistré</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(listeners).map(([pluginId, events]) => (
                <div key={pluginId}>
                  <div className="text-xs font-medium text-gray-600">
                    {pluginId.replace("@stormstack/", "")}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {events.map((e) => (
                      <span key={e} className="px-1.5 py-0.5 bg-green-50 text-green-600 text-xs rounded font-mono">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Event history */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Historique</h3>
          <span className="text-xs text-gray-400">{history.length} événement(s)</span>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-gray-400">Aucun événement émis</p>
        ) : (
          <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {[...history].reverse().map((event, i) => (
              <div key={i} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-storm-600 font-medium">{event.name}</span>
                  {event.source && (
                    <span className="text-xs text-gray-400">
                      ← {event.source.replace("@stormstack/", "")}
                    </span>
                  )}
                  <span className="text-xs text-gray-300 ml-auto">
                    {new Date(event.timestamp).toLocaleTimeString("fr-FR")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Catalog Tab ──────────────────────────────────────────────────────────────

function CatalogTab({ apiBase }: { apiBase: string }) {
  const [filter, setFilter] = useState<"all" | "installed" | "available" | "coming-soon">("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["storm", "admin", "catalog"],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/storm/catalog`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch catalog");
      return res.json() as Promise<{
        catalog: CatalogEntry[];
        categories: string[];
      }>;
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="text-sm text-gray-500">Chargement…</div>;
  }

  const catalog = data?.catalog ?? [];
  const filtered = useMemo(() => {
    return catalog
      .filter((e) => filter === "all" || e.status === filter)
      .filter((e) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          e.name.toLowerCase().includes(q) ||
          e.shortName.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q))
        );
      });
  }, [catalog, filter, search]);

  const statusCounts = useMemo(() => ({
    all: catalog.length,
    installed: catalog.filter((e) => e.status === "installed").length,
    available: catalog.filter((e) => e.status === "available").length,
    "coming-soon": catalog.filter((e) => e.status === "coming-soon").length,
  }), [catalog]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un plugin…"
          className="flex-1 max-w-xs px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-storm-500 focus:border-transparent outline-none"
        />
        <div className="flex gap-1">
          {(["all", "installed", "available", "coming-soon"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                filter === f
                  ? "bg-storm-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200",
              )}
            >
              {f === "all" ? "Tous" : f === "installed" ? "Installés" : f === "available" ? "Disponibles" : "Bientôt"}
              <span className="ml-1 opacity-70">{statusCounts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Catalog grid */}
      <div className="grid gap-3">
        {filtered.map((entry) => (
          <CatalogCard key={entry.id} entry={entry} />
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">
            Aucun plugin ne correspond à cette recherche.
          </p>
        )}
      </div>
    </div>
  );
}

function CatalogCard({ entry }: { entry: CatalogEntry }) {
  const Icon = resolveIcon("Package");
  const statusConfig = {
    installed: { label: "Installé", bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500" },
    available: { label: "Disponible", bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
    "coming-soon": { label: "Bientôt", bg: "bg-gray-50", text: "text-gray-500", dot: "bg-gray-400" },
  };
  const status = statusConfig[entry.status];

  return (
    <div className={clsx(
      "flex items-start gap-4 p-4 border rounded-xl transition-colors",
      entry.status === "installed"
        ? "bg-white border-gray-200 hover:border-gray-300"
        : entry.status === "available"
          ? "bg-white border-gray-200 hover:border-blue-300"
          : "bg-gray-50 border-gray-100 opacity-70",
    )}>
      <div className={clsx(
        "p-2 rounded-lg",
        entry.status === "installed" ? "bg-storm-50 text-storm-600" : "bg-gray-100 text-gray-400",
      )}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{entry.name}</h3>
          <span className={clsx("flex items-center gap-1 px-2 py-0.5 text-xs rounded-full font-medium", status.bg, status.text)}>
            <span className={clsx("w-1.5 h-1.5 rounded-full", status.dot)} />
            {status.label}
          </span>
          {entry.requires.length > 0 && (
            <span className="text-xs text-gray-400">
              requiert {entry.requires.map((r) => r.replace("@stormstack/", "")).join(", ")}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{entry.description}</p>
        <div className="flex gap-1.5 mt-2">
          {entry.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div className="text-xs text-gray-400 font-mono shrink-0">{entry.category}</div>
    </div>
  );
}
