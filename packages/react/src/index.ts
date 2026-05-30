// ─── Storm Stack React ─────────────────────────────────────────────────────
// Dynamic plugin-driven UI: nav, routes, layout — all from your manifest.

export { StormProvider, type StormProviderProps } from "./StormProvider";
export { StormNav, type StormNavProps } from "./StormNav";
export { StormRouter, type StormRouterProps } from "./StormRouter";
export { StormLayout, type StormLayoutProps } from "./StormLayout";
export { StormSettings, type StormSettingsProps } from "./StormSettings";
export { StormConfigForm, type StormConfigFormProps } from "./StormConfigForm";
export { StormApp, type StormAppProps } from "./StormApp";
export { StormAdmin, type StormAdminProps } from "./StormAdmin";
export { useStorm } from "./context";
export { useStormManifest } from "./use-storm-manifest";
export { usePluginComponent, usePluginComponentNames } from "./use-plugin-component";
export { resolveIcon } from "./icon-resolver";
export {
  createPluginLoader,
  createComponentMapFromGlob,
  mergeComponentMaps,
  PluginErrorBoundary,
} from "./plugin-loader";
export type {
  StormManifest,
  StormNavItem,
  StormDockItem,
  StormRoute,
  StormSettingsPanel,
  StormUser,
  ComponentMap,
  FieldDescriptor,
} from "./types";
