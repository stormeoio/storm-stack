# @stormeoio/cli — Claude Context

## Ce package

CLI pour Storm Stack : `storm add/remove/list/init`.
Deux modes d'installation de plugins :
- **npm** (défaut) : `npm install @stormeoio/<plugin>` + auto-wiring
- **copy** (`--copy`) : copie le code source dans `plugins/<name>/` style shadcn

## Architecture

```
src/
├── index.ts           # Entrypoint CLI + dispatch commandes
├── config.ts          # Lecture/écriture storm.json
├── registry.ts        # Registre complet des plugins (metadata, deps, fichiers)
├── injector.ts        # Injection import + register dans server/index.ts + drizzle.config.ts
├── utils.ts           # Package manager detection, fetch, file I/O
└── commands/
    ├── add.ts         # storm add <plugin>
    ├── remove.ts      # storm remove <plugin>
    ├── list.ts        # storm list
    └── init.ts        # storm init
```

## Règles

- Build : `npm run build` → produit `dist/index.mjs` (ESM, node20, shebang)
- Pas de fichier > 500 lignes
- Tests en mode non-TTY : créer storm.json manuellement + flag `--yes`
- Ajouter tout nouveau plugin dans `registry.ts` (PLUGINS array)
- L'injector est le code le plus critique — toute modification nécessite un test E2E
