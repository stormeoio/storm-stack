# @stormstack/consent — Guide de contribution

## Périmètre 0.1.1

Ce package gère uniquement les préférences nécessaires, de mesure d’audience et marketing par utilisateur authentifié.

- Table : `storm_consent_preferences`
- Routes : `GET /api/consent/state`, `PUT /api/consent/preferences`, `POST /api/consent/withdraw`
- Client : `ConsentBanner`
- Authentification : middleware `isAuthenticated` injecté par `PluginRouteOptions`
- CSRF : le serveur généré monte la protection globale de `@stormstack/core`; le client utilise `csrfFetch`

L'évolution 0.1.1 est additive : la colonne nullable `withdrawn_at`, la route de
retrait et son état visible complètent le contrat 0.1.0 sans modifier les props
publiques React.

## Invariants

- `necessary` vaut toujours `true` et Zod refuse toute autre valeur.
- `POST /withdraw` accepte strictement `{}`, force `analytics` et `marketing` à `false` et utilise la `policyVersion` du serveur.
- Un retrait absent ou répété est traité par le même upsert PostgreSQL atomique.
- `PUT /preferences` remet toujours `withdrawn_at` à `null`.
- Un seul enregistrement existe par `user_id`.
- Les écritures utilisent un upsert PostgreSQL atomique.
- Les messages API et l’interface restent en français.
- Les props publiques de `ConsentBanner` restent stables : `apiBaseUrl?`, `policyVersion?`, `className?`.
- La bannière n'est montée que lorsque `useStorm().user` est défini, car ses routes sont authentifiées.
- La contrainte PostgreSQL `storm_consent_preferences_necessary_true` interdit toute écriture directe avec `necessary = false`.
- Les événements publics sont `consent.preferences_updated` et `consent.withdrawn`.

## Commandes

```bash
npm run test --workspace @stormstack/consent
npm run typecheck --workspace @stormstack/consent
npm run build --workspace @stormstack/consent
```
