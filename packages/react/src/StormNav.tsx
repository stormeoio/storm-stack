import { Link, useLocation } from "wouter";
import { clsx } from "clsx";
import { useStorm } from "./context";
import { resolveIcon } from "./icon-resolver";
import type { StormNavItem } from "./types";

export interface StormNavProps {
  /** Extra nav items to prepend (e.g. Dashboard) */
  prepend?: StormNavItem[];
  /** Extra nav items to append (e.g. Settings) */
  append?: StormNavItem[];
  /** Custom class for the nav container */
  className?: string;
  /** Filter nav items by user role (if not provided, shows all) */
  userRole?: string;
}

/**
 * Dynamic sidebar navigation built from the plugin manifest.
 * Renders nav items contributed by all installed plugins, with Lucide icons.
 */
export function StormNav({ prepend = [], append = [], className, userRole }: StormNavProps) {
  const { manifest } = useStorm();
  const [location] = useLocation();

  const allItems = [...prepend, ...manifest.navItems, ...append];

  const visibleItems = userRole
    ? allItems.filter((item) => !item.roles || item.roles.length === 0 || item.roles.includes(userRole))
    : allItems;

  return (
    <nav className={clsx("space-y-0.5", className)}>
      {visibleItems.map((item) => {
        const Icon = resolveIcon(item.icon);
        const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));

        return (
          <Link
            key={item.id}
            href={item.path}
            className={clsx(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              isActive
                ? "bg-storm-50 text-storm-700"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
            )}
          >
            <Icon size={16} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
