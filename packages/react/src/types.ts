// ─── Client manifest types (mirrors @stormeoio/core PluginClientManifest) ────

export interface StormNavItem {
  id: string;
  label: string;
  icon: string;
  path: string;
  roles?: string[];
}

export interface StormDockItem {
  id: string;
  icon: string;
  label: string;
  shortcut?: string;
  action: { type: "navigate"; path: string } | { type: "widget"; widgetId: string };
}

export interface StormRoute {
  path: string;
  component: string;
  auth?: boolean;
  role?: string;
}

export interface StormSettingsPanel {
  id: string;
  label: string;
  icon: string;
  component: string;
}

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

export interface StormManifest {
  navItems: StormNavItem[];
  dockItems: StormDockItem[];
  routes: StormRoute[];
  settingsPanels: StormSettingsPanel[];
  /** Zod schemas serialized as field descriptors, keyed by plugin ID */
  configSchemas?: Record<string, Record<string, FieldDescriptor>>;
}

export interface StormUser {
  id: string;
  email: string;
  name?: string;
  role?: string;
}

// ─── Component registry — maps component string names to lazy React components ─

export type ComponentMap = Record<string, React.ComponentType>;
