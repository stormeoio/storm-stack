import { Puzzle, Tag } from "lucide-react";
import { clsx } from "clsx";
import type { StormPlugin } from "@/lib/queries";

const PRICING_BADGE: Record<string, string> = {
  free: "bg-green-50 text-green-700",
  premium: "bg-amber-50 text-amber-700",
  enterprise: "bg-purple-50 text-purple-700",
};

interface Props {
  plugin: StormPlugin;
  active?: boolean;
}

export function PluginCard({ plugin, active = true }: Props) {
  return (
    <div className={clsx(
      "rounded-xl border p-4 flex flex-col gap-3 transition-shadow hover:shadow-sm",
      active ? "bg-white border-gray-200" : "bg-gray-50 border-gray-200 opacity-60"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="w-9 h-9 rounded-lg bg-storm-50 flex items-center justify-center shrink-0">
          <Puzzle size={18} className="text-storm-600" />
        </div>
        <span className={clsx("text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide", PRICING_BADGE[plugin.pricing] ?? PRICING_BADGE["free"])}>
          {plugin.pricing}
        </span>
      </div>

      <div>
        <p className="text-sm font-semibold text-gray-900">{plugin.name}</p>
        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{plugin.description}</p>
      </div>

      <div className="flex flex-wrap gap-1 mt-auto">
        {plugin.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
            <Tag size={9} />
            {tag}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-gray-100">
        <span className="text-[10px] text-gray-400 font-mono">{plugin.id}</span>
        <span className="text-[10px] text-gray-400">v{plugin.version}</span>
      </div>
    </div>
  );
}
