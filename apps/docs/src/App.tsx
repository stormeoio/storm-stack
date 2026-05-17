import { Switch, Route } from "wouter";
import { Header } from "@/components/Header";
import { HomePage } from "@/pages/HomePage";
import { DocsPage } from "@/pages/DocsPage";
import { PluginsPage } from "@/pages/PluginsPage";

export default function App() {
  return (
    <div className="min-h-screen bg-white">
      <Header />
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/docs" component={DocsPage} />
        <Route path="/docs/:section" component={DocsPage} />
        <Route path="/plugins" component={PluginsPage} />
        <Route>
          <div className="max-w-4xl mx-auto px-6 py-24 text-center text-gray-500">Page not found.</div>
        </Route>
      </Switch>
    </div>
  );
}
