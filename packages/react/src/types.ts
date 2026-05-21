// ─── Client manifest types (mirrors @stormstack/core PluginClientManifest) ────

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

export interface StormManifest {
  navItems: StormNavItem[];
  dockItems: StormDockItem[];
  routes: StormRoute[];
  settingsPanels: StormSettingsPanel[];
}

export interface StormUser {
  id: string;
  email: string;
  name?: string;
  role?: string;
}

// ─── Component registry — maps component string names to lazy React components ─

export type ComponentMap = Record<string, React.ComponentType<any>>;
