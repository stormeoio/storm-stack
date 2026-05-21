import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  status: string;
}

export function CrmPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "" });
  const [showForm, setShowForm] = useState(false);

  const { data: contacts = [] } = useQuery({
    queryKey: ["crm", "contacts"],
    queryFn: async () => {
      const res = await fetch("/api/crm/contacts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      const data = await res.json() as { contacts: Contact[] };
      return data.contacts;
    },
  });

  const create = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch("/api/crm/contacts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create contact");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm", "contacts"] });
      setShowForm(false);
      setForm({ firstName: "", lastName: "", email: "" });
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Contacts</h1>
        <button onClick={() => setShowForm(!showForm)} className="px-3 py-2 bg-storm-600 text-white text-sm rounded-lg hover:bg-storm-700">
          + Nouveau
        </button>
      </div>
      {showForm && (
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(form); }} className="mb-4 p-4 bg-white border rounded-lg grid grid-cols-3 gap-3">
          <input placeholder="Prénom" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="px-3 py-2 border rounded-md text-sm" required />
          <input placeholder="Nom" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="px-3 py-2 border rounded-md text-sm" required />
          <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="px-3 py-2 border rounded-md text-sm" />
          <button type="submit" className="px-4 py-2 bg-storm-600 text-white text-sm rounded-md">Créer</button>
        </form>
      )}
      <div className="bg-white border rounded-lg divide-y">
        {contacts.length === 0 ? (
          <p className="p-4 text-sm text-gray-400 text-center">Aucun contact</p>
        ) : contacts.map((c) => (
          <a key={c.id} href={`/crm/contacts/${c.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
            <span className="text-sm font-medium">{c.firstName} {c.lastName}</span>
            <span className="text-xs text-gray-500">{c.email ?? "—"}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
