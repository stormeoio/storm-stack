import { Switch, Route, Redirect } from "wouter";
import { Layout } from "@/components/Layout";
import { DashboardPage } from "@/pages/DashboardPage";
import { PluginsPage } from "@/pages/PluginsPage";
import { ContactsPage } from "@/pages/ContactsPage";
import { DealsPage } from "@/pages/DealsPage";
import { TicketsPage } from "@/pages/TicketsPage";
import { LoginPage } from "@/pages/LoginPage";
import { useCurrentUser } from "@/lib/queries";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, isError } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">
        Chargement…
      </div>
    );
  }

  if (isError || !user) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />

      <Route>
        <AuthGuard>
          <Layout>
            <Switch>
              <Route path="/" component={DashboardPage} />
              <Route path="/plugins" component={PluginsPage} />
              <Route path="/contacts" component={ContactsPage} />
              <Route path="/deals" component={DealsPage} />
              <Route path="/tickets" component={TicketsPage} />
              <Route>
                <div className="p-8 text-sm text-gray-500">Page introuvable.</div>
              </Route>
            </Switch>
          </Layout>
        </AuthGuard>
      </Route>
    </Switch>
  );
}
