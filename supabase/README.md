# Supabase partagé

Ce dossier est l'unique historique de migrations du projet Supabase utilisé par la suite Ze.

- Le schéma `public` contient actuellement ZeRecruit et les structures historiques existantes.
- Le schéma `zecontrol` contient les futures données métier de ZeControl.
- Toute future structure véritablement commune devra être explicitement conçue comme une fondation de plateforme.

Les migrations ZeControl récentes comprennent leurs tables, fonctions, index,
droits et politiques RLS. L’historique le plus ancien dépend toutefois encore
du socle historique ZeRecruit déjà présent dans le projet Supabase. Pour une
reconstruction locale totalement vierge, exporter d’abord ce socle depuis le
projet lié, puis exécuter `supabase db reset` avec Docker actif.

Validation recommandée avant déploiement :

1. `bun run test`
2. `bun run lint`
3. `bun run build`
4. `supabase db reset` puis `supabase db lint`
