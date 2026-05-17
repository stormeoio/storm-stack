import type {
  PluginId,
  PluginRegistry,
  StormPlugin,
  ValidationResult,
} from "./types";

export class StormPluginRegistry implements PluginRegistry {
  private plugins = new Map<PluginId, StormPlugin>();

  register(plugin: StormPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(
        `Plugin "${plugin.id}" is already registered. Use a unique plugin id.`
      );
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: PluginId): StormPlugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): StormPlugin[] {
    return Array.from(this.plugins.values());
  }

  has(id: PluginId): boolean {
    return this.plugins.has(id);
  }

  validate(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const plugin of this.plugins.values()) {
      // Check required dependencies are registered
      if (plugin.requires) {
        for (const dep of plugin.requires) {
          if (!this.plugins.has(dep)) {
            errors.push(
              `Plugin "${plugin.id}" requires "${dep}" but it is not registered.`
            );
          }
        }
      }

      // Check required env vars are present
      if (plugin.env) {
        for (const [key, meta] of Object.entries(plugin.env)) {
          if (meta.required && !process.env[key]) {
            errors.push(
              `Plugin "${plugin.id}" requires env var "${key}" (${meta.description}) but it is not set.`
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /** Resolve plugin load order based on `requires` dependencies (topological sort) */
  resolveLoadOrder(): StormPlugin[] {
    const visited = new Set<PluginId>();
    const order: StormPlugin[] = [];

    const visit = (id: PluginId) => {
      if (visited.has(id)) return;
      visited.add(id);
      const plugin = this.plugins.get(id);
      if (!plugin) return;
      for (const dep of plugin.requires ?? []) {
        visit(dep);
      }
      order.push(plugin);
    };

    for (const id of this.plugins.keys()) {
      visit(id);
    }

    return order;
  }
}

// Singleton registry — apps import this and register their plugins
export const registry = new StormPluginRegistry();
