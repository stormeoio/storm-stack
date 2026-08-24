import { Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StormProvider, type StormProviderProps } from "./StormProvider";
import { StormLayout, type StormLayoutProps } from "./StormLayout";
import { StormRouter } from "./StormRouter";
import { useStorm } from "./context";

const defaultQueryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

export interface StormAppProps {
  /** Plugin component map (from createPluginLoader or createComponentMapFromGlob) */
  components: StormProviderProps["components"];
  /** API base path (default: "/api") */
  apiBase?: string;
  /** Auth endpoint (default: apiBase + "/auth/me") */
  authEndpoint?: string;
  /** App name in sidebar */
  appName?: string;
  /** Version label in sidebar */
  version?: string;
  /** Login path (default: "/login") */
  loginPath?: string;
  /** Login page component */
  loginComponent?: React.ComponentType;
  /** Dashboard / home page component */
  dashboardComponent?: React.ComponentType;
  /** 404 fallback */
  notFound?: React.ReactNode;
  /** Loading fallback for lazy components */
  fallback?: React.ReactNode;
  /** Extra static routes rendered before plugin routes */
  staticRoutes?: React.ReactNode;
  /** Nav props forwarded to <StormNav> */
  navProps?: StormLayoutProps["navProps"];
  /** Custom QueryClient (default: internal one) */
  queryClient?: QueryClient;
  /** Callback when user logs out */
  onLogout?: () => void;
}

function AppShell({
  appName,
  version,
  loginPath = "/login",
  loginComponent: LoginComponent,
  dashboardComponent: DashboardComponent,
  notFound,
  fallback,
  staticRoutes,
  onLogout,
  navProps,
}: Omit<StormAppProps, "components" | "apiBase" | "authEndpoint" | "queryClient">) {
  const { user, isLoading } = useStorm();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">
        Chargement…
      </div>
    );
  }

  return (
    <Suspense fallback={fallback}>
      <Switch>
        {LoginComponent && (
          <Route path={loginPath}>
            {() => user ? <Redirect to="/" /> : <LoginComponent />}
          </Route>
        )}

        <Route>
          {() => {
            if (!user) return <Redirect to={loginPath} />;

            return (
              <StormLayout appName={appName} version={version} onLogout={onLogout} navProps={navProps}>
                <StormRouter
                  fallback={fallback}
                  loginPath={loginPath}
                  notFound={notFound}
                >
                  {DashboardComponent && (
                    <Route path="/" component={DashboardComponent} />
                  )}
                  {staticRoutes}
                </StormRouter>
              </StormLayout>
            );
          }}
        </Route>
      </Switch>
    </Suspense>
  );
}

/**
 * All-in-one Storm Stack app component.
 *
 * Combines QueryClientProvider + StormProvider + StormLayout + StormRouter
 * into a single component. Handles auth guard, login redirect, lazy loading,
 * and dynamic plugin routes automatically.
 *
 * Usage:
 * ```tsx
 * import { StormApp, createPluginLoader } from "@stormeoio/react";
 *
 * const { components } = createPluginLoader([...]);
 *
 * function App() {
 *   return (
 *     <StormApp
 *       components={components}
 *       appName="My SaaS"
 *       loginComponent={LoginPage}
 *       dashboardComponent={DashboardPage}
 *     />
 *   );
 * }
 * ```
 */
export function StormApp({
  components,
  apiBase,
  authEndpoint,
  queryClient,
  ...shellProps
}: StormAppProps) {
  const qc = queryClient ?? defaultQueryClient;

  return (
    <QueryClientProvider client={qc}>
      <StormProvider components={components} apiBase={apiBase} authEndpoint={authEndpoint}>
        <AppShell {...shellProps} />
      </StormProvider>
    </QueryClientProvider>
  );
}
