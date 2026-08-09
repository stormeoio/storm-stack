import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { consentPreferences } from "../schema";

describe("consentPreferences schema", () => {
  it("enforces necessary=true at the PostgreSQL layer", () => {
    const table = getTableConfig(consentPreferences);

    expect(table.checks.map((constraint) => constraint.name)).toContain(
      "storm_consent_preferences_necessary_true",
    );
  });
});
