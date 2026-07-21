# Ze Platform

Monorepo de la suite de produits Ze.

## Applications

- `apps/zerecruit` : recrutement et gestion des talents.
- `apps/zecontrol` : présence, temps de travail et pointage.
- `apps/portal` : portail multi-produits (socle prévu pendant la phase plateforme).

## Fondations partagées

- `packages/config` : configuration commune explicitement réutilisée.
- `packages/ui-foundations` : principes visuels communs, sans uniformiser les marques.
- `packages/database` : types et contrats de données partagés à venir.
- `supabase` : historique canonique des migrations du projet Supabase commun.

Les dossiers historiques `zerecrut/` et `zecontrol/` sont temporairement conservés à la racine comme sources de migration et solution de retour arrière. Les applications canoniques du monorepo se trouvent sous `apps/`.
