import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import {
  createAppMiddleware,
  createDatabaseRoleGuard,
  signToken,
} from "../middleware";

const SESSION_SECRET = "database-role-guard-test-secret-32-chars";

function createDatabaseReturning(role: string | null): NodePgDatabase {
  const rows = role === null ? [] : [{ role }];
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => rows),
        })),
      })),
    })),
  } as unknown as NodePgDatabase;
}

function createResponseRecorder(): {
  response: Response;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const status = vi.fn();
  const json = vi.fn();
  const response = { status, json } as unknown as Response;
  status.mockReturnValue(response);
  json.mockReturnValue(response);
  return { response, status, json };
}

async function authenticateWithToken(
  tokenRole: string,
): Promise<Request> {
  const token = signToken(
    { userId: "user-1", email: "admin@example.test", role: tokenRole },
    SESSION_SECRET,
  );
  const request = {
    cookies: { storm_token: token },
  } as unknown as Request;
  const response = createResponseRecorder().response;
  const authenticate = createAppMiddleware(SESSION_SECRET)[1] as RequestHandler;
  const next = vi.fn() as NextFunction;

  await authenticate(request, response, next);
  expect(next).toHaveBeenCalledOnce();
  return request;
}

describe("createDatabaseRoleGuard", () => {
  it("rejects a still-valid admin JWT immediately after a database downgrade", async () => {
    const request = await authenticateWithToken("admin");
    const { response, status, json } = createResponseRecorder();
    const next = vi.fn() as NextFunction;

    await createDatabaseRoleGuard(createDatabaseReturning("member"), "admin")(
      request,
      response,
      next,
    );

    expect(request.user?.role).toBe("member");
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: "Accès refusé" });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows an admin according to the current database row", async () => {
    const request = await authenticateWithToken("member");
    const { response, status } = createResponseRecorder();
    const next = vi.fn() as NextFunction;

    await createDatabaseRoleGuard(createDatabaseReturning("admin"), "admin")(
      request,
      response,
      next,
    );

    expect(request.user?.role).toBe("admin");
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 when the JWT user no longer exists", async () => {
    const request = await authenticateWithToken("admin");
    const { response, status } = createResponseRecorder();
    const next = vi.fn() as NextFunction;

    await createDatabaseRoleGuard(createDatabaseReturning(null), "admin")(
      request,
      response,
      next,
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
