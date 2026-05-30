import { useStorm } from "./context";

/**
 * Resolves a component name from the plugin manifest to a React component.
 * Returns null if the component is not registered.
 *
 * Usage:
 * ```tsx
 * const CrmPage = usePluginComponent("CrmPage");
 * if (CrmPage) return <CrmPage />;
 * ```
 */
export function usePluginComponent(name: string): React.ComponentType | null {
  const { components } = useStorm();
  return components[name] ?? null;
}

/**
 * Returns all registered component names.
 */
export function usePluginComponentNames(): string[] {
  const { components } = useStorm();
  return Object.keys(components);
}
