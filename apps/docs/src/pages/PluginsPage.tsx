import { Package, Check, Clock } from "lucide-react";

interface Plugin {
  name: string;
  pkg: string;
  description: string;
  features: string[];
  status: "stable" | "beta" | "planned";
  requires?: string[];
}

const PLUGINS: Plugin[] = [
  {
    name: "Auth",
    pkg: "@stormstack/auth",
    description: "Email/password authentication with JWT httpOnly cookies, RBAC roles, and multi-tenant workspaces.",
    features: ["Register/Login/Logout", "JWT httpOnly cookies", "Role-based access", "Multi-tenant (users → tenants → members)"],
    status: "stable",
  },
  {
    name: "Auth Social",
    pkg: "@stormstack/auth-social",
    description: "OAuth2 social login without passport — native fetch-based for Google, GitHub, and GitLab.",
    features: ["Google OAuth2", "GitHub OAuth", "GitLab OAuth", "CSRF state cookie protection"],
    status: "stable",
    requires: ["@stormstack/auth"],
  },
  {
    name: "CRM",
    pkg: "@stormstack/crm",
    description: "Customer relationship management — contacts, organisations, and deal pipeline.",
    features: ["Contacts CRUD", "Organizations CRUD", "Deal pipeline (6 stages)", "Contact status tracking"],
    status: "stable",
    requires: ["@stormstack/auth"],
  },
  {
    name: "Ticketing",
    pkg: "@stormstack/ticketing",
    description: "Support ticket system with internal comments, labels, and status filtering.",
    features: ["Tickets with priorities", "Comments (public + internal)", "Labels", "Status filtering"],
    status: "stable",
    requires: ["@stormstack/auth"],
  },
  {
    name: "Stripe",
    pkg: "@stormstack/stripe",
    description: "Stripe payments integration — webhooks, customers, and subscriptions.",
    features: ["Stripe API wrapper", "Webhook validation", "Customer management", "Subscription lifecycle"],
    status: "stable",
    requires: ["@stormstack/auth"],
  },
  {
    name: "Billing",
    pkg: "@stormstack/billing",
    description: "Invoicing, recurring billing, quotes, and credit notes.",
    features: ["Invoice generation", "Recurring billing", "Quotes", "Credit notes"],
    status: "planned",
    requires: ["@stormstack/auth"],
  },
  {
    name: "CMS",
    pkg: "@stormstack/cms",
    description: "Content management for pages, articles, and editorial workflows.",
    features: ["Pages", "Articles", "Draft publishing", "Content organization"],
    status: "planned",
    requires: ["@stormstack/auth"],
  },
  {
    name: "Messaging",
    pkg: "@stormstack/messaging",
    description: "In-app instant messaging and transactional email.",
    features: ["Real-time IM", "Conversations", "Transactional emails", "Notifications"],
    status: "planned",
    requires: ["@stormstack/auth"],
  },
  {
    name: "Drive",
    pkg: "@stormstack/drive",
    description: "File storage, document management, and SFTP.",
    features: ["File upload/download", "Folder management", "Versioning", "SFTP explorer"],
    status: "planned",
    requires: ["@stormstack/auth"],
  },
  {
    name: "Monitoring",
    pkg: "@stormstack/monitoring",
    description: "Uptime monitoring and infrastructure health checks.",
    features: ["HTTP probes", "Response time tracking", "Alerting", "Status pages"],
    status: "planned",
    requires: ["@stormstack/auth"],
  },
];

const STATUS_BADGE: Record<string, { icon: typeof Check; label: string; className: string }> = {
  stable: { icon: Check, label: "Stable", className: "bg-green-50 text-green-700" },
  beta: { icon: Clock, label: "Beta", className: "bg-yellow-50 text-yellow-700" },
  planned: { icon: Clock, label: "Planned", className: "bg-gray-100 text-gray-600" },
};

export function PluginsPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="text-center mb-12">
        <h1 className="text-2xl font-bold text-gray-900">Plugin Catalog</h1>
        <p className="mt-2 text-sm text-gray-600">Official plugins for Storm Stack applications</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PLUGINS.map((plugin) => {
          const badge = STATUS_BADGE[plugin.status];
          const BadgeIcon = badge.icon;
          return (
            <div key={plugin.pkg} className="p-5 rounded-xl border border-gray-100 hover:border-storm-200 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-storm-50 flex items-center justify-center">
                    <Package size={16} className="text-storm-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{plugin.name}</h3>
                    <code className="text-[11px] text-gray-500 font-mono">{plugin.pkg}</code>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full ${badge.className}`}>
                  <BadgeIcon size={10} />
                  {badge.label}
                </span>
              </div>
              <p className="text-xs text-gray-600 mb-3 leading-relaxed">{plugin.description}</p>
              <ul className="space-y-1">
                {plugin.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-1 h-1 rounded-full bg-gray-300" />
                    {f}
                  </li>
                ))}
              </ul>
              {plugin.requires && (
                <div className="mt-3 pt-3 border-t border-gray-50">
                  <span className="text-[10px] text-gray-400">Requires: {plugin.requires.join(", ")}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
