import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Plus, DollarSign } from "lucide-react";

interface Deal {
  id: string;
  title: string;
  stage: string;
  value: string | null;
  currency: string;
  createdAt: string;
}

const STAGES = ["new", "qualified", "proposal", "negotiation", "won", "lost"] as const;
const STAGE_COLORS: Record<string, string> = {
  new: "bg-blue-50 text-blue-700",
  qualified: "bg-purple-50 text-purple-700",
  proposal: "bg-yellow-50 text-yellow-700",
  negotiation: "bg-orange-50 text-orange-700",
  won: "bg-green-50 text-green-700",
  lost: "bg-red-50 text-red-700",
};

export function DealsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", stage: "new", value: "" });

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ["crm", "deals"],
    queryFn: () => api.get<{ deals: Deal[] }>("/crm/deals").then((r) => r.deals),
  });

  const create = useMutation({
    mutationFn: (data: typeof form) => api.post("/crm/deals", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm", "deals"] });
      setShowForm(false);
      setForm({ title: "", stage: "new", value: "" });
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Pipeline</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-3 py-2 bg-storm-600 text-white text-sm font-medium rounded-lg hover:bg-storm-700 transition-colors"
        >
          <Plus size={14} />
          Nouveau deal
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); create.mutate(form); }}
          className="mb-6 p-4 bg-white border border-gray-200 rounded-lg grid grid-cols-3 gap-3"
        >
          <input placeholder="Titre du deal" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-md text-sm" required />
          <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-md text-sm">
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input placeholder="Valeur (€)" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-md text-sm" />
          <div className="col-span-3 flex gap-2">
            <button type="submit" disabled={create.isPending} className="px-4 py-2 bg-storm-600 text-white text-sm rounded-md hover:bg-storm-700 disabled:opacity-50">Créer</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-gray-600 text-sm rounded-md hover:bg-gray-100">Annuler</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : deals.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <DollarSign size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">Aucun deal</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {deals.map((d) => (
            <div key={d.id} className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">{d.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{d.value ? `${d.value} ${d.currency}` : "Pas de montant"}</p>
              </div>
              <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${STAGE_COLORS[d.stage] ?? "bg-gray-50 text-gray-700"}`}>
                {d.stage}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
