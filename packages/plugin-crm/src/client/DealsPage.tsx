import { useQuery } from "@tanstack/react-query";

interface Deal {
  id: string;
  title: string;
  value: number;
  stage: string;
  createdAt: string;
}

export function DealsPage() {
  const { data: deals = [] } = useQuery({
    queryKey: ["crm", "deals"],
    queryFn: async () => {
      const res = await fetch("/api/crm/deals", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch deals");
      const data = await res.json() as { deals: Deal[] };
      return data.deals;
    },
  });

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Pipeline</h1>
      <div className="space-y-2">
        {deals.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Aucun deal</p>
        ) : deals.map((d) => (
          <div key={d.id} className="flex items-center justify-between p-4 bg-white border rounded-lg">
            <div>
              <p className="text-sm font-medium">{d.title}</p>
              <p className="text-xs text-gray-500">{d.stage} &middot; {new Date(d.createdAt).toLocaleDateString("fr-FR")}</p>
            </div>
            <span className="text-sm font-semibold text-gray-900">
              {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(d.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
