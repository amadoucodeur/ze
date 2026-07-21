# Configuration PayDunya de ZeRecruit

ZeRecruit utilise le paiement avec redirection PayDunya. PayDunya collecte le moyen de paiement sur sa propre page ; ZeRecruit ne reçoit jamais les codes Mobile Money ni les données bancaires.

## Variables serveur

Configurer les variables suivantes dans l’environnement local et dans Vercel. Aucune ne doit être préfixée par `NEXT_PUBLIC_`, à l’exception de l’URL publique du site.

```text
NEXT_PUBLIC_SITE_URL=https://zerecruit.vercel.app
PAYDUNYA_MODE=test
PAYDUNYA_PRINCIPAL_KEY=...
PAYDUNYA_PRIVATE_TEST_KEY=...
PAYDUNYA_TOKEN_TEST=...
PAYDUNYA_PUBLIC_TEST_KEY=...
PAYDUNYA_PRIVATE_PRODUCTION_KEY=...
PAYDUNYA_TOKEN_PRODUCTION=...
PAYDUNYA_PUBLIC_PRODUCTION_KEY=...
```

`PAYDUNYA_MODE` vaut `test` tant que les scénarios sandbox ne sont pas validés. Passer explicitement à `production` au moment de la mise en service ; ne jamais déduire ce mode de `NODE_ENV`.

## Configuration de l’intégration PayDunya

- Endpoint IPN : `https://zerecruit.vercel.app/api/payment/notification`
- IPN activé : `Oui`
- Moyens de paiement : activer uniquement les opérateurs réellement supportés commercialement.

Le même endpoint est envoyé dans chaque facture grâce à `actions.callback_url`. Les URLs de retour et d’annulation sont également renseignées à la création de chaque facture.

## Parcours traité

1. Le propriétaire choisit Essentiel ou Équipe et une période mensuelle ou annuelle.
2. Le serveur calcule le prix depuis le catalogue interne, crée une tentative et demande une facture PayDunya.
3. Le navigateur est redirigé vers l’URL HTTPS renvoyée par PayDunya.
4. L’IPN est accepté uniquement si le SHA-512 de la clé principale correspond.
5. ZeRecruit confirme ensuite la facture directement avec l’API PayDunya et vérifie le token, le montant et la référence interne.
6. Une fonction SQL idempotente complète le paiement et prolonge le plan dans une seule transaction.
7. Le retour navigateur affiche `confirmé`, `en attente` ou une prochaine action ; il ne constitue jamais à lui seul une preuve de paiement.

PayDunya ne prélève pas automatiquement le mois suivant dans ce parcours. Le client renouvelle depuis `Organisation > Plan et facturation`. Un paiement anticipé conserve la durée restante et ajoute le mois ou l’année après celle-ci.

## Droits réellement appliqués

- Free : 30 jours, 1 utilisateur actif, 100 profils actifs, 1 recrutement non clôturé, 3 matchings offre–profil, sans collections ni guides d’entretien IA.
- Essentiel : 1 utilisateur actif, 1 000 profils actifs, offres et matchings illimités, collections et guides d’entretien.
- Équipe : 8 utilisateurs actifs, 10 000 profils actifs, offres et matchings illimités, collections, guides d’entretien et gestion des collaborateurs.

Les limites de profils, sièges et recrutements actifs sont verrouillées dans Supabase afin que les écritures client protégées par RLS ne puissent pas les contourner. Les trois matchings Free sont réservés atomiquement dans `plan_usage_events`; une analyse qui échoue libère sa réservation. Les données existantes restent lisibles après expiration, mais les opérations créant ou consommant de nouvelles ressources sont suspendues.

## Vérifications avant production

- Effectuer un paiement sandbox Essentiel mensuel et vérifier le passage à `completed`.
- Rejouer le même IPN et vérifier que la date de fin ne change pas une seconde fois.
- Tester un paiement annulé et un paiement laissé `pending`.
- Envoyer un hash invalide et vérifier la réponse HTTP 401 sans modification de plan.
- Vérifier qu’un administrateur et un utilisateur d’une autre organisation ne lisent pas `billing_payments`.
- Déployer les variables de production dans Vercel, puis régler `PAYDUNYA_MODE=production`.

Documentation officielle :

- [API HTTP/JSON PayDunya](https://developers.paydunya.com/doc/FR/http_json)
- [Client Node.js et vérification IPN](https://developers.paydunya.com/doc/FR/NodeJS)
