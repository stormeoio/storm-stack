import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";

export const CSRF_COOKIE_NAME = "storm_csrf";
export const CSRF_HEADER_NAME = "X-Storm-CSRF";
export const CSRF_ERROR = "CSRF validation failed";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface CsrfProtectionOptions {
  /** HMAC key. Pass the application's SESSION_SECRET. */
  secret: string;
  /** Exact browser origins allowed to submit unsafe requests. */
  allowedOrigins: readonly string[];
  /** Marks the CSRF cookie Secure. Defaults to production mode. */
  secure?: boolean;
}

export interface CsrfProtection {
  /** GET handler that creates or reuses a valid token and exposes it to the browser. */
  issueToken: RequestHandler;
  /** Middleware protecting every request method except GET, HEAD and OPTIONS. */
  protect: RequestHandler;
}

function signNonce(nonce: string, secret: string): string {
  return createHmac("sha256", secret).update(nonce).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isSignedTokenValid(token: string, secret: string): boolean {
  const separatorIndex = token.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex !== token.lastIndexOf(".")) {
    return false;
  }

  const nonce = token.slice(0, separatorIndex);
  const providedSignature = token.slice(separatorIndex + 1);
  if (!providedSignature) {
    return false;
  }

  return constantTimeEqual(providedSignature, signNonce(nonce, secret));
}

function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  let match: string | undefined;
  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0 || part.slice(0, separatorIndex).trim() !== name) {
      continue;
    }

    // Duplicate security cookies are ambiguous, so reject the request.
    if (match !== undefined) {
      return undefined;
    }

    try {
      match = decodeURIComponent(part.slice(separatorIndex + 1).trim());
    } catch {
      return undefined;
    }
  }

  return match;
}

function requestOrigin(req: Request): string | undefined {
  const origin = req.get("origin");
  if (origin) {
    return origin;
  }

  const referer = req.get("referer");
  if (!referer) {
    return undefined;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

function reject(res: Response): void {
  res.status(403).json({ error: CSRF_ERROR });
}

export function createCsrfProtection(options: CsrfProtectionOptions): CsrfProtection {
  if (!options.secret) {
    throw new Error("CSRF secret must not be empty");
  }

  const allowedOrigins = new Set(options.allowedOrigins);
  const secure = options.secure ?? process.env["NODE_ENV"] === "production";

  const issueToken: RequestHandler = (req, res) => {
    let csrfToken = parseCookie(req.get("cookie"), CSRF_COOKIE_NAME);
    if (!csrfToken || !isSignedTokenValid(csrfToken, options.secret)) {
      const nonce = randomBytes(32).toString("base64url");
      csrfToken = `${nonce}.${signNonce(nonce, options.secret)}`;
      res.cookie(CSRF_COOKIE_NAME, csrfToken, {
        httpOnly: false,
        secure,
        sameSite: "lax",
        path: "/",
      });
    }

    res.set("Cache-Control", "no-store");
    res.json({ csrfToken });
  };

  const protect: RequestHandler = (req, res, next) => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const origin = requestOrigin(req);
    if (!origin || !allowedOrigins.has(origin)) {
      reject(res);
      return;
    }

    const cookieToken = parseCookie(req.get("cookie"), CSRF_COOKIE_NAME);
    const headerToken = req.get(CSRF_HEADER_NAME);
    if (
      !cookieToken
      || !headerToken
      || !constantTimeEqual(cookieToken, headerToken)
      || !isSignedTokenValid(cookieToken, options.secret)
    ) {
      reject(res);
      return;
    }

    next();
  };

  return { issueToken, protect };
}
