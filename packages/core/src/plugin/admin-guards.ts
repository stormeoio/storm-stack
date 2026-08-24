import type { RequestHandler } from "express";

/**
 * Core authentication guard used when an app does not inject its own auth
 * middleware into bootstrapPlugins().
 */
export const requireStormUser: RequestHandler = (req, res, next) => {
  if (!req.user?.id) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  next();
};

/**
 * Fail-closed fallback for Storm administration routes.
 *
 * Core cannot safely infer an application's administrator policy from a JWT
 * claim. Applications must inject BootstrapOptions.requireAdmin. A 503 makes
 * the server-side configuration error distinct from a policy denial (403).
 */
export const rejectUnconfiguredStormAdmin: RequestHandler = (_req, res) => {
  res.status(503).json({
    error: "Administration Storm indisponible : requireAdmin n'est pas configuré",
    code: "STORM_ADMIN_GUARD_REQUIRED",
  });
};
