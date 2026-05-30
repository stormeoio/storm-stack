import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/api";
import {
  Store, Search, Check, Clock, ArrowRight, Shield, Briefcase,
  CreditCard, FileText, MessageCircle,
  Palette, Terminal, Plug, Lock, LayoutGrid, Tag,
} from "lucide-react";
import { clsx } from "clsx";

interface CatalogEntry {
  id: string;
  shortName: string;
  name: string;
  description: string;
  tags: string[];
  pricing: "free" | "premium" | "enterprise";
  requires: string[];
  envVars: Record<string, { description: string; required: boolean; example?: string }>;
  status: "installed" | "available" | "coming-soon";
  version: string;
  category: string;
}

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  security: { label: "Security", icon: Shield, color: "text-red-600 bg-red-50" },
  business: { label: "Business", icon: Briefcase, color: "text-blue-600 bg-blue-50" },
  payments: { label: "Payments", icon: CreditCard, color: "text-green-600 bg-green-50" },
  content: { label: "Content", icon: FileText, color: "text-amber-600 bg-amber-50" },
  communication: { label: "Communication", icon: MessageCircle, color: "text-purple-600 bg-purple-50" },
  devops: { label: "DevOps", icon: Terminal, color: "text-cyan-600 bg-cyan-50" },
  ui: { label: "UI", icon: Palette, color: "text-pink-600 bg-pink-50" },
};

const STATUS_CONFIG = {
  installed: { label: "Installé", class: "bg-green-50 text-green-700 border-green-200", icon: Check },
  available: { label: "Disponible", class: "bg-storm-50 text-storm-700 border-storm-200", icon: ArrowRight },
  "coming-soon": { label: "Bientôt", class: "bg-gray-50 text-gray-500 border-gray-200", icon: Clock },
};

function useCatalog() {
  return useQuery({
    queryKey: ["storm", "catalog"],
    queryFn: () => api.get<{ catalog: CatalogEntry[]; categories: string[] }>("/storm/catalog"),
  });
}

function CatalogCard({ entry }: { entry: CatalogEntry }) {
  const status = STATUS_CONFIG[entry.status];
  const StatusIcon = status.icon;
  const catMeta = CATEGORY_META[entry.category];
  const CatIcon = catMeta?.icon ?? Plug;
  const isAvailable = entry.status !== "coming-soon";

  const inner = (
    <div className={clsx(
      "rounded-xl border p-5 flex flex-col gap-3 transition-all h-full",
      isAvailable
        ? "bg-white border-gray-200 hover:border-storm-300 hover:shadow-md cursor-pointer"
        : "bg-gray-50/50 border-gray-100 opacity-70",
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", catMeta?.color ?? "bg-gray-50 text-gray-600")}>
          <CatIcon size={20} />
        </div>
        <div className={clsx("flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border", status.class)}>
          <StatusIcon size={10} />
          {status.label}
        </div>
      </div>

      {/* Name + Description */}
      <div className="flex-1">
        <p className="text-sm font-bold text-gray-900">{entry.name}</p>
        <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{entry.description}</p>
      </div>

      {/* Dependencies */}
      {entry.requires.length > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
          <Lock size={9} />
          Requiert {entry.requires.map((r) => r.replace("@stormstack/", "")).join(", ")}
        </div>
      )}

      {/* Tags */}
      <div className="flex flex-wrap gap-1">
        {entry.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="flex items-center gap-0.5 text-[10px] text-gray-500 bg-gray-100 rounded-md px-1.5 py-0.5">
            <Tag size={8} />
            {tag}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <span className="text-[10px] text-gray-400 font-mono">{entry.id}</span>
        <span className="text-[10px] text-gray-400">v{entry.version}</span>
      </div>
    </div>
  );

  if (!isAvailable) return inner;

  return (
    <Link href={`/catalog/${entry.shortName}`}>
      <a className="block h-full">{inner}</a>
    </Link>
  );
}

export function CatalogPage() {
  const { data, isLoading } = useCatalog();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const catalog = data?.catalog ?? [];
  const categories = data?.categories ?? [];

  const filtered = useMemo(() => {
    let results = catalog;
    if (search) {
      const q = search.toLowerCase();
      results = results.filter((e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.tags.some((t) => t.includes(q)) ||
        e.id.includes(q)
      );
    }
    if (activeCategory) {
      results = results.filter((e) => e.category === activeCategory);
    }
    if (statusFilter) {
      results = results.filter((e) => e.status === statusFilter);
    }
    return results;
  }, [catalog, search, activeCategory, statusFilter]);

  const counts = useMemo(() => ({
    installed: catalog.filter((e) => e.status === "installed").length,
    available: catalog.filter((e) => e.status === "available").length,
    comingSoon: catalog.filter((e) => e.status === "coming-soon").length,
    total: catalog.length,
  }), [catalog]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Store size={22} className="text-storm-600" />
          <h1 className="text-xl font-bold text-gray-900">Storm Catalog</h1>
          <span className="text-xs font-medium bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
            {counts.total} plugins
          </span>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <button
          onClick={() => setStatusFilter(statusFilter === "installed" ? null : "installed")}
          className={clsx("rounded-xl border p-3 text-left transition-colors", statusFilter === "installed" ? "bg-green-50 border-green-200" : "bg-white border-gray-200 hover:border-green-200")}
        >
          <p className="text-lg font-bold text-green-700">{counts.installed}</p>
          <p className="text-[10px] text-green-600 uppercase tracking-wide font-medium">Installés</p>
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === "available" ? null : "available")}
          className={clsx("rounded-xl border p-3 text-left transition-colors", statusFilter === "available" ? "bg-storm-50 border-storm-200" : "bg-white border-gray-200 hover:border-storm-200")}
        >
          <p className="text-lg font-bold text-storm-700">{counts.available}</p>
          <p className="text-[10px] text-storm-600 uppercase tracking-wide font-medium">Disponibles</p>
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === "coming-soon" ? null : "coming-soon")}
          className={clsx("rounded-xl border p-3 text-left transition-colors", statusFilter === "coming-soon" ? "bg-gray-100 border-gray-300" : "bg-white border-gray-200 hover:border-gray-300")}
        >
          <p className="text-lg font-bold text-gray-500">{counts.comingSoon}</p>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Bientôt</p>
        </button>
      </div>

      {/* Search + Category filter */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher un plugin..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-storm-500/20 focus:border-storm-300"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveCategory(null)}
            className={clsx(
              "px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
              !activeCategory ? "bg-storm-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200",
            )}
          >
            <LayoutGrid size={12} className="inline mr-1" />
            Tous
          </button>
          {categories.map((cat) => {
            const meta = CATEGORY_META[cat];
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                className={clsx(
                  "px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize",
                  activeCategory === cat ? "bg-storm-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                )}
              >
                {meta?.label ?? cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="text-sm text-gray-400 text-center py-12">Chargement du catalogue...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <Search size={28} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Aucun plugin ne correspond.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((entry) => (
            <CatalogCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

export default CatalogPage;
