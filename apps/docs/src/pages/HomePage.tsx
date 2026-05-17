import { Link } from "wouter";
import { Zap, Package, Terminal, Layers, ArrowRight, Check } from "lucide-react";

const FEATURES = [
  { icon: Package, title: "Plugin Architecture", desc: "Assemble SaaS features from pre-built, composable plugins. Auth, CRM, Ticketing — pick what you need." },
  { icon: Terminal, title: "One Command Setup", desc: "npx create-storm-app generates a full-stack project with server, client, DB, and Docker in seconds." },
  { icon: Layers, title: "Full Stack TypeScript", desc: "Express 5 + React 18 + Drizzle ORM + PostgreSQL. Type-safe from database to UI." },
];

const PLUGINS = [
  { name: "@stormstack/auth", desc: "JWT + RBAC + multi-tenant", status: "stable" },
  { name: "@stormstack/auth-social", desc: "OAuth2 Google/GitHub/GitLab", status: "stable" },
  { name: "@stormstack/crm", desc: "Contacts, orgs, pipeline", status: "stable" },
  { name: "@stormstack/ticketing", desc: "Support tickets + helpdesk", status: "stable" },
  { name: "@stormstack/billing", desc: "Stripe subscriptions", status: "soon" },
  { name: "@stormstack/messaging", desc: "In-app IM + email", status: "soon" },
];

export function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-storm-50/50 to-white pointer-events-none" />
        <div className="relative max-w-4xl mx-auto px-6 pt-24 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-storm-50 text-storm-700 text-xs font-medium rounded-full mb-6">
            <Zap size={12} />
            v0.1.0 — Open Source
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight">
            Build SaaS apps from
            <span className="text-storm-600"> plugins</span>
          </h1>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
            Storm Stack is a plugin-based framework for full-stack SaaS applications.
            Pick your plugins, scaffold a project, ship in hours instead of months.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/docs">
              <a className="inline-flex items-center gap-2 px-5 py-2.5 bg-storm-600 text-white text-sm font-semibold rounded-lg hover:bg-storm-700 transition-colors shadow-sm">
                Get Started <ArrowRight size={14} />
              </a>
            </Link>
            <a
              href="https://github.com/stormeoio/storm-stack"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-gray-700 text-sm font-semibold rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              GitHub
            </a>
          </div>

          {/* Code snippet */}
          <div className="mt-12 max-w-lg mx-auto bg-storm-950 rounded-xl p-4 text-left shadow-2xl">
            <div className="flex items-center gap-1.5 mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
            </div>
            <pre className="text-sm font-mono leading-relaxed">
              <code>
                <span className="text-gray-500">$</span>{" "}
                <span className="text-green-400">npx</span>{" "}
                <span className="text-white">create-storm-app my-saas</span>
                {"\n\n"}
                <span className="text-gray-500">{">"}</span>{" "}
                <span className="text-blue-300">Plugins:</span>{" "}
                <span className="text-white">auth, crm, ticketing</span>
                {"\n"}
                <span className="text-gray-500">{">"}</span>{" "}
                <span className="text-blue-300">Frontend:</span>{" "}
                <span className="text-white">React + Tailwind</span>
                {"\n"}
                <span className="text-gray-500">{">"}</span>{" "}
                <span className="text-blue-300">Package manager:</span>{" "}
                <span className="text-white">npm</span>
                {"\n\n"}
                <span className="text-green-400">{"✓"}</span>{" "}
                <span className="text-white">Project generated</span>
              </code>
            </pre>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="p-6 rounded-xl border border-gray-100 hover:border-storm-200 hover:shadow-sm transition-all">
              <div className="w-10 h-10 rounded-lg bg-storm-50 flex items-center justify-center mb-4">
                <Icon size={18} className="text-storm-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">{title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Plugins */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">Official Plugins</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PLUGINS.map(({ name, desc, status }) => (
            <div key={name} className="flex items-center gap-3 p-4 rounded-lg border border-gray-100 hover:border-gray-200 transition-colors">
              {status === "stable" ? (
                <Check size={16} className="text-green-500 shrink-0" />
              ) : (
                <div className="w-4 h-4 rounded-full border-2 border-gray-200 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-mono font-medium text-gray-900 truncate">{name}</p>
                <p className="text-xs text-gray-500">{desc}</p>
              </div>
              {status === "soon" && (
                <span className="ml-auto text-[10px] font-medium text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full shrink-0">soon</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 mt-16">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between text-xs text-gray-500">
          <span>MIT License — Built by Stormeo</span>
          <a href="https://github.com/stormeoio/storm-stack" className="hover:text-gray-900 transition-colors">GitHub</a>
        </div>
      </footer>
    </>
  );
}
