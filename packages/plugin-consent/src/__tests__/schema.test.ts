import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { consentPreferences } from "../schema";

describe("consentPreferences schema", () => {
  it("conserve la contrainte necessary=true au niveau PostgreSQL", () => {
    const table = getTableConfig(consentPreferences);

    expect(table.checks.map((constraint) => constraint.name)).toContain(
      "storm_consent_preferences_necessary_true",
    );
  });

  it("ajoute withdrawn_at comme colonne additive nullable sans défaut", () => {
    const table = getTableConfig(consentPreferences);
    const withdrawnAt = table.columns.find((column) => column.name === "withdrawn_at");

    expect(withdrawnAt).toBeDefined();
    expect(withdrawnAt?.notNull).toBe(false);
    expect(withdrawnAt?.hasDefault).toBe(false);
  });
});
