import type { RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";

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
