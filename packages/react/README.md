# @stormeoio/react

React bindings for Storm Stack applications: manifest-driven navigation, dynamic routes, settings UI, and an all-in-one app shell.

## Installation

```bash
npm install @stormeoio/react
```

Peer dependencies:

```bash
npm install @stormeoio/core react react-dom @tanstack/react-query wouter
```

## Usage

```tsx
import { StormApp, createComponentMapFromGlob } from "@stormeoio/react";
import { lazy } from "react";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";

const components = createComponentMapFromGlob({
  ContactsPage: lazy(() => import("./pages/ContactsPage")),
  TicketsPage: lazy(() => import("./pages/TicketsPage")),
});

export function App() {
  return (
    <StormApp
      components={components}
      appName="Storm App"
      loginComponent={LoginPage}
      dashboardComponent={DashboardPage}
    />
  );
}
```

By default, `StormApp` reads the plugin manifest from `/api/storm/manifest` and the current user from `/api/auth/me`.

`StormAdmin` expects the server to inject an explicit `requireAdmin` policy into
`bootstrapPlugins`. Its Configuration and Events tabs keep their loading state
until protected data succeeds, show a reconnect message for `401`, an access
denied message for `403`, and the server error for other HTTP failures. Forms are
not mounted from schema defaults when protected configuration failed to load.

## Main exports

| Export | Description |
|--------|-------------|
| `StormApp` | Query provider, Storm provider, auth guard, layout, and dynamic router |
| `StormProvider` | Manifest and user session context provider |
| `StormLayout` | Sidebar layout powered by plugin nav items |
| `StormRouter` | Dynamic route renderer for plugin manifests |
| `StormAdmin` | Plugin catalog, settings, and admin surfaces |
| `StormSettings` | Generated settings panels |
| `createPluginLoader` | Helper for lazy plugin component maps |
| `createComponentMapFromGlob` | Helper for Vite-style component maps |
| `useStorm` | Access manifest, user, loading state, and component map |
| `useStormManifest` | Fetch `/api/storm/manifest` with TanStack Query |

## License

MIT
