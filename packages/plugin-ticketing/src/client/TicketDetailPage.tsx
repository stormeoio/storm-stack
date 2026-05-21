import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";

interface Ticket {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  createdAt: string;
}

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: ticket, isLoading } = useQuery({
    queryKey: ["ticketing", id],
    queryFn: async () => {
      const res = await fetch(`/api/ticketing/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Ticket not found");
      const data = await res.json() as { ticket: Ticket };
      return data.ticket;
    },
    enabled: !!id,
  });

  if (isLoading) return <div className="p-6 text-sm text-gray-400">Chargement...</div>;
  if (!ticket) return <div className="p-6 text-sm text-gray-500">Ticket introuvable.</div>;

  return (
    <div className="p-6 max-w-2xl">
      <a href="/support" className="text-sm text-storm-600 hover:text-storm-700 mb-4 inline-block">&larr; Retour</a>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">{ticket.title}</h1>
      <div className="bg-white border rounded-lg divide-y">
        <div className="px-4 py-3 flex justify-between">
          <span className="text-sm text-gray-500">Statut</span>
          <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{ticket.status}</span>
        </div>
        <div className="px-4 py-3 flex justify-between">
          <span className="text-sm text-gray-500">Priorité</span>
          <span className="text-sm font-medium">{ticket.priority}</span>
        </div>
        <div className="px-4 py-3 flex justify-between">
          <span className="text-sm text-gray-500">Créé le</span>
          <span className="text-sm">{new Date(ticket.createdAt).toLocaleDateString("fr-FR")}</span>
        </div>
        {ticket.description && (
          <div className="px-4 py-3">
            <span className="text-sm text-gray-500 block mb-1">Description</span>
            <p className="text-sm text-gray-700">{ticket.description}</p>
          </div>
        )}
      </div>
    </div>
  );
}
