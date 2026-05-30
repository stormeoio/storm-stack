import type { Router, Request, RequestHandler } from "express";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { z } from "zod";
import type { StormEventBus, StormEventHandler } from "./event-bus";

// ─── Core context passed to every plugin ────────────────────────────────────

export interface StormContext {
  db: NodePgDatabase;
  env: StormEnv;
  logger: StormLogger;
  /** Event bus for inter-plugin communication */
  events: StormEventBus;
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

// ─── Authenticated request extension ─────────────────────────────────────────

export interface StormUser {
  id: string;
  email: string;
  role: string;
}

// Augment Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: StormUser;
    }
  }
}

export type DrizzleTable = AnyPgTable;

export interface PluginSchema {
  /** Tables this plugin owns. Drizzle will manage their migrations. */
  tables: Record<string, DrizzleTable>;
  /** Enum types this plugin registers */
  enums?: Record<string, unknown>;
}

// ─── Plugin route contribution ────────────────────────────────────────────────

export interface PluginRouteOptions {
  ctx: StormContext;
  /** Only present if @stormstack/auth multi-tenant is enabled */
  getTenantContext?: (req: Request) => TenantContext | null;
  /** isAuthenticated middleware — attach to any route that needs auth */
  isAuthenticated: RequestHandler;
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

// ─── Plugin event config ─────────────────────────────────────────────────────

export interface PluginEventConfig {
  /**
   * Events this plugin may emit. Used for documentation and the admin UI.
   * e.g. ["ticket.created", "ticket.resolved"]
   */
  emits?: string[];

  /**
   * Event handlers this plugin wants to register at boot.
   * Keys are event names, values are handler functions.
   * Uses the generic event envelope so plugins can subscribe to custom events.
   */
  on?: Record<string, StormEventHandler>;
}

// ─── Plugin dependencies ──────────────────────────────────────────────────────

export type PluginId =
  | "@stormstack/core"
  | "@stormstack/auth"
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

  /**
   * Global Express middleware this plugin needs mounted before routes.
   * Mounted in plugin load order, before any route handlers.
   */
  appMiddleware?: (ctx: StormContext) => RequestHandler[];

  /** Client-side manifest (nav, dock, routes, settings) */
  client?: PluginClientManifest;

  /** Lifecycle hooks */
  lifecycle?: PluginLifecycle;

  /**
   * Event declarations and handlers for inter-plugin communication.
   * `emits` documents the events this plugin can fire.
   * `on` registers handlers that run when other plugins emit events.
   */
  events?: PluginEventConfig;

  /**
   * Zod config schema — if provided, the plugin exposes a settings UI
   * and users can configure it from the StormClaude dashboard.
   */
  configSchema?: z.ZodObject<z.ZodRawShape>;

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

// Re-export event types for convenience
export type { StormEventBus, StormEventName, StormEventPayload, StormEventHandler, StormEvent, StormEventSubscription, StormEvents } from "./event-bus";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
