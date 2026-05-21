import fs from "fs";
import path from "path";
import { z } from "zod";
import { registry } from "./registry";

// ─── In-memory config store with JSON file persistence ──────────────────────

const CONFIG_FILENAME = "storm-config.json";

/** Plugin configs indexed by plugin ID */
let configCache: Record<string, Record<string, unknown>> = {};
let configPath: string | null = null;

/**
 * Initialize the config store. Call once at boot with the project root path.
 * Loads existing config from storm-config.json if present.
 */
export function initConfigStore(projectRoot: string): void {
  configPath = path.join(projectRoot, CONFIG_FILENAME);
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      configCache = JSON.parse(raw);
    } catch {
      configCache = {};
    }
  }
}

/**
 * Get config for a specific plugin. Returns validated config merged with defaults.
 */
export function getPluginConfig(pluginId: string): Record<string, unknown> {
  const plugin = registry.get(pluginId);
  if (!plugin?.configSchema) return {};

  const stored = configCache[pluginId] ?? {};
  // Parse through Zod to apply defaults
  const result = plugin.configSchema.safeParse(stored);
  return result.success ? result.data : {};
}

/**
 * Set config for a specific plugin. Validates against the plugin's configSchema.
 * Returns { success, data, errors }.
 */
export function setPluginConfig(
  pluginId: string,
  values: Record<string, unknown>,
): { success: boolean; data?: Record<string, unknown>; errors?: string[] } {
  const plugin = registry.get(pluginId);
  if (!plugin?.configSchema) {
    return { success: false, errors: [`Plugin "${pluginId}" has no configSchema`] };
  }

  const result = plugin.configSchema.safeParse(values);
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    return { success: false, errors };
  }

  configCache[pluginId] = result.data;
  persistConfig();
  return { success: true, data: result.data };
}

/**
 * Get all plugin configs (for the settings UI).
 */
export function getAllConfigs(): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const plugin of registry.getAll()) {
    if (plugin.configSchema) {
      result[plugin.id] = getPluginConfig(plugin.id);
    }
  }
  return result;
}

/**
 * Serialize a Zod schema to a JSON-friendly descriptor for the client.
 * Supports: string, number, boolean, enum, with defaults and descriptions.
 */
export function zodSchemaToDescriptor(
  schema: z.ZodObject<any>,
): Record<string, FieldDescriptor> {
  const shape = schema.shape;
  const result: Record<string, FieldDescriptor> = {};

  for (const [key, zodType] of Object.entries(shape)) {
    result[key] = zodFieldToDescriptor(key, zodType as z.ZodTypeAny);
  }

  return result;
}

export interface FieldDescriptor {
  key: string;
  type: "string" | "number" | "boolean" | "enum";
  label: string;
  description?: string;
  default?: unknown;
  required: boolean;
  options?: string[];        // for enum
  min?: number;              // for number
  max?: number;              // for number
  minLength?: number;        // for string
  maxLength?: number;        // for string
}

function zodFieldToDescriptor(key: string, field: z.ZodTypeAny): FieldDescriptor {
  // Unwrap defaults and optionals to get the inner type
  let innerType = field;
  let defaultValue: unknown = undefined;
  let isRequired = true;
  let description: string | undefined;

  // Unwrap ZodDefault
  if (innerType instanceof z.ZodDefault) {
    defaultValue = (innerType as any)._def.defaultValue();
    innerType = (innerType as any)._def.innerType;
  }

  // Unwrap ZodOptional
  if (innerType instanceof z.ZodOptional) {
    isRequired = false;
    innerType = (innerType as any)._def.innerType;
  }

  // Extract description
  if (innerType._def.description) {
    description = innerType._def.description;
  }
  // Also check parent description
  if (!description && field._def.description) {
    description = field._def.description;
  }

  const label = description ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());

  // Number
  if (innerType instanceof z.ZodNumber) {
    const checks = (innerType as any)._def.checks as Array<{ kind: string; value: number }>;
    const min = checks?.find((c) => c.kind === "min")?.value;
    const max = checks?.find((c) => c.kind === "max")?.value;
    return { key, type: "number", label, description, default: defaultValue, required: isRequired, min, max };
  }

  // Boolean
  if (innerType instanceof z.ZodBoolean) {
    return { key, type: "boolean", label, description, default: defaultValue ?? false, required: isRequired };
  }

  // Enum
  if (innerType instanceof z.ZodEnum) {
    const options = (innerType as any)._def.values as string[];
    return { key, type: "enum", label, description, default: defaultValue, required: isRequired, options };
  }

  // Default to string
  const strChecks = innerType instanceof z.ZodString
    ? (innerType as any)._def.checks as Array<{ kind: string; value: number }> | undefined
    : undefined;
  const minLength = strChecks?.find((c) => c.kind === "min")?.value;
  const maxLength = strChecks?.find((c) => c.kind === "max")?.value;

  return { key, type: "string", label, description, default: defaultValue ?? "", required: isRequired, minLength, maxLength };
}

function persistConfig(): void {
  if (!configPath) return;
  try {
    fs.writeFileSync(configPath, JSON.stringify(configCache, null, 2), "utf8");
  } catch {
    // Silently fail — config persistence is best-effort
  }
}
