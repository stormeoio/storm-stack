# @stormeoio/consent

Plugin Storm Stack minimal pour enregistrer les préférences de consentement d’un utilisateur authentifié et afficher une bannière React.

## Installation

```bash
npm install @stormeoio/consent
```

Le plugin requiert `@stormeoio/auth` et la protection CSRF globale fournie par `@stormeoio/core` pour les requêtes non sûres.

## Serveur

```ts
import { consentPlugin } from "@stormeoio/consent";
import { registry } from "@stormeoio/core";

registry.register(consentPlugin);
```

Les routes sont montées sous `/api/consent` :

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/state` | Oui | Lit les préférences courantes |
| `PUT` | `/preferences` | Oui | Crée ou remplace les préférences |
| `POST` | `/withdraw` | Oui | Retire les consentements facultatifs |

Le corps du `PUT` doit contenir `necessary: true`, `analytics`, `marketing` et peut
contenir la `policyVersion` affichée. La version enregistrée reste toujours celle
configurée par le serveur. Enregistrer de nouveaux choix remet `withdrawnAt` à
`null`.

Le corps du `POST /withdraw` doit être exactement `{}`. La route peut être appelée
plusieurs fois : elle conserve un état restrictif (`necessary: true`, `analytics:
false`, `marketing: false`) et renseigne `withdrawnAt`. La réponse de `GET /state`
expose cet état ainsi que la version de politique active.

Le plugin émet `consent.preferences_updated` après une sauvegarde et
`consent.withdrawn` après un retrait réussi.

## Client

```tsx
import { ConsentBanner } from "@stormeoio/consent/client";

export function App() {
  return <ConsentBanner policyVersion="2026-08" />;
}
```

Les props publiques sont `apiBaseUrl?`, `policyVersion?` et `className?`.
Elles restent inchangées en 0.1.1. Le composant permet de retirer le consentement,
affiche explicitement l'état retiré et permet ensuite d'enregistrer de nouveaux
choix.
Les projets créés avec `@stormeoio/create-storm-app` montent automatiquement la bannière
uniquement pour un utilisateur authentifié. `storm add consent` fait de même
quand `App.tsx` contient le marqueur généré `storm:root-components` ; sinon la
CLI indique explicitement le montage manuel à effectuer.

## Licence

MIT
