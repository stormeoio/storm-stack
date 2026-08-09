# @stormstack/consent — Guide de contribution

## Périmètre 0.1.0

Ce package gère uniquement les préférences nécessaires, de mesure d’audience et marketing par utilisateur authentifié.

- Table : `storm_consent_preferences`
- Routes : `GET /api/consent/state`, `PUT /api/consent/preferences`
- Client : `ConsentBanner`
- Authentification : middleware `isAuthenticated` injecté par `PluginRouteOptions`
- CSRF : le serveur généré monte la protection globale de `@stormstack/core`; le client utilise `csrfFetch`

Le retrait (`withdrawn_at`, `POST /withdraw`) n’existe pas en 0.1.0. Il constitue l’évolution additive 0.1.1 de la preuve Phase C.

## Invariants

- `necessary` vaut toujours `true` et Zod refuse toute autre valeur.
- Un seul enregistrement existe par `user_id`.
- Les écritures utilisent un upsert PostgreSQL atomique.
- Les messages API et l’interface restent en français.
- Les props publiques de `ConsentBanner` restent stables : `apiBaseUrl?`, `policyVersion?`, `className?`.
- La bannière n'est montée que lorsque `useStorm().user` est défini, car ses routes sont authentifiées.
- La contrainte PostgreSQL `storm_consent_preferences_necessary_true` interdit toute écriture directe avec `necessary = false`.

## Commandes

```bash
npm run test --workspace @stormstack/consent
npm run typecheck --workspace @stormstack/consent
npm run build --workspace @stormstack/consent
```
