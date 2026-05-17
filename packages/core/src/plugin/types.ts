import type { Router } from "express";
import type { AnyPgColumn, PgTableWithColumns } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { z } from "zod";

// ─── Core context passed to every plugin ────────────────────────────────────

export interface StormContext {
  db: NodePgDatabase<any>;
  env: StormEnv;
  logger: StormLogger;
}

export interface StormEnv {
  DATABASE_URL: string;
  SESSION_SECRET: string;
  NODE_ENV: "development" | "production" | "test";
  [key: string]: string | undefined;
}

export interface StormLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

// ─── Tenant context (optional — only multi-tenant plugins need this) ─────────

export interface TenantContext {
  agencyId: string;
  userId: string;
  role: string;
}

// ─── Plugin schema contribution ──────────────────────────────────────────────

export type DrizzleTable = PgTableWithColumns<any>;

export interface PluginSchema {
  /** Tables this plugin owns. Drizzle will manage their migrations. */
  tables: Record<string, DrizzleTable>;
  /** Enum types this plugin registers */
  enums?: Record<string, any>;
}

// ─── Plugin route contribution ────────────────────────────────────────────────

export interface PluginRouteOptions {
  ctx: StormContext;
  /** Only present if @storm/core multi-tenant is enabled */
  getTenantContext?: (req: any) => TenantContext | null;
  /** isAuthenticated middleware — attach to any route that needs auth */
  isAuthenticated: (req: any, res: any, next: any) => void;
}

export type PluginRouteFactory = (opts: PluginRouteOptions) => Router;

// ─── Plugin client contribution ───────────────────────────────────────────────

export interface PluginClientManifest {
  /** Nav entries this plugin contributes to the sidebar */
  navItems?: PluginNavItem[];
  /** Dock shortcuts this plugin adds */
  dockItems?: PluginDockItem[];
  /** Routes this plugin registers in the React router */
  routes?: PluginRoute[];
  /** Settings panels this plugin adds */
  settingsPanels?: PluginSettingsPanel[];
}

export interface PluginNavItem {
  id: string;
  label: string;
  icon: string;
  path: string;
  /** Roles that can see this nav item */
  roles?: string[];
  badge?: () => number | string | null;
}

export interface PluginDockItem {
  id: string;
  icon: string;
  label: string;
  shortcut?: string;
  action: { type: "navigate"; path: string } | { type: "widget"; widgetId: string };
}

export interface PluginRoute {
  path: string;
  component: string;
  /** If true, requires authentication */
  auth?: boolean;
  /** Role required to access this route */
  role?: string;
}

export interface PluginSettingsPanel {
  id: string;
  label: string;
  icon: string;
  component: string;
}

// ─── Plugin lifecycle hooks ───────────────────────────────────────────────────

export interface PluginLifecycle {
  /** Called once when the plugin is first installed */
  onInstall?(ctx: StormContext): Promise<void>;
  /** Called on every server boot */
  onBoot?(ctx: StormContext): Promise<void>;
  /** Called when the plugin is uninstalled */
  onUninstall?(ctx: StormContext): Promise<void>;
}

// ─── Plugin dependencies ──────────────────────────────────────────────────────

export type PluginId =
  | "@stormstack/core"
  | "@stormstack/billing"
  | "@stormstack/crm"
  | "@stormstack/ticketing"
  | "@stormstack/messaging"
  | "@stormstack/drive"
  | "@stormstack/monitoring"
  | "@stormstack/cms"
  | "@stormstack/vault"
  | "@stormstack/integrations"
  | "@stormstack/auth-social"
  | "@stormstack/rgpd"
  | "@stormstack/design"
  | "@stormstack/search"
  | "@stormstack/dock"
  | (string & {});

// ─── Main plugin manifest ─────────────────────────────────────────────────────

export interface StormPlugin {
  /** Unique plugin identifier e.g. "@stormstack/billing" or "acme/my-plugin" */
  id: PluginId;
  /** Human-readable name */
  name: string;
  /** SemVer version */
  version: string;
  /** Short description shown in the catalog */
  description: string;
  /** Plugin author */
  author?: string;
  /** URL to plugin docs or repo */
  url?: string;

  /**
   * Other plugins this plugin requires.
   * Storm Stack will validate these are loaded before registering this plugin.
   */
  requires?: PluginId[];

  /**
   * Environment variables this plugin needs.
   * Storm Stack will validate these are present at boot.
   */
  env?: {
    [key: string]: {
      description: string;
      required: boolean;
      example?: string;
    };
  };

  /** Database schema contribution */
  schema?: PluginSchema;

  /** Express routes this plugin registers */
  routes?: PluginRouteFactory;

  /** Client-side manifest (nav, dock, routes, settings) */
  client?: PluginClientManifest;

  /** Lifecycle hooks */
  lifecycle?: PluginLifecycle;

  /**
   * Zod config schema — if provided, the plugin exposes a settings UI
   * and users can configure it from the StormClaude dashboard.
   */
  configSchema?: z.ZodObject<any>;

  /**
   * Tags for the Storm Catalog — used for search and filtering.
   * e.g. ["auth", "security", "multi-tenant"]
   */
  tags?: string[];

  /**
   * Pricing model for the catalog
   */
  pricing?: "free" | "premium" | "enterprise";
}

// ─── Plugin registry ──────────────────────────────────────────────────────────

export interface PluginRegistry {
  register(plugin: StormPlugin): void;
  get(id: PluginId): StormPlugin | undefined;
  getAll(): StormPlugin[];
  has(id: PluginId): boolean;
  validate(): ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
