# @stormstack/consent

Plugin Storm Stack minimal pour enregistrer les préférences de consentement d’un utilisateur authentifié et afficher une bannière React.

## Installation

```bash
npm install @stormstack/consent
```

Le plugin requiert `@stormstack/auth` et la protection CSRF globale fournie par `@stormstack/core` pour les requêtes non sûres.

## Serveur

```ts
import { consentPlugin } from "@stormstack/consent";
import { registry } from "@stormstack/core";

registry.register(consentPlugin);
```

Les routes sont montées sous `/api/consent` :

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/state` | Oui | Lit les préférences courantes |
| `PUT` | `/preferences` | Oui | Crée ou remplace les préférences |

Le corps du `PUT` doit contenir `necessary: true`, `analytics`, `marketing` et `policyVersion`.

## Client

```tsx
import { ConsentBanner } from "@stormstack/consent/client";

export function App() {
  return <ConsentBanner policyVersion="2026-08" />;
}
```

Les props publiques sont `apiBaseUrl?`, `policyVersion?` et `className?`.
Les projets créés avec `create-storm-app` montent automatiquement la bannière
uniquement pour un utilisateur authentifié. `storm add consent` fait de même
quand `App.tsx` contient le marqueur généré `storm:root-components` ; sinon la
CLI indique explicitement le montage manuel à effectuer.

## Licence

MIT
