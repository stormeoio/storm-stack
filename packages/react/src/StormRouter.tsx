import { Switch, Route, Redirect } from "wouter";
import { Suspense } from "react";
import { useStorm } from "./context";

export interface StormRouterProps {
  /** Fallback component shown while lazy components load */
  fallback?: React.ReactNode;
  /** Where to redirect unauthenticated users (default: "/login") */
  loginPath?: string;
  /** Extra static routes to include (rendered before plugin routes) */
  children?: React.ReactNode;
  /** 404 fallback component */
  notFound?: React.ReactNode;
}

/**
 * Dynamic router that renders routes from all installed plugins.
 * Uses the component map from <StormProvider> to resolve component names
 * to actual React components. Supports auth guards per route.
 */
export function StormRouter({
  fallback,
  loginPath = "/login",
  children,
  notFound,
}: StormRouterProps) {
  const { manifest, components, user } = useStorm();

  const loadingFallback = fallback ?? (
    <div className="flex items-center justify-center min-h-[200px] text-sm text-gray-400">
      Chargement…
    </div>
  );

  const notFoundFallback = notFound ?? (
    <div className="p-8 text-sm text-gray-500">Page introuvable.</div>
  );

  return (
    <Suspense fallback={loadingFallback}>
      <Switch>
        {/* Static routes from children (e.g. login, dashboard) */}
        {children}

        {/* Dynamic plugin routes */}
        {manifest.routes.map((route) => {
          const Component = components[route.component];
          if (!Component) return null;

          return (
            <Route key={route.path} path={route.path}>
              {() => {
                // Auth guard
                if (route.auth && !user) {
                  return <Redirect to={loginPath} />;
                }
                // Role guard
                if (route.role && user?.role !== route.role) {
                  return <div className="p-8 text-sm text-red-500">Accès non autorisé.</div>;
                }
                return (
                  <Suspense fallback={loadingFallback}>
                    <Component />
                  </Suspense>
                );
              }}
            </Route>
          );
        })}

        {/* 404 */}
        <Route>{() => notFoundFallback}</Route>
      </Switch>
    </Suspense>
  );
}
