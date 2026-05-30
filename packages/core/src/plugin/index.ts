export type {
  StormPlugin,
  StormContext,
  StormEnv,
  StormLogger,
  TenantContext,
  PluginId,
  PluginSchema,
  PluginRouteOptions,
  PluginRouteFactory,
  PluginClientManifest,
  PluginNavItem,
  PluginDockItem,
  PluginRoute,
  PluginSettingsPanel,
  PluginLifecycle,
  PluginEventConfig,
  PluginRegistry,
  ValidationResult,
  StormEventName,
  StormEventPayload,
  StormEventHandler,
  StormEvent,
  StormEventSubscription,
  StormEvents,
} from "./types";

export { StormPluginRegistry, registry } from "./registry";
export { bootstrapPlugins } from "./bootstrap";
export type { BootstrapOptions } from "./bootstrap";
export { mountManifestRoute } from "./manifest-route";
export { initConfigStore, getPluginConfig, setPluginConfig, getAllConfigs, zodSchemaToDescriptor } from "./config-store";
export type { FieldDescriptor } from "./config-store";
export { StormEventBus, eventBus } from "./event-bus";
export { createTenantMiddleware, requireTenant, requireTenantRole, tenantScope, tenantAnd } from "./tenant";
export type { TenantInfo, TenantResolverOptions } from "./tenant";
export { initLifecycleState, isPluginInstalled, markPluginInstalled, markPluginUninstalled, getInstalledPluginIds } from "./lifecycle-state";

// Side-effect import — registers built-in event types via declaration merging
import "./events";
