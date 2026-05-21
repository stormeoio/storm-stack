import { Zap, LogOut } from "lucide-react";
import { useStorm } from "./context";
import { StormNav, type StormNavProps } from "./StormNav";

export interface StormLayoutProps {
  children: React.ReactNode;
  /** App name shown in the sidebar header */
  appName?: string;
  /** Version label shown in the sidebar header */
  version?: string;
  /** Callback when user clicks logout */
  onLogout?: () => void;
  /** Nav props forwarded to <StormNav> */
  navProps?: StormNavProps;
}

/**
 * Full app layout with a sidebar (dynamic nav from plugins) and main content area.
 * Drop-in replacement for a hand-coded Layout component.
 */
export function StormLayout({
  children,
  appName = "Storm App",
  version,
  onLogout,
  navProps,
}: StormLayoutProps) {
  const { user } = useStorm();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-white border-r border-gray-200 flex flex-col">
        {/* Header */}
        <div className="h-14 flex items-center gap-2 px-4 border-b border-gray-200">
          <div className="w-7 h-7 rounded-lg bg-storm-600 flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <span className="font-semibold text-gray-900">{appName}</span>
          {version && (
            <span className="ml-auto text-[10px] font-medium bg-storm-50 text-storm-600 px-1.5 py-0.5 rounded">
              {version}
            </span>
          )}
        </div>

        {/* Nav */}
        <div className="flex-1 p-3">
          <StormNav {...navProps} userRole={user?.role} />
        </div>

        {/* User footer */}
        {user && (
          <div className="p-3 border-t border-gray-200">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <div className="w-7 h-7 rounded-full bg-storm-100 flex items-center justify-center text-storm-700 text-xs font-bold uppercase shrink-0">
                {(user.name ?? user.email)[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{user.name ?? user.email}</p>
                <p className="text-[10px] text-gray-500 truncate">{user.email}</p>
              </div>
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <LogOut size={14} />
                </button>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50">{children}</main>
    </div>
  );
}
