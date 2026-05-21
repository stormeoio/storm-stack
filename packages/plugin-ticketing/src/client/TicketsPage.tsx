import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

interface Ticket {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
}

export function TicketsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", priority: "medium" });
  const [showForm, setShowForm] = useState(false);

  const { data: tickets = [] } = useQuery({
    queryKey: ["ticketing"],
    queryFn: async () => {
      const res = await fetch("/api/ticketing", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tickets");
      const data = await res.json() as { tickets: Ticket[] };
      return data.tickets;
    },
  });

  const create = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch("/api/ticketing", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create ticket");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticketing"] });
      setShowForm(false);
      setForm({ title: "", priority: "medium" });
    },
  });

  const statusColor: Record<string, string> = {
    open: "bg-blue-50 text-blue-700",
    in_progress: "bg-yellow-50 text-yellow-700",
    resolved: "bg-green-50 text-green-700",
    closed: "bg-gray-100 text-gray-600",
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Tickets</h1>
        <button onClick={() => setShowForm(!showForm)} className="px-3 py-2 bg-storm-600 text-white text-sm rounded-lg hover:bg-storm-700">
          + Nouveau
        </button>
      </div>
      {showForm && (
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(form); }} className="mb-4 p-4 bg-white border rounded-lg flex gap-3">
          <input placeholder="Titre" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="flex-1 px-3 py-2 border rounded-md text-sm" required />
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="px-3 py-2 border rounded-md text-sm">
            <option value="low">Basse</option>
            <option value="medium">Moyenne</option>
            <option value="high">Haute</option>
            <option value="urgent">Urgente</option>
          </select>
          <button type="submit" className="px-4 py-2 bg-storm-600 text-white text-sm rounded-md">Créer</button>
        </form>
      )}
      <div className="space-y-2">
        {tickets.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Aucun ticket</p>
        ) : tickets.map((t) => (
          <a key={t.id} href={`/support/${t.id}`} className="flex items-center justify-between p-4 bg-white border rounded-lg hover:bg-gray-50 transition-colors">
            <div>
              <p className="text-sm font-medium">{t.title}</p>
              <p className="text-xs text-gray-500">{t.priority} &middot; {new Date(t.createdAt).toLocaleDateString("fr-FR")}</p>
            </div>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColor[t.status] ?? "bg-gray-100 text-gray-600"}`}>
              {t.status}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
