import { lazy, Component, type ReactNode } from "react";
import type { ComponentMap } from "./types";

type ModuleImport = () => Promise<Record<string, unknown>>;

interface PluginModule {
  pluginId: string;
  components: Record<string, ModuleImport>;
}

/**
 * Creates a lazy-loaded component map from plugin module definitions.
 *
 * Usage:
 * ```ts
 * const { components } = createPluginLoader([
 *   {
 *     pluginId: "@stormeoio/crm",
 *     components: {
 *       CrmPage: () => import("../plugins/crm/client/CrmPage"),
 *       DealsPage: () => import("../plugins/crm/client/DealsPage"),
 *     },
 *   },
 * ]);
 *
 * <StormProvider components={components}>
 * ```
 */
export function createPluginLoader(modules: PluginModule[]): {
  components: ComponentMap;
  pluginIds: string[];
} {
  const components: ComponentMap = {};
  const pluginIds: string[] = [];

  for (const mod of modules) {
    pluginIds.push(mod.pluginId);
    for (const [name, importer] of Object.entries(mod.components)) {
      components[name] = lazy(async () => {
        const m = await importer();
        const Component = (m[name] ?? m.default) as React.ComponentType<unknown> | undefined;
        if (!Component) {
          throw new Error(`Plugin "${mod.pluginId}" module does not export "${name}" or default`);
        }
        return { default: Component };
      });
    }
  }

  return { components, pluginIds };
}

/**
 * Build a component map from Vite's import.meta.glob result.
 */
export function createComponentMapFromGlob(
  glob: Record<string, () => Promise<Record<string, unknown>>>,
): ComponentMap {
  const components: ComponentMap = {};

  for (const [path, importer] of Object.entries(glob)) {
    const match = path.match(/\/([^/]+)\.tsx?$/);
    if (!match) continue;
    const name = match[1]!;

    components[name] = lazy(async (): Promise<{ default: React.ComponentType }> => {
      const m = await importer();
      const resolved = (m[name] ?? m.default) as React.ComponentType | undefined;
      if (!resolved) {
        return { default: () => <div className="p-4 text-sm text-red-500">Component not found in module</div> };
      }
      return { default: resolved };
    });
  }

  return components;
}

/**
 * Merge multiple component maps into one.
 * Later maps override earlier ones for conflicting keys.
 */
export function mergeComponentMaps(...maps: ComponentMap[]): ComponentMap {
  return Object.assign({}, ...maps);
}

// ─── Error boundary for lazy plugin components ──────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, pluginId?: string) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class PluginErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="p-6 rounded-lg border border-red-200 bg-red-50">
          <p className="text-sm font-medium text-red-800">Erreur de chargement du plugin</p>
          <p className="mt-1 text-xs text-red-600">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-3 text-xs font-medium text-red-700 hover:text-red-900"
          >
            Réessayer
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
