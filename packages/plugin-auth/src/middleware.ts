import type { RequestHandler, Response } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { users } from "./schema";

const COOKIE_NAME = "storm_token";
const TOKEN_TTL = "7d";

export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: string;
}

export function signToken(payload: AuthTokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string, secret: string): AuthTokenPayload | null {
  try {
    return jwt.verify(token, secret) as AuthTokenPayload;
  } catch {
    return null;
  }
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

/**
 * Returns the global middleware array to mount before any routes.
 * Parses cookies and attaches req.user if a valid JWT is present.
 */
export function createAppMiddleware(secret: string): RequestHandler[] {
  const jwtMiddleware: RequestHandler = (req, res, next) => {
    const token = req.cookies?.[COOKIE_NAME] as string | undefined;
    if (token) {
      const payload = verifyToken(token, secret);
      if (payload) {
        req.user = { id: payload.userId, email: payload.email, role: payload.role };
      }
    }
    next();
  };

  return [cookieParser() as RequestHandler, jwtMiddleware];
}

/** Standard isAuthenticated guard — returns 401 if req.user is not set */
export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (!req.user?.id) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  next();
};

/** Role guard factory — returns 403 if user doesn't have the required role */
export function requireRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Non authentifié" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Accès refusé" });
      return;
    }
    next();
  };
}

/**
 * Role guard backed by the current database row instead of the JWT role claim.
 * Use it for sensitive authorization where a role change must take effect
 * immediately, even while the user's existing JWT remains valid.
 */
export function createDatabaseRoleGuard(
  db: NodePgDatabase,
  ...roles: string[]
): RequestHandler {
  if (roles.length === 0) {
    throw new Error("createDatabaseRoleGuard requires at least one role");
  }

  return async (req, res, next) => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Non authentifié" });
      return;
    }

    try {
      const [currentUser] = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);

      if (!currentUser) {
        res.status(401).json({ error: "Non authentifié" });
        return;
      }

      req.user.role = currentUser.role;
      if (!roles.includes(currentUser.role)) {
        res.status(403).json({ error: "Accès refusé" });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
