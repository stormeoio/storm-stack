import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Plus, Trash2, User } from "lucide-react";

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
}

export function ContactsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["crm", "contacts"],
    queryFn: () => api.get<{ contacts: Contact[] }>("/crm/contacts").then((r) => r.contacts),
  });

  const create = useMutation({
    mutationFn: (data: typeof form) => api.post("/crm/contacts", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm", "contacts"] });
      setShowForm(false);
      setForm({ firstName: "", lastName: "", email: "", phone: "" });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/crm/contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "contacts"] }),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Contacts</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-3 py-2 bg-storm-600 text-white text-sm font-medium rounded-lg hover:bg-storm-700 transition-colors"
        >
          <Plus size={14} />
          Nouveau contact
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); create.mutate(form); }}
          className="mb-6 p-4 bg-white border border-gray-200 rounded-lg grid grid-cols-2 gap-3"
        >
          <input placeholder="Prénom" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-md text-sm" required />
          <input placeholder="Nom" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-md text-sm" required />
          <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-md text-sm" />
          <input placeholder="Téléphone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-md text-sm" />
          <div className="col-span-2 flex gap-2">
            <button type="submit" disabled={create.isPending} className="px-4 py-2 bg-storm-600 text-white text-sm rounded-md hover:bg-storm-700 disabled:opacity-50">
              {create.isPending ? "Création…" : "Créer"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-gray-600 text-sm rounded-md hover:bg-gray-100">Annuler</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : contacts.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <User size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">Aucun contact</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Nom</th>
                <th className="px-4 py-2.5 text-left font-medium">Email</th>
                <th className="px-4 py-2.5 text-left font-medium">Téléphone</th>
                <th className="px-4 py-2.5 text-left font-medium">Statut</th>
                <th className="px-4 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contacts.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{c.firstName} {c.lastName}</td>
                  <td className="px-4 py-2.5 text-gray-600">{c.email ?? "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600">{c.phone ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 text-xs font-medium bg-storm-50 text-storm-700 rounded-full">{c.status}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => remove.mutate(c.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ContactsPage;
