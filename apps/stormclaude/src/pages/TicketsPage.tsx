import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Plus, Ticket } from "lucide-react";

interface TicketItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  in_progress: "bg-yellow-50 text-yellow-700",
  waiting: "bg-orange-50 text-orange-700",
  resolved: "bg-green-50 text-green-700",
  closed: "bg-gray-100 text-gray-600",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "text-gray-500",
  medium: "text-blue-600",
  high: "text-orange-600",
  urgent: "text-red-600",
};

export function TicketsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", priority: "medium" });
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["ticketing", "tickets", statusFilter],
    queryFn: () => {
      const params = statusFilter ? `?status=${statusFilter}` : "";
      return api.get<{ tickets: TicketItem[] }>(`/ticketing${params}`).then((r) => r.tickets);
    },
  });

  const create = useMutation({
    mutationFn: (data: typeof form) => api.post("/ticketing", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticketing"] });
      setShowForm(false);
      setForm({ title: "", description: "", priority: "medium" });
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Tickets</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-3 py-2 bg-storm-600 text-white text-sm font-medium rounded-lg hover:bg-storm-700 transition-colors"
        >
          <Plus size={14} />
          Nouveau ticket
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {["", "open", "in_progress", "waiting", "resolved", "closed"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${statusFilter === s ? "bg-storm-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            {s || "Tous"}
          </button>
        ))}
      </div>

      {showForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); create.mutate(form); }}
          className="mb-6 p-4 bg-white border border-gray-200 rounded-lg space-y-3"
        >
          <input placeholder="Titre du ticket" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" required />
          <textarea placeholder="Description (optionnel)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" rows={3} />
          <div className="flex gap-3 items-center">
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-md text-sm">
              <option value="low">Basse</option>
              <option value="medium">Moyenne</option>
              <option value="high">Haute</option>
              <option value="urgent">Urgente</option>
            </select>
            <button type="submit" disabled={create.isPending} className="px-4 py-2 bg-storm-600 text-white text-sm rounded-md hover:bg-storm-700 disabled:opacity-50">Créer</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-gray-600 text-sm rounded-md hover:bg-gray-100">Annuler</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : tickets.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Ticket size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">Aucun ticket</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => (
            <div key={t.id} className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{t.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  <span className={PRIORITY_COLORS[t.priority] ?? ""}>
                    {t.priority}
                  </span>
                  {" · "}
                  {new Date(t.createdAt).toLocaleDateString("fr-FR")}
                </p>
              </div>
              <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[t.status] ?? "bg-gray-100 text-gray-700"}`}>
                {t.status.replace("_", " ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
