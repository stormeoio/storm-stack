import { useState } from "react";
import { Settings, Activity, Puzzle, Shield, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import {
  usePlugins,
  useManifestWithSchemas,
  usePluginConfigs,
  useStormEvents,
  useUpdatePluginConfig,
} from "@/lib/queries";
import { PluginSettingsForm } from "@/components/admin/PluginSettingsForm";
import { EventLogViewer } from "@/components/admin/EventLogViewer";

type Tab = "overview" | "settings" | "events";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Vue d'ensemble", icon: Puzzle },
  { id: "settings", label: "Paramètres", icon: Settings },
  { id: "events", label: "Événements", icon: Activity },
];

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <div className="w-8 h-8 rounded-lg bg-storm-600 flex items-center justify-center">
          <Shield size={16} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Administration</h1>
          <p className="text-xs text-gray-500">Gestion des plugins, paramètres et événements</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={clsx(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
              activeTab === id
                ? "border-storm-600 text-storm-700"
                : "border-transparent text-gray-500 hover:text-gray-700",
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && <OverviewTab />}
      {activeTab === "settings" && <SettingsTab />}
      {activeTab === "events" && <EventsTab />}
    </div>
  );
}

// ── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data: plugins = [], isLoading } = usePlugins();
  const { data: manifest } = useManifestWithSchemas();
  const { data: events } = useStormEvents(10);

  const configurable = manifest?.configSchemas
    ? Object.keys(manifest.configSchemas).length
    : 0;

  const emitterCount = events ? Object.keys(events.emitters).length : 0;
  const listenerCount = events ? Object.keys(events.listeners).length : 0;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Plugins actifs" value={plugins.length} color="storm" icon={Puzzle} />
        <StatCard label="Configurables" value={configurable} color="amber" icon={Settings} />
        <StatCard label="Emitters" value={emitterCount} color="blue" icon={Activity} />
        <StatCard label="Listeners" value={listenerCount} color="purple" icon={RefreshCw} />
      </div>

      {/* Plugins table */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Plugins installés</h2>
        {isLoading ? (
          <div className="text-sm text-gray-400">Chargement...</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Plugin</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">ID</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Version</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Tags</th>
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Config</th>
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plugins.map((p) => {
                  const hasConfig = manifest?.configSchemas?.[p.id] && Object.keys(manifest.configSchemas[p.id]!).length > 0;
                  const emits = events?.emitters[p.id]?.length ?? 0;
                  const listens = events?.listeners[p.id]?.length ?? 0;

                  return (
                    <tr key={p.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-green-400" />
                          <span className="font-medium text-gray-900">{p.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 font-mono">{p.id}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 font-mono">v{p.version}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {p.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {hasConfig ? (
                          <span className="text-[10px] bg-storm-50 text-storm-600 px-1.5 py-0.5 rounded font-medium">
                            {Object.keys(manifest!.configSchemas[p.id]!).length} champs
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {(emits > 0 || listens > 0) ? (
                          <span className="text-[10px] text-gray-500">
                            {emits > 0 && <span className="text-blue-600">{emits} emit</span>}
                            {emits > 0 && listens > 0 && " · "}
                            {listens > 0 && <span className="text-purple-600">{listens} listen</span>}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent events */}
      {events && events.history.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Derniers événements</h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {events.history.slice(0, 5).map((e, i) => (
              <div key={`${e.name}-${i}`} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                <span className="text-gray-400 font-mono w-16 shrink-0">
                  {new Date(e.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className="font-medium text-gray-700 font-mono">{e.name}</span>
                <span className="text-gray-400 ml-auto font-mono">
                  {e.source.replace("@stormeoio/", "")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Settings Tab ────────────────────────────────────────────────────────────

function SettingsTab() {
  const { data: plugins = [] } = usePlugins();
  const { data: manifest } = useManifestWithSchemas();
  const { data: configs = {} } = usePluginConfigs();
  const updateConfig = useUpdatePluginConfig();

  const configurablePlugins = plugins.filter(
    (p) => manifest?.configSchemas?.[p.id] && Object.keys(manifest.configSchemas[p.id]!).length > 0,
  );

  if (configurablePlugins.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
        <Settings size={32} className="text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-500">Aucun plugin configurable</p>
        <p className="text-xs text-gray-400 mt-1">
          Les plugins avec un <code className="font-mono text-storm-600">configSchema</code> apparaissent ici.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {configurablePlugins.map((plugin) => {
        const schema = manifest!.configSchemas[plugin.id]!;
        const values = configs[plugin.id] ?? {};

        return (
          <div key={plugin.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <PluginSettingsForm
              pluginId={plugin.id}
              pluginName={plugin.name}
              schema={schema}
              values={values}
              onSave={async (v) => {
                await updateConfig.mutateAsync({ pluginId: plugin.id, values: v });
              }}
              isSaving={updateConfig.isPending}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Events Tab ──────────────────────────────────────────────────────────────

function EventsTab() {
  const { data, isLoading } = useStormEvents(100);
  return <EventLogViewer data={data} isLoading={isLoading} />;
}

// ── Shared components ───────────────────────────────────────────────────────

function StatCard({ label, value, color, icon: Icon }: { label: string; value: number; color: string; icon: React.ElementType }) {
  const colors: Record<string, string> = {
    storm: "bg-storm-50 text-storm-600",
    blue: "bg-blue-50 text-blue-600",
    amber: "bg-amber-50 text-amber-600",
    purple: "bg-purple-50 text-purple-600",
    green: "bg-green-50 text-green-600",
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
      <div className={clsx("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", colors[color])}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-xl font-bold text-gray-900">{value}</p>
        <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
      </div>
    </div>
  );
}

export default AdminPage;
