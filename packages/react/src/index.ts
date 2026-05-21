// ─── Storm Stack React ─────────────────────────────────────────────────────
// Dynamic plugin-driven UI: nav, routes, layout — all from your manifest.

export { StormProvider, type StormProviderProps } from "./StormProvider";
export { StormNav, type StormNavProps } from "./StormNav";
export { StormRouter, type StormRouterProps } from "./StormRouter";
export { StormLayout, type StormLayoutProps } from "./StormLayout";
export { useStorm } from "./context";
export { useStormManifest } from "./use-storm-manifest";
export { resolveIcon } from "./icon-resolver";
export type {
  StormManifest,
  StormNavItem,
  StormDockItem,
  StormRoute,
  StormSettingsPanel,
  StormUser,
  ComponentMap,
} from "./types";
