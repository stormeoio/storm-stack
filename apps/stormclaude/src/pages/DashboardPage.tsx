import { usePlugins, useManifest, useCurrentUser } from "@/lib/queries";
import { Zap, Route, Navigation, Puzzle } from "lucide-react";

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg bg-storm-50 flex items-center justify-center shrink-0">
        <Icon size={20} className="text-storm-600" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data: plugins = [], isLoading: loadingPlugins } = usePlugins();
  const { data: manifest } = useManifest();
  const { data: user } = useCurrentUser();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Zap size={20} className="text-storm-600" />
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        </div>
        <p className="text-sm text-gray-500">
          {user ? `Bonjour, ${user.name} · Rôle : ${user.role}` : "Chargement…"}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Plugins actifs" value={plugins.length} icon={Puzzle} />
        <Stat label="Routes nav" value={manifest?.navItems.length ?? 0} icon={Navigation} />
        <Stat label="Routes client" value={manifest?.routes.length ?? 0} icon={Route} />
        <Stat label="Panneaux settings" value={manifest?.settingsPanels.length ?? 0} icon={Zap} />
      </div>

      {/* Plugin list */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Plugins installés</h2>
        {loadingPlugins ? (
          <div className="text-sm text-gray-400">Chargement…</div>
        ) : plugins.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
            Aucun plugin installé. Lancez <code className="font-mono text-storm-600">create-storm-app</code> pour démarrer.
          </div>
        ) : (
          <div className="space-y-2">
            {plugins.map((p) => (
              <div key={p.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-900">{p.name}</span>
                  <span className="ml-2 text-xs text-gray-400">{p.id}</span>
                </div>
                <span className="text-xs text-gray-400 font-mono">v{p.version}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manifest routes preview */}
      {manifest && manifest.navItems.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Navigation générée</h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {manifest.navItems.map((item) => (
              <div key={item.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span className="text-gray-400 font-mono text-xs">{item.icon}</span>
                <span className="font-medium text-gray-800">{item.label}</span>
                <span className="ml-auto text-xs text-gray-400 font-mono">{item.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
