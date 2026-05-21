import { useQuery } from "@tanstack/react-query";
import type { StormManifest } from "./types";

const EMPTY_MANIFEST: StormManifest = {
  navItems: [],
  dockItems: [],
  routes: [],
  settingsPanels: [],
};

/**
 * Fetches the aggregated plugin manifest from the Storm Stack server.
 * Returns navItems, dockItems, routes, and settingsPanels from all installed plugins.
 *
 * @param apiBase - Base URL for API calls (default: "/api")
 */
export function useStormManifest(apiBase = "/api") {
  return useQuery<StormManifest>({
    queryKey: ["storm", "manifest"],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/storm/manifest`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 min — manifest rarely changes at runtime
    placeholderData: EMPTY_MANIFEST,
  });
}
