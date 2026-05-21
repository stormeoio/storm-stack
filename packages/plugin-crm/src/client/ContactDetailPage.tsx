import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
}

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: contact, isLoading } = useQuery({
    queryKey: ["crm", "contacts", id],
    queryFn: async () => {
      const res = await fetch(`/api/crm/contacts/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Contact not found");
      const data = await res.json() as { contact: Contact };
      return data.contact;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-400">Chargement...</div>;
  }

  if (!contact) {
    return <div className="p-6 text-sm text-gray-500">Contact introuvable.</div>;
  }

  return (
    <div className="p-6 max-w-2xl">
      <a href="/crm" className="text-sm text-storm-600 hover:text-storm-700 mb-4 inline-block">&larr; Retour</a>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">
        {contact.firstName} {contact.lastName}
      </h1>
      <div className="bg-white border rounded-lg divide-y">
        <div className="px-4 py-3 flex justify-between">
          <span className="text-sm text-gray-500">Email</span>
          <span className="text-sm font-medium">{contact.email ?? "—"}</span>
        </div>
        <div className="px-4 py-3 flex justify-between">
          <span className="text-sm text-gray-500">Téléphone</span>
          <span className="text-sm font-medium">{contact.phone ?? "—"}</span>
        </div>
        <div className="px-4 py-3 flex justify-between">
          <span className="text-sm text-gray-500">Statut</span>
          <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{contact.status}</span>
        </div>
        <div className="px-4 py-3 flex justify-between">
          <span className="text-sm text-gray-500">Créé le</span>
          <span className="text-sm">{new Date(contact.createdAt).toLocaleDateString("fr-FR")}</span>
        </div>
      </div>
    </div>
  );
}
