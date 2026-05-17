# Storm Stack — Claude Code Instructions

## Ce projet

Storm Stack est un framework de plugins React/Node extrait de StormeoOS.
Chaque dossier `packages/plugin-*` est un plugin auto-contenu.

## Stack technique

- **Monorepo** : npm workspaces + Turborepo
- **Backend plugins** : Node.js 20 + Express 5 + TypeScript + Drizzle ORM
- **Frontend plugins** : React 18 + TypeScript + shadcn/ui + Tailwind CSS
- **Build** : tsup (libs) + Vite (apps)
- **Registry** : `packages/core/src/plugin/registry.ts`

## Anatomie d'un plugin

```
packages/plugin-foo/
├── src/
│   ├── index.ts          # StormPlugin manifest (l'export principal)
│   ├── routes.ts         # Express Router factory
│   ├── schema.ts         # Drizzle tables
│   ├── services/         # Logique métier
│   └── components/       # Composants React (si plugin a une UI)
├── CLAUDE.md             # Contexte spécifique au plugin pour Claude
├── package.json
└── tsconfig.json
```

## Règles impératives

- **Chaque plugin** exporte un objet `StormPlugin` depuis `src/index.ts`
- **Toutes les routes POST/PATCH/PUT** validées avec Zod `safeParse`
- **`isAuthenticated`** passé par `PluginRouteOptions`, jamais importé directement
- **Pas de `any`** dans les types
- **Pas de fichier > 500 lignes** dans les plugins

## Ajouter un nouveau plugin

1. Copier la structure de `packages/plugin-stripe/`
2. Remplir le manifest `StormPlugin` dans `src/index.ts`
3. Ajouter le plugin dans `packages/core/src/plugin/index.ts` (type `PluginId`)
4. Documenter dans `CLAUDE.md` du plugin

## Messages de commit

`type: description en français` (feat/fix/refactor/docs/chore)
