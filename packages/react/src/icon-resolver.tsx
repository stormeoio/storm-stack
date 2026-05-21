import * as icons from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Resolves a Lucide icon name (e.g. "Users", "LifeBuoy", "CreditCard")
 * to the actual React component. Falls back to a puzzle piece icon.
 */
export function resolveIcon(name: string): LucideIcon {
  const icon = (icons as Record<string, unknown>)[name];
  if (icon && typeof icon === "function") return icon as LucideIcon;
  return icons.Puzzle;
}
