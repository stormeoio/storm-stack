import { Router } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { users } from "./schema";
import { signToken, setAuthCookie, clearAuthCookie, isAuthenticated } from "./middleware";
import type { StormContext } from "@stormeoio/core";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Mot de passe trop court (8 caractères min)"),
  name: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function createAuthRoutes(ctx: StormContext): Router {
  const router = Router();
  const { db, env, events } = ctx;
  const secret = env["SESSION_SECRET"] ?? "";

  // POST /register
  router.post("/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { email, password, name } = parsed.data;

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "Email déjà utilisé" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });

    if (!user) {
      res.status(500).json({ error: "Erreur lors de la création du compte" });
      return;
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role }, secret);
    setAuthCookie(res, token);
    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });

    events.emit("user.registered", { userId: user.id, email: user.email }, "@stormeoio/auth").catch(() => {});
  });

  // POST /login
  router.post("/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { email, password } = parsed.data;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "Email ou mot de passe incorrect" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Email ou mot de passe incorrect" });
      return;
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role }, secret);
    setAuthCookie(res, token);
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });

    events.emit("user.logged_in", { userId: user.id, email: user.email }, "@stormeoio/auth").catch(() => {});
  });

  // POST /logout
  router.post("/logout", (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  // GET /me
  router.get("/me", isAuthenticated, async (req, res) => {
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, role: users.role, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "Utilisateur introuvable" });
      return;
    }

    res.json({ user });
  });

  return router;
}
