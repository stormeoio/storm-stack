import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { StormContext, type StormContextValue } from "./context";
import { useStormManifest } from "./use-storm-manifest";
import type { ComponentMap, StormUser } from "./types";

export interface StormProviderProps {
  children: React.ReactNode;
  /**
   * Map component names (from plugin manifests) to actual React components.
   * Example: { ContactsPage: lazy(() => import("./pages/ContactsPage")) }
   */
  components?: ComponentMap;
  /** API base path (default: "/api") */
  apiBase?: string;
  /** Auth endpoint that returns { user: StormUser } (default: "/api/auth/me") */
  authEndpoint?: string;
}

/**
 * Top-level provider for Storm Stack React apps.
 * Fetches the plugin manifest and user session, makes them available
 * to <StormNav>, <StormRouter>, and useStorm().
 */
export function StormProvider({
  children,
  components = {},
  apiBase = "/api",
  authEndpoint,
}: StormProviderProps) {
  const { data: manifest, isLoading: manifestLoading } = useStormManifest(apiBase);

  const resolvedAuthEndpoint = authEndpoint ?? `${apiBase}/auth/me`;

  const { data: userData } = useQuery<{ user: StormUser }>({
    queryKey: ["storm", "auth", "me"],
    queryFn: async () => {
      const res = await fetch(resolvedAuthEndpoint, { credentials: "include" });
      if (!res.ok) throw new Error("Not authenticated");
      return res.json();
    },
    retry: false,
    staleTime: 30_000,
  });

  const value = useMemo<StormContextValue>(
    () => ({
      manifest: manifest ?? { navItems: [], dockItems: [], routes: [], settingsPanels: [] },
      isLoading: manifestLoading,
      components,
      user: userData?.user ?? null,
    }),
    [manifest, manifestLoading, components, userData],
  );

  return <StormContext.Provider value={value}>{children}</StormContext.Provider>;
}
