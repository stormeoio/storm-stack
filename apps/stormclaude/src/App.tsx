import { lazy } from "react";
import { Route } from "wouter";
import { QueryClient } from "@tanstack/react-query";
import { StormApp, createPluginLoader, mergeComponentMaps } from "@stormstack/react";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { api } from "@/lib/api";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const { components: pluginComponents } = createPluginLoader([
  {
    pluginId: "@stormstack/crm",
    components: {
      CrmPage: () => import("@/pages/ContactsPage"),
      ContactDetailPage: () => import("@/pages/ContactsPage"),
      DealsPage: () => import("@/pages/DealsPage"),
    },
  },
  {
    pluginId: "@stormstack/ticketing",
    components: {
      TicketsPage: () => import("@/pages/TicketsPage"),
      TicketDetailPage: () => import("@/pages/TicketsPage"),
    },
  },
]);

const appComponents = mergeComponentMaps(pluginComponents, {
  PluginsPage: lazy(() => import("@/pages/PluginsPage")),
  CatalogPage: lazy(() => import("@/pages/CatalogPage")),
  PluginDetailPage: lazy(() => import("@/pages/PluginDetailPage")),
  AdminPage: lazy(() => import("@/pages/AdminPage")),
});

const handleLogout = async () => {
  await api.post("/auth/logout", {});
  await queryClient.invalidateQueries({ queryKey: ["auth"] });
  window.location.href = "/login";
};

export default function App() {
  return (
    <StormApp
      components={appComponents}
      appName="StormClaude"
      version="v0.1"
      loginComponent={LoginPage}
      dashboardComponent={DashboardPage}
      onLogout={handleLogout}
      queryClient={queryClient}
      staticRoutes={
        <>
          <Route path="/plugins" component={appComponents.PluginsPage!} />
          <Route path="/catalog" component={appComponents.CatalogPage!} />
          <Route path="/catalog/:pluginId" component={appComponents.PluginDetailPage!} />
          <Route path="/admin" component={appComponents.AdminPage!} />
        </>
      }
    />
  );
}
