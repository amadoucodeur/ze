# Web Push ZeControl

ZeControl utilise le Web Push standard. Supabase déclenche une seule route
protégée toutes les trois minutes. La route traite au maximum 500 profils par
passage et les doublons sont bloqués par `notification_deliveries`.

## 1. Appliquer la migration

Appliquer la migration canonique :

`supabase/migrations/20260907110000_zecontrol_web_push_notifications.sql`.

Elle crée les deux tables, les politiques RLS, la requête groupée et le Cron.
Le Cron ne fait rien tant que ses deux secrets Vault ne sont pas présents.

## 2. Générer les secrets

```bash
bunx web-push generate-vapid-keys
openssl rand -hex 32
```

Configurer le déploiement ZeControl avec :

```dotenv
VAPID_SUBJECT=mailto:notifications@votre-domaine.com
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
NOTIFICATION_DISPATCH_SECRET=...
```

La clé privée VAPID et le secret de dispatch ne doivent jamais être exposés au
navigateur. Le secret de dispatch doit être identique dans Vercel et Supabase
Vault.

## 3. Relier Supabase au déploiement

Exécuter une fois dans l’éditeur SQL Supabase, en utilisant l’URL HTTPS de
production et le secret de dispatch :

```sql
select vault.create_secret(
  'https://votre-domaine-zecontrol.com',
  'zecontrol_site_url'
);

select vault.create_secret(
  'le-meme-secret-que-NOTIFICATION_DISPATCH_SECRET',
  'zecontrol_notification_dispatch_secret'
);
```

Le job `zecontrol-push-dispatch-every-3-minutes` est déjà créé par la migration.
Son exécution est visible dans `cron.job_run_details`.

## 4. Vérification courte

1. Déployer ZeControl en HTTPS.
2. Se connecter avec un compte agent.
3. Ouvrir **Mon profil**, puis activer les rappels.
4. Vérifier que le message indique que l’arrière-plan est actif.
5. Fermer ZeControl et déclencher manuellement le job Cron pour tester.

Sur iPhone ou iPad, installer d’abord ZeControl sur l’écran d’accueil. Le mode
Ne pas déranger du système peut différer l’affichage d’une notification.
