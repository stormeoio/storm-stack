// ─── Multi-tenant middleware and helpers ──────────────────────────────────────

import type { RequestHandler } from "express";
import { eq, and, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";

// ─── Tenant context on req ───────────────────────────────────────────────────

export interface TenantInfo {
  /** Current tenant ID */
  tenantId: string;
  /** Authenticated user ID */
  userId: string;
  /** User's role within this tenant */
  role: string;
}

// Augment Express Request to carry tenant info
declare global {
  namespace Express {
    interface Request {
      tenant?: TenantInfo;
    }
  }
}

// ─── Tenant resolution options ───────────────────────────────────────────────

export interface TenantResolverOptions {
  /**
   * DB instance — needed to query tenant_members.
   * This is set lazily so the middleware can be created before DB is ready.
   */
  getDb: () => NodePgDatabase;

  /**
   * Table references for tenant lookup.
   * If not provided, falls back to simple "user ID = tenant ID" mode
   * (single-tenant per user, no storm_tenants table needed).
   */
  tables?: {
    tenantMembers: AnyPgTable & {
      tenantId: AnyPgColumn<{ data: string; notNull: true }>;
      userId: AnyPgColumn<{ data: string; notNull: true }>;
      role: AnyPgColumn<{ data: string; notNull: true }>;
    };
  };

  /**
   * Header name for explicit tenant selection (multi-tenant users).
   * Default: "x-storm-tenant"
   */
  headerName?: string;

  /**
   * If true, every authenticated request MUST have a tenant.
   * If false (default), tenant is optional — routes decide via requireTenant().
   */
  strict?: boolean;
}

// ─── Middleware factory ──────────────────────────────────────────────────────

/**
 * Creates tenant resolution middleware.
 *
 * After isAuthenticated, this middleware resolves which tenant the user
 * is acting within. Supports:
 * - Single-tenant (user ID = tenant ID) — default, zero-config
 * - Multi-tenant (storm_tenants + storm_tenant_members) — explicit opt-in
 * - Header-based selection for users with multiple tenants
 */
export function createTenantMiddleware(opts: TenantResolverOptions): RequestHandler {
  const headerName = opts.headerName ?? "x-storm-tenant";

  return async (req, res, next) => {
    // No user → no tenant
    if (!req.user?.id) {
      if (opts.strict) {
        res.status(401).json({ error: "Non authentifié" });
        return;
      }
      next();
      return;
    }

    const userId = req.user.id;

    // ── Multi-tenant mode (storm_tenant_members table) ─────────────────
    if (opts.tables?.tenantMembers) {
      const db = opts.getDb();
      const tm = opts.tables.tenantMembers;

      // Preferred tenant from header
      const preferredTenant = req.headers[headerName] as string | undefined;

      try {
        if (preferredTenant) {
          // Validate membership for the requested tenant
          const [membership] = await db
            .select({
              tenantId: tm.tenantId,
              role: tm.role,
            })
            .from(tm)
            .where(and(eq(tm.userId, userId), eq(tm.tenantId, preferredTenant)))
            .limit(1);

          if (membership) {
            req.tenant = { tenantId: membership.tenantId, userId, role: membership.role };
          } else if (opts.strict) {
            res.status(403).json({ error: "Accès refusé à ce tenant" });
            return;
          }
        } else {
          // Auto-select first tenant (or the only one)
          const [membership] = await db
            .select({
              tenantId: tm.tenantId,
              role: tm.role,
            })
            .from(tm)
            .where(eq(tm.userId, userId))
            .limit(1);

          if (membership) {
            req.tenant = { tenantId: membership.tenantId, userId, role: membership.role };
          } else if (opts.strict) {
            res.status(403).json({ error: "Aucun tenant associé à cet utilisateur" });
            return;
          }
        }
      } catch (err) {
        // If tenant_members table doesn't exist yet, graceful fallback
        console.warn("[storm-tenant] Tenant lookup failed, falling back to single-tenant mode", err);
        req.tenant = { tenantId: userId, userId, role: req.user.role };
      }
    } else {
      // ── Single-tenant mode (user = tenant) ─────────────────────────────
      req.tenant = { tenantId: userId, userId, role: req.user.role };
    }

    next();
  };
}

/**
 * Guard middleware — returns 403 if req.tenant is not set.
 * Use on routes that absolutely require tenant context.
 */
export const requireTenant: RequestHandler = (req, res, next) => {
  if (!req.tenant?.tenantId) {
    res.status(403).json({ error: "Contexte tenant requis" });
    return;
  }
  next();
};

/**
 * Tenant role guard — returns 403 if user's tenant role is insufficient.
 */
export function requireTenantRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.tenant?.tenantId) {
      res.status(403).json({ error: "Contexte tenant requis" });
      return;
    }
    if (!roles.includes(req.tenant.role)) {
      res.status(403).json({ error: "Rôle insuffisant dans ce tenant" });
      return;
    }
    next();
  };
}

// ─── Scoped query helpers ────────────────────────────────────────────────────

/**
 * Returns a WHERE condition scoping rows to the current tenant.
 *
 * Usage:
 * ```ts
 * const rows = await db.select().from(contacts)
 *   .where(tenantScope(contacts, req.tenant!.tenantId))
 *   .limit(100);
 * ```
 */
export function tenantScope(
  table: { tenantId: AnyPgColumn<{ data: string; notNull: true }> },
  tenantId: string,
): SQL {
  return eq(table.tenantId, tenantId);
}

/**
 * Merges tenant scope with additional conditions.
 *
 * Usage:
 * ```ts
 * const rows = await db.select().from(tickets)
 *   .where(tenantAnd(tickets, req.tenant!.tenantId, eq(tickets.status, "open")))
 *   .limit(100);
 * ```
 */
export function tenantAnd(
  table: { tenantId: AnyPgColumn<{ data: string; notNull: true }> },
  tenantId: string,
  ...conditions: SQL[]
): SQL {
  return and(eq(table.tenantId, tenantId), ...conditions)!;
}
