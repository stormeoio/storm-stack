import { Link } from "wouter";
import { Zap, Package, Terminal, Layers, ArrowRight, Check, Copy, Store, Code, Plug, Shield, Briefcase, CreditCard, FileText, Palette } from "lucide-react";
import { useState } from "react";

const FEATURES = [
  { icon: Package, title: "Plugin Architecture", desc: "Assemble SaaS features from pre-built, composable plugins. Auth, CRM, Ticketing, Stripe — pick what you need." },
  { icon: Terminal, title: "storm add — shadcn for SaaS", desc: "Add plugins with one command. Copy source code into your project or install as npm packages. You own the code." },
  { icon: Layers, title: "Full Stack TypeScript", desc: "Express 5 + React 18 + Drizzle ORM + PostgreSQL. Type-safe from database to UI, zero config." },
  { icon: Store, title: "Storm Catalog", desc: "Browse 16+ plugins across security, business, payments, content. Install what you need, skip what you don't." },
];

const STEPS = [
  { num: "1", title: "Scaffold", code: "npx create-storm-app my-saas", desc: "Full-stack project with server, client, Docker — 30 seconds." },
  { num: "2", title: "Add plugins", code: "storm add auth crm ticketing", desc: "Auto-wires imports, routes, schema, dependencies." },
  { num: "3", title: "Ship", code: "npm run dev", desc: "Login page, CRM, ticketing — all working. Build your product, not infrastructure." },
];

const PLUGINS_STABLE = [
  { name: "auth", pkg: "@stormstack/auth", desc: "JWT + RBAC + multi-tenant", icon: Shield, color: "text-red-600 bg-red-50" },
  { name: "auth-social", pkg: "@stormstack/auth-social", desc: "OAuth2 Google/GitHub/GitLab", icon: Shield, color: "text-red-600 bg-red-50" },
  { name: "crm", pkg: "@stormstack/crm", desc: "Contacts, orgs, pipeline", icon: Briefcase, color: "text-blue-600 bg-blue-50" },
  { name: "ticketing", pkg: "@stormstack/ticketing", desc: "Support tickets + helpdesk", icon: Briefcase, color: "text-blue-600 bg-blue-50" },
  { name: "stripe", pkg: "@stormstack/stripe", desc: "Payments + webhooks", icon: CreditCard, color: "text-green-600 bg-green-50" },
];

const PLUGINS_SOON = [
  { name: "billing", desc: "Invoicing + recurring" },
  { name: "cms", desc: "Content management" },
  { name: "messaging", desc: "IM + email" },
  { name: "drive", desc: "File storage" },
  { name: "monitoring", desc: "Uptime + alerts" },
  { name: "rgpd", desc: "GDPR compliance" },
  { name: "search", desc: "Full-text search" },
  { name: "vault", desc: "Encrypted secrets" },
  { name: "design", desc: "Theme + UI tokens" },
  { name: "integrations", desc: "Webhooks + API" },
  { name: "dock", desc: "macOS-style dock" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="shrink-0 text-gray-500 hover:text-white transition-colors"
    >
      {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
    </button>
  );
}

function TerminalBlock({ children, copyText }: { children: React.ReactNode; copyText?: string }) {
  return (
    <div className="bg-storm-950 rounded-xl p-4 text-left shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        </div>
        {copyText && <CopyButton text={copyText} />}
      </div>
      <pre className="text-sm font-mono leading-relaxed overflow-x-auto">{children}</pre>
    </div>
  );
}

export function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-storm-50/50 to-white pointer-events-none" />
        <div className="relative max-w-4xl mx-auto px-6 pt-24 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-storm-50 text-storm-700 text-xs font-medium rounded-full mb-6">
            <Zap size={12} />
            v0.1.0 — Open Source MIT
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight">
            Build SaaS apps from
            <span className="text-storm-600"> plugins</span>
          </h1>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
            Storm Stack is a plugin framework for full-stack TypeScript SaaS.
            Add features with <code className="font-mono text-storm-600 bg-storm-50 px-1.5 py-0.5 rounded text-sm">storm add</code> — like shadcn, but for your entire backend.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/docs">
              <a className="inline-flex items-center gap-2 px-5 py-2.5 bg-storm-600 text-white text-sm font-semibold rounded-lg hover:bg-storm-700 transition-colors shadow-sm">
                Get Started <ArrowRight size={14} />
              </a>
            </Link>
            <Link href="/plugins">
              <a className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-gray-700 text-sm font-semibold rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                <Store size={14} /> Browse Catalog
              </a>
            </Link>
          </div>

          {/* Terminal demo */}
          <div className="mt-12 max-w-lg mx-auto">
            <TerminalBlock copyText="npx create-storm-app my-saas && cd my-saas && storm add auth crm ticketing">
              <code>
                <span className="text-gray-500">$</span>{" "}
                <span className="text-green-400">npx</span>{" "}
                <span className="text-white">create-storm-app my-saas</span>
                {"\n"}
                <span className="text-green-400">{"  ✓"}</span>{" "}
                <span className="text-gray-300">Project generated</span>
                {"\n\n"}
                <span className="text-gray-500">$</span>{" "}
                <span className="text-green-400">storm</span>{" "}
                <span className="text-white">add auth crm ticketing --copy</span>
                {"\n"}
                <span className="text-green-400">{"  ✓"}</span>{" "}
                <span className="text-gray-300">auth installed</span>
                {"\n"}
                <span className="text-green-400">{"  ✓"}</span>{" "}
                <span className="text-gray-300">crm installed</span>
                {"\n"}
                <span className="text-green-400">{"  ✓"}</span>{" "}
                <span className="text-gray-300">ticketing installed</span>
                {"\n\n"}
                <span className="text-gray-500">$</span>{" "}
                <span className="text-green-400">npm run</span>{" "}
                <span className="text-white">dev</span>
                {"\n"}
                <span className="text-blue-300">{"  [storm-stack]"}</span>{" "}
                <span className="text-gray-300">3 plugin(s) bootstrapped</span>
                {"\n"}
                <span className="text-blue-300">{"  [storm-stack]"}</span>{" "}
                <span className="text-white">http://localhost:3000</span>
              </code>
            </TerminalBlock>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">Three commands to production</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {STEPS.map(({ num, title, code, desc }) => (
            <div key={num} className="relative">
              <div className="w-8 h-8 rounded-full bg-storm-600 text-white flex items-center justify-center text-sm font-bold mb-4">{num}</div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">{title}</h3>
              <code className="text-xs font-mono text-storm-600 bg-storm-50 px-2 py-0.5 rounded">{code}</code>
              <p className="text-sm text-gray-600 mt-2 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-16 border-t border-gray-100">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

      {/* Plugin anatomy */}
      <section className="max-w-4xl mx-auto px-6 py-16 border-t border-gray-100">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Anatomy of a plugin</h2>
            <p className="text-sm text-gray-600 mb-4 leading-relaxed">
              Each plugin is a self-contained module with schema, routes, client manifest, and lifecycle hooks.
              Install as npm package or copy the source into your project.
            </p>
            <ul className="space-y-2">
              {["Schema — Drizzle tables and enums", "Routes — Express router factory", "Client — nav items, dock, routes, settings", "Lifecycle — onBoot, onInstall, onUninstall", "Config — Zod schema for settings UI"].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-gray-600">
                  <Check size={14} className="text-storm-600 shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <TerminalBlock>
            <code className="text-xs">
              <span className="text-gray-500">{"// plugins/crm/index.ts"}</span>{"\n"}
              <span className="text-purple-400">export const</span>{" "}
              <span className="text-blue-300">crmPlugin</span>
              <span className="text-white">{": StormPlugin = {"}</span>{"\n"}
              <span className="text-white">{"  id: "}</span>
              <span className="text-green-300">{'"@stormstack/crm"'}</span>
              <span className="text-white">,</span>{"\n"}
              <span className="text-white">{"  schema: { tables: { contacts, deals } },"}</span>{"\n"}
              <span className="text-white">{"  routes: ({ ctx, isAuthenticated }) =>"}</span>{"\n"}
              <span className="text-white">{"    createCrmRoutes(ctx, isAuthenticated),"}</span>{"\n"}
              <span className="text-white">{"  client: {"}</span>{"\n"}
              <span className="text-white">{"    navItems: [{ id: "}</span>
              <span className="text-green-300">{'"crm"'}</span>
              <span className="text-white">{", ... }],"}</span>{"\n"}
              <span className="text-white">{"  },"}</span>{"\n"}
              <span className="text-white">{"}"}</span>
            </code>
          </TerminalBlock>
        </div>
      </section>

      {/* Plugins showcase */}
      <section className="max-w-5xl mx-auto px-6 py-16 border-t border-gray-100">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Official Plugins</h2>
        <p className="text-sm text-gray-500 text-center mb-8">5 stable + 11 coming soon</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {PLUGINS_STABLE.map(({ name, pkg, desc, icon: Icon, color }) => (
            <div key={pkg} className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 bg-white hover:border-storm-200 hover:shadow-sm transition-all">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                <Icon size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-900">{name}</p>
                  <span className="text-[9px] font-semibold bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">STABLE</span>
                </div>
                <p className="text-xs text-gray-500">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 justify-center">
          {PLUGINS_SOON.map(({ name, desc }) => (
            <span key={name} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-100 text-xs text-gray-500">
              <Plug size={10} className="text-gray-400" />
              {name}
              <span className="text-gray-400">— {desc}</span>
            </span>
          ))}
        </div>

        <div className="text-center mt-8">
          <Link href="/plugins">
            <a className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-storm-600 hover:text-storm-700 transition-colors">
              View full catalog <ArrowRight size={14} />
            </a>
          </Link>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-16 border-t border-gray-100">
        <div className="bg-storm-950 rounded-2xl p-8 sm:p-12 text-center">
          <h2 className="text-2xl font-bold text-white mb-3">Ready to build?</h2>
          <p className="text-storm-200 text-sm mb-6 max-w-md mx-auto">
            Scaffold a full-stack SaaS in 30 seconds. Open source, MIT licensed.
          </p>
          <div className="flex items-center justify-center gap-3">
            <code className="bg-storm-900 text-storm-100 px-4 py-2 rounded-lg font-mono text-sm">
              npx create-storm-app my-saas
            </code>
            <CopyButton text="npx create-storm-app my-saas" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 mt-8">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between text-xs text-gray-500">
          <span>MIT License — Built by <a href="https://stormeo.io" className="hover:text-gray-900">Stormeo</a></span>
          <div className="flex items-center gap-4">
            <Link href="/docs"><a className="hover:text-gray-900 transition-colors">Docs</a></Link>
            <Link href="/plugins"><a className="hover:text-gray-900 transition-colors">Plugins</a></Link>
            <a href="https://github.com/stormeoio/storm-stack" className="hover:text-gray-900 transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </>
  );
}
