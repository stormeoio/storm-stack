import { Link, useLocation } from "wouter";
import { LayoutDashboard, Puzzle, Settings, LogOut, Zap } from "lucide-react";
import { clsx } from "clsx";
import { useCurrentUser } from "@/lib/queries";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

const NAV = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/plugins", icon: Puzzle, label: "Plugins" },
  { href: "/settings", icon: Settings, label: "Paramètres" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();

  const handleLogout = async () => {
    await api.post("/auth/logout", {});
    await qc.invalidateQueries({ queryKey: ["auth"] });
    window.location.href = "/login";
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="h-14 flex items-center gap-2 px-4 border-b border-gray-200">
          <div className="w-7 h-7 rounded-lg bg-storm-600 flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <span className="font-semibold text-gray-900">StormClaude</span>
          <span className="ml-auto text-[10px] font-medium bg-storm-50 text-storm-600 px-1.5 py-0.5 rounded">v0.1</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href}>
              <a className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                location === href
                  ? "bg-storm-50 text-storm-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}>
                <Icon size={16} />
                {label}
              </a>
            </Link>
          ))}
        </nav>

        {/* User */}
        {user && (
          <div className="p-3 border-t border-gray-200">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <div className="w-7 h-7 rounded-full bg-storm-100 flex items-center justify-center text-storm-700 text-xs font-bold uppercase shrink-0">
                {user.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{user.name}</p>
                <p className="text-[10px] text-gray-500 truncate">{user.email}</p>
              </div>
              <button onClick={handleLogout} className="text-gray-400 hover:text-gray-600 transition-colors">
                <LogOut size={14} />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
