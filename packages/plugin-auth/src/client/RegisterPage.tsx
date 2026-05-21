import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function RegisterPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Erreur lors de l'inscription");
      }
      await qc.invalidateQueries({ queryKey: ["storm", "auth"] });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const update = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h1 className="text-lg font-semibold text-center text-gray-900">Inscription</h1>
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
        <input type="text" placeholder="Nom" value={form.name} onChange={(e) => update("name", e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" required />
        <input type="email" placeholder="Email" value={form.email} onChange={(e) => update("email", e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" required />
        <input type="password" placeholder="Mot de passe" value={form.password} onChange={(e) => update("password", e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" required minLength={8} />
        <button type="submit" disabled={loading} className="w-full py-2 bg-storm-600 text-white text-sm font-medium rounded-md hover:bg-storm-700 disabled:opacity-50">
          {loading ? "Inscription..." : "Créer un compte"}
        </button>
        <p className="text-xs text-center text-gray-500">
          Déjà inscrit ? <a href="/login" className="text-storm-600 hover:text-storm-700">Se connecter</a>
        </p>
      </form>
    </div>
  );
}
