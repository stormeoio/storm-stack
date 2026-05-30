import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

// ── Admin: Config & Events ──────────────────────────────────────────────────

export interface FieldDescriptor {
  key: string;
  type: "string" | "number" | "boolean" | "enum";
  label: string;
  description?: string;
  default?: unknown;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
}

export interface ManifestWithSchemas extends StormManifest {
  configSchemas: Record<string, Record<string, FieldDescriptor>>;
}

export interface StormEvent {
  name: string;
  payload: Record<string, unknown>;
  source: string;
  timestamp: string;
}

export interface EventsData {
  emitters: Record<string, string[]>;
  listeners: Record<string, string[]>;
  history: StormEvent[];
}

export function useManifestWithSchemas() {
  return useQuery({
    queryKey: ["storm", "manifest-schemas"],
    queryFn: () => api.get<ManifestWithSchemas>("/storm/manifest"),
  });
}

export function usePluginConfigs() {
  return useQuery({
    queryKey: ["storm", "configs"],
    queryFn: () => api.get<{ configs: Record<string, Record<string, unknown>> }>("/storm/config").then((r) => r.configs),
  });
}

export function useStormEvents(limit = 50) {
  return useQuery({
    queryKey: ["storm", "events", limit],
    queryFn: () => api.get<EventsData>(`/storm/events?limit=${limit}`),
    refetchInterval: 5000,
  });
}

export function useUpdatePluginConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pluginId, values }: { pluginId: string; values: Record<string, unknown> }) =>
      api.patch<{ pluginId: string; config: Record<string, unknown> }>(
        `/storm/config/${encodeURIComponent(pluginId)}`,
        values,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storm", "configs"] });
    },
  });
}
