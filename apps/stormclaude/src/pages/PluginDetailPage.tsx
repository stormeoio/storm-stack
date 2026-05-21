import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { api } from "@/lib/api";
import {
  ArrowLeft, Check, Clock, Terminal, AlertTriangle, Tag,
  Copy, Shield, Briefcase, CreditCard, FileText, MessageCircle,
  HardDrive, Activity, Palette, Plug, Lock,
} from "lucide-react";
import { clsx } from "clsx";
import { useState } from "react";

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
  devops: { label: "DevOps", icon: Activity, color: "text-cyan-600 bg-cyan-50" },
  ui: { label: "UI", icon: Palette, color: "text-pink-600 bg-pink-50" },
};

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      {label && <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5 font-medium">{label}</p>}
      <div className="bg-gray-900 rounded-lg px-4 py-3 font-mono text-sm text-gray-100 flex items-center justify-between gap-3">
        <code className="overflow-x-auto">{code}</code>
        <button
          onClick={handleCopy}
          className="shrink-0 text-gray-400 hover:text-white transition-colors"
          title="Copier"
        >
          {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

export function PluginDetailPage() {
  const params = useParams<{ pluginId: string }>();
  const pluginId = params.pluginId;

  const { data, isLoading } = useQuery({
    queryKey: ["storm", "catalog"],
    queryFn: () => api.get<{ catalog: CatalogEntry[] }>("/storm/catalog"),
  });

  const plugin = data?.catalog.find((e) => e.shortName === pluginId);

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-400">Chargement...</div>;
  }

  if (!plugin) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link href="/catalog"><a className="text-sm text-storm-600 hover:underline flex items-center gap-1"><ArrowLeft size={14} /> Retour au catalogue</a></Link>
        <div className="mt-8 text-center text-gray-400">Plugin introuvable.</div>
      </div>
    );
  }

  const catMeta = CATEGORY_META[plugin.category];
  const CatIcon = catMeta?.icon ?? Plug;
  const envEntries = Object.entries(plugin.envVars);
  const requiredEnv = envEntries.filter(([, v]) => v.required);
  const optionalEnv = envEntries.filter(([, v]) => !v.required);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Back */}
      <Link href="/catalog">
        <a className="text-sm text-storm-600 hover:underline flex items-center gap-1 mb-6">
          <ArrowLeft size={14} /> Catalogue
        </a>
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4 mb-8">
        <div className={clsx("w-14 h-14 rounded-2xl flex items-center justify-center shrink-0", catMeta?.color ?? "bg-gray-50 text-gray-600")}>
          <CatIcon size={28} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{plugin.name}</h1>
            {plugin.status === "installed" && (
              <span className="flex items-center gap-1 text-xs font-semibold bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">
                <Check size={10} /> Installé
              </span>
            )}
            {plugin.status === "coming-soon" && (
              <span className="flex items-center gap-1 text-xs font-semibold bg-gray-50 text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full">
                <Clock size={10} /> Bientôt
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">{plugin.description}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-gray-400 font-mono">{plugin.id}</span>
            <span className="text-xs text-gray-400">v{plugin.version}</span>
            <span className={clsx("text-xs font-medium px-1.5 py-0.5 rounded capitalize", catMeta?.color ?? "bg-gray-50 text-gray-600")}>
              {catMeta?.label ?? plugin.category}
            </span>
          </div>
        </div>
      </div>

      {/* Install commands */}
      {plugin.status !== "coming-soon" && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Terminal size={16} className="text-storm-600" />
            <h2 className="text-sm font-bold text-gray-900">Installation</h2>
          </div>

          <div className="space-y-3">
            <CodeBlock
              label="npm (package)"
              code={`npx @stormstack/cli add ${plugin.shortName}`}
            />
            <CodeBlock
              label="copy (code source)"
              code={`npx @stormstack/cli add ${plugin.shortName} --copy`}
            />
          </div>

          {plugin.status === "installed" && (
            <div className="mt-4 flex items-center gap-2 text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2">
              <Check size={12} />
              Ce plugin est installé et actif sur ce serveur.
            </div>
          )}
        </div>
      )}

      {/* Dependencies */}
      {plugin.requires.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Lock size={16} className="text-gray-600" />
            <h2 className="text-sm font-bold text-gray-900">Dépendances</h2>
          </div>
          <div className="space-y-2">
            {plugin.requires.map((dep) => {
              const depEntry = data?.catalog.find((e) => e.id === dep);
              const isInstalled = depEntry?.status === "installed";
              return (
                <div key={dep} className="flex items-center gap-2 text-sm">
                  {isInstalled ? (
                    <Check size={12} className="text-green-500" />
                  ) : (
                    <AlertTriangle size={12} className="text-amber-500" />
                  )}
                  <Link href={`/catalog/${dep.replace("@stormstack/", "")}`}>
                    <a className="font-mono text-xs text-storm-600 hover:underline">{dep}</a>
                  </Link>
                  <span className="text-xs text-gray-400">
                    {isInstalled ? "installé" : "requis"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Environment variables */}
      {envEntries.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-amber-600" />
            <h2 className="text-sm font-bold text-gray-900">Variables d'environnement</h2>
          </div>

          {requiredEnv.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] text-red-500 uppercase tracking-wider font-medium mb-2">Requises</p>
              <div className="space-y-2">
                {requiredEnv.map(([key, meta]) => (
                  <div key={key} className="bg-red-50/50 rounded-lg px-3 py-2 border border-red-100">
                    <code className="text-xs font-bold text-red-700">{key}</code>
                    <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
                    {meta.example && <p className="text-[10px] text-gray-400 font-mono mt-0.5">ex: {meta.example}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {optionalEnv.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-2">Optionnelles</p>
              <div className="space-y-2">
                {optionalEnv.map(([key, meta]) => (
                  <div key={key} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <code className="text-xs font-medium text-gray-700">{key}</code>
                    <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5">
        {plugin.tags.map((tag) => (
          <span key={tag} className="flex items-center gap-1 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg px-2.5 py-1">
            <Tag size={10} />
            {tag}
          </span>
        ))}
      </div>

      {/* Coming soon banner */}
      {plugin.status === "coming-soon" && (
        <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-6 text-center">
          <Clock size={24} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-500">Ce plugin n'est pas encore disponible.</p>
          <p className="text-xs text-gray-400 mt-1">En cours de développement — restez connecté.</p>
        </div>
      )}
    </div>
  );
}
