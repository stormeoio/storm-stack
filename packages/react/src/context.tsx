import { createContext, useContext } from "react";
import type { ComponentMap, StormManifest, StormUser } from "./types";

export interface StormContextValue {
  /** The merged manifest from all installed plugins */
  manifest: StormManifest;
  /** Whether the manifest is still loading */
  isLoading: boolean;
  /** Map of component names to React components (for dynamic routing) */
  components: ComponentMap;
  /** Current authenticated user (null if not logged in) */
  user: StormUser | null;
}

export const StormContext = createContext<StormContextValue | null>(null);

/**
 * Access the Storm context — manifest, components, user state.
 * Must be used inside a <StormProvider>.
 */
export function useStorm(): StormContextValue {
  const ctx = useContext(StormContext);
  if (!ctx) throw new Error("useStorm() must be used inside <StormProvider>");
  return ctx;
}
