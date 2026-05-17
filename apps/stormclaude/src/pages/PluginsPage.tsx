import { usePlugins } from "@/lib/queries";
import { PluginCard } from "@/components/PluginCard";
import { Puzzle } from "lucide-react";

export function PluginsPage() {
  const { data: plugins = [], isLoading } = usePlugins();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Puzzle size={20} className="text-storm-600" />
        <h1 className="text-xl font-bold text-gray-900">Plugins</h1>
        <span className="ml-2 text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
          {plugins.length} installé{plugins.length > 1 ? "s" : ""}
        </span>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-400">Chargement…</div>
      ) : plugins.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <Puzzle size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">Aucun plugin installé</p>
          <p className="text-xs text-gray-400 mt-1">
            Utilisez <code className="font-mono">registry.register(plugin)</code> dans votre serveur Express.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plugins.map((p) => (
            <PluginCard key={p.id} plugin={p} />
          ))}
        </div>
      )}
    </div>
  );
}
