import {
  Activity,
  CreditCard,
  LayoutDashboard,
  LifeBuoy,
  Package,
  Puzzle,
  Search,
  Settings,
  StickyNote,
  Users,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Activity,
  CreditCard,
  LayoutDashboard,
  LifeBuoy,
  Package,
  Puzzle,
  Search,
  Settings,
  StickyNote,
  Users,
};

/**
 * Resolves a Lucide icon name (e.g. "Users", "LifeBuoy", "CreditCard")
 * to the actual React component. Falls back to a puzzle piece icon.
 */
export function resolveIcon(name: string): LucideIcon {
  return ICONS[name] ?? Puzzle;
}
