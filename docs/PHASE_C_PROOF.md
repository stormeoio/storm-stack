# Preuve Phase C : mise à jour de deux projets clients

Cette preuve vérifie qu’un train Storm Stack `0.1.0` peut générer deux applications
personnalisées, puis être remplacé par `0.1.1` sans écraser leur code ni leurs
données. Elle exerce aussi une interruption, un échec après migration, un rollback
exact et une nouvelle mise à jour avec cache chaud.

## Prérequis

- Node.js `20.20.2` et npm 10 ;
- Docker avec Compose ;
- dépôt Git propre ;
- deux références Git distinctes et immuables pour `0.1.0` et `0.1.1` ;
- gstack `/browse` construit et exécutable, ou son chemin dans `PROOF_BROWSE_BIN` ;
- six ports dédiés dans la plage `46001`–`46013` par défaut.

Le répertoire de travail doit être dédié. Il ne peut pas être la racine du dépôt,
le dossier utilisateur ou un lien symbolique. Un nouveau run exige aussi que son
cache npm froid n’existe pas encore.

## Exécution locale canonique

Créer une racine temporaire dédiée, puis lancer volontairement l’interruption après
l’installation cible :

```bash
case "$(uname -s)" in
  Darwin) PROOF_ROOT="$(mktemp -d /private/tmp/storm-stack-phase-c.XXXXXX)" ;;
  *)      PROOF_ROOT="$(mktemp -d /tmp/storm-stack-phase-c.XXXXXX)" ;;
esac

FAIL_AFTER_INSTALL=1 npm run proof:two-client-update -- \
  --baseline-ref proof/consent-v0.1.0 \
  --target-ref proof/consent-v0.1.1 \
  --work-dir "$PROOF_ROOT/work" \
  --output "$PROOF_ROOT/output"
```

Le chemin explicite est obligatoire pour les captures `/browse`. Sur macOS,
`mktemp -d` sans modèle crée généralement le dossier sous `/var/folders`, que
gstack refuse en écriture. Utiliser `/private/tmp/...` sur macOS et `/tmp/...`
sur Linux, ou un enfant dédié et ignoré du dépôt. Le préflight navigateur bloque
le run avec une recommandation claire si le dossier de journaux sort de ces racines.

Cette première commande doit sortir avec le code `2` et produire un rapport
`BLOCKED`. Le checkpoint et les ressources restent présents afin de tester la
reprise réelle.

Reprendre ensuite le même run tout en injectant l’échec de build post-migration :

```bash
FAIL_BUILD_AFTER_MIGRATION=1 npm run proof:two-client-update -- \
  --baseline-ref proof/consent-v0.1.0 \
  --target-ref proof/consent-v0.1.1 \
  --work-dir "$PROOF_ROOT/work" \
  --output "$PROOF_ROOT/output" \
  --resume
```

La seconde commande ne réussit que si le rapport final est `PASS` avec
`pass: true`. Aucun échec requis n’est relancé silencieusement.

## Ce qui est vérifié

- tarballs des onze packages construits depuis chaque commit exact et contrôlés par
  SHA-256 ;
- à la reprise, reconstruction fraîche des deux trains depuis leurs commits
  immuables dans une destination séparée, puis comparaison avec les tarballs
  checkpointés sans rejouer les commandes canoniques de pack/release ;
- API React publique de Consent stable entre les deux tarballs : déclaration
  `dist/client/index.d.ts` identique octet par octet et par SHA-256, avec le même
  manifeste `exports["./client"]` ;
- gate release complet exécuté sur le commit cible ;
- génération déterministe d’Alpha (`auth,consent`) et Beta
  (`auth,consent,crm`) ;
- migration Consent `0.1.1` strictement additive : un unique
  `ADD COLUMN withdrawn_at timestamp with time zone`, sans `DROP`, `RENAME`,
  `DEFAULT` ni `NOT NULL`, puis seconde migration no-op ;
- Auth, CSRF, Consentement et données métier vérifiés par API et PostgreSQL ;
- rendu navigateur authentifié de `/projects`, `/documents` et `/crm` avec nom,
  thème, sentinelles et état Consentement attendus ;
- démarrage simultané d’Alpha et Beta sans collision de ports, base, volume ou nom
  Compose ;
- restauration bit à bit des packages, migrations, schéma, données et séquences
  après l’échec injecté ;
- même restauration exacte de toutes les fixtures encore mutées si le verdict
  terminal calculé est `FAIL` ; un échec de cette recovery produit `BLOCKED` ;
- cycle séparé avec cache froid, puis cycle chaud strictement inférieur à quinze
  minutes pour chaque projet ;
- aucun fichier client modifié hors `package.json`, `package-lock.json` et
  `drizzle/**`.

## Preuves produites

Le dossier de sortie contient :

- `proof-report.json`, preuve machine validée par Zod ;
- `proof-report.md`, miroir lisible du verdict, des artefacts, commandes,
  fingerprints, sentinelles et fautes exercées.

Le dossier de travail contient les checkpoints, journaux de commandes, captures
navigateur hashées, tarballs, reconstructions de revalidation, sauvegardes et
`cleanup.log`. Les chemins de journaux sont référencés depuis le rapport.

## Codes de sortie et nettoyage

- `0` : preuve complète réussie ;
- `1` : scénario exécuté mais une assertion obligatoire a échoué ;
- `2` : preuve bloquée avant verdict fiable, ou nettoyage incomplet.

Après un verdict terminal, l’orchestrateur arrête ses groupes de processus, libère
les ports, supprime uniquement ses projets/volumes Compose dérivés du `runId`, puis
retire ses worktrees temporaires. Les conteneurs étrangers ne sont jamais ciblés.

Le workflow [proof-two-client-update.yml](../.github/workflows/proof-two-client-update.yml)
rejoue exactement l’interruption puis la reprise et archive les preuves pendant
quatorze jours.
