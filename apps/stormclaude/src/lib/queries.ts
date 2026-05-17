import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface StormPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  pricing: "free" | "premium" | "enterprise";
}

export interface StormManifest {
  navItems: { id: string; label: string; icon: string; path: string }[];
  dockItems: unknown[];
  routes: { path: string; component: string; auth?: boolean }[];
  settingsPanels: unknown[];
}

export interface StormUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export function usePlugins() {
  return useQuery({
    queryKey: ["storm", "plugins"],
    queryFn: () => api.get<{ plugins: StormPlugin[] }>("/storm/plugins").then((r) => r.plugins),
  });
}

export function useManifest() {
  return useQuery({
    queryKey: ["storm", "manifest"],
    queryFn: () => api.get<StormManifest>("/storm/manifest"),
  });
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<{ user: StormUser }>("/auth/me").then((r) => r.user),
    retry: false,
  });
}
