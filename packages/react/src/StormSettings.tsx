import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useStorm } from "./context";
import { resolveIcon } from "./icon-resolver";
import { StormConfigForm } from "./StormConfigForm";
import { clsx } from "clsx";

export interface StormSettingsProps {
  /** API base path (default: "/api") */
  apiBase?: string;
  /** Extra settings panels to render (app-level, not plugin) */
  children?: React.ReactNode;
}

/**
 * Full settings page with tabs for each plugin that has a configSchema.
 * Auto-generates forms from the Zod schema descriptors in the manifest.
 */
export function StormSettings({ apiBase = "/api", children }: StormSettingsProps) {
  const { manifest } = useStorm();
  const qc = useQueryClient();

  const panels = manifest.settingsPanels ?? [];
  const schemas = manifest.configSchemas ?? {};
  const configurablePlugins = Object.keys(schemas);

  const [activeTab, setActiveTab] = useState<string>(
    configurablePlugins[0] ?? panels[0]?.id ?? "general",
  );

  // Fetch all configs
  const { data: configs } = useQuery({
    queryKey: ["storm", "config"],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/storm/config`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch configs");
      const data = await res.json() as { configs: Record<string, Record<string, unknown>> };
      return data.configs;
    },
    staleTime: 30_000,
  });

  // Save config mutation
  const saveMutation = useMutation({
    mutationFn: async ({ pluginId, values }: { pluginId: string; values: Record<string, unknown> }) => {
      const res = await fetch(`${apiBase}/storm/config/${encodeURIComponent(pluginId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; details?: string[] };
        throw new Error(body.details?.join(", ") ?? body.error ?? "Save failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storm", "config"] });
    },
  });

  const handleSave = useCallback(async (pluginId: string, values: Record<string, unknown>) => {
    await saveMutation.mutateAsync({ pluginId, values });
  }, [saveMutation]);

  if (configurablePlugins.length === 0 && panels.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-gray-900 mb-4">Paramètres</h1>
        <p className="text-sm text-gray-500">Aucun plugin configurable installé.</p>
        {children}
      </div>
    );
  }

  // Build tabs from configurable plugins
  const tabs = configurablePlugins.map((pluginId) => {
    const panel = panels.find((p) => pluginId.includes(p.id.replace("-settings", "")));
    const shortName = pluginId.replace("@stormstack/", "");
    return {
      id: pluginId,
      label: panel?.label ?? shortName.charAt(0).toUpperCase() + shortName.slice(1),
      icon: panel?.icon ?? "Settings",
    };
  });

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Paramètres</h1>

      <div className="flex gap-6">
        {/* Tab sidebar */}
        <div className="w-48 shrink-0">
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const Icon = resolveIcon(tab.icon);
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left",
                    activeTab === tab.id
                      ? "bg-storm-50 text-storm-700"
                      : "text-gray-600 hover:bg-gray-100",
                  )}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Active panel */}
        <div className="flex-1 max-w-xl">
          {configurablePlugins.includes(activeTab) && schemas[activeTab] && (
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">
                {tabs.find((t) => t.id === activeTab)?.label ?? activeTab}
              </h2>
              <StormConfigForm
                pluginId={activeTab}
                fields={schemas[activeTab]!}
                values={configs?.[activeTab] ?? {}}
                onSave={handleSave}
                saving={saveMutation.isPending}
              />
            </div>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}
