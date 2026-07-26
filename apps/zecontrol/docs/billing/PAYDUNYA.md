# Facturation postpayée ZeControl avec PayDunya

ZeControl facture la consommation réelle à la fin de chaque mois civil, dans
le fuseau horaire de l’organisation. Le propriétaire ne paie rien à
l’activation du produit.

## Règle de consommation

Un collaborateur est comptabilisé une seule fois dans la période courante dès
qu’un événement de pointage devient `accepted`.

- la connexion et la création du compte ne sont pas facturées ;
- un événement `pending`, `rejected` ou annulé n’est pas facturé ;
- une annulation autorisée dans les 30 secondes retire la consommation si
  aucun autre événement valide ne la justifie ;
- le nombre de pointages du collaborateur ne change pas le prix du mois ;
- `pointed_at` est une date métier uniquement ;
- un pointage antidaté approuvé est facturé dans la période où
  l’administrateur l’approuve, même si la journée concernée appartient à une
  période déjà clôturée.

Les tables `billing_event_qualifications` et `billing_usage` rendent cette
décision explicable et idempotente.

## Prix

La migration crée une première version tarifaire à 300 FCFA par utilisateur et
par période. Une nouvelle tarification doit être ajoutée dans
`zecontrol.billing_price_versions` avec une date d’effet. Une période conserve
toujours le prix qu’elle a capturé à son ouverture ; une modification ne
réécrit donc jamais une facture existante.

Les champs configurables sont :

- `unit_price` ;
- `minimum_invoice_amount` ;
- `payment_terms_days` ;
- `effective_from` et `effective_to`.

## Cycle et impayés

La période est clôturée à la fin du mois local. Le propriétaire dispose par
défaut de sept jours pour payer. Après l’échéance, un nouveau pointage accepté
est refusé jusqu’au règlement. Les données existantes restent conservées et
consultables.

La clôture et le contrôle d’échéance sont aussi exécutés lors d’un nouveau
pointage : la sécurité ne dépend donc pas de l’ouverture de l’écran de
facturation.

## Variables serveur

```text
NEXT_PUBLIC_SITE_URL=https://votre-domaine-zecontrol.com
PAYDUNYA_MODE=production
PAYDUNYA_PRINCIPAL_KEY=...
PAYDUNYA_PRIVATE_TEST_KEY=...
PAYDUNYA_TOKEN_TEST=...
PAYDUNYA_PUBLIC_TEST_KEY=...
PAYDUNYA_PRIVATE_PRODUCTION_KEY=...
PAYDUNYA_TOKEN_PRODUCTION=...
PAYDUNYA_PUBLIC_PRODUCTION_KEY=...
```

Aucune clé PayDunya ne doit être préfixée par `NEXT_PUBLIC_`.

Sur Vercel, `PAYDUNYA_MODE=production` et les clés live doivent être limitées à
l’environnement **Production**. Les déploiements Preview et Development
conservent `PAYDUNYA_MODE=test` et les clés sandbox. ZeControl refuse
automatiquement les clés live dans une Preview, les clés sandbox en Production
et toute URL de callback locale ou non HTTPS en mode live.

## Parcours sécurisé

1. Le propriétaire ouvre une période terminée.
2. Le serveur relit le montant, le nombre d’utilisateurs et le prix unitaire.
3. Une tentative de paiement immuable est créée.
4. PayDunya reçoit une facture détaillée et renvoie son URL sécurisée.
5. L’IPN est accepté uniquement si le SHA-512 de la clé principale correspond.
6. ZeControl confirme directement la transaction auprès de PayDunya.
7. Le token, le montant, la référence et la période doivent tous correspondre.
8. Une fonction SQL idempotente solde le paiement et la période dans la même
   transaction.

Le retour navigateur est un état d’interface, jamais une preuve suffisante de
paiement.

## Vérifications avant production

- appliquer `20260725120000_zecontrol_postpaid_billing.sql` ;
- créer un pointage accepté et vérifier une seule ligne de consommation ;
- créer plusieurs pointages du même utilisateur et vérifier que le total reste
  inchangé ;
- annuler le premier pointage dans les 30 secondes et vérifier le retrait ;
- approuver un pointage antidaté et vérifier qu’il apparaît dans la période
  courante ;
- clôturer une période et tester un paiement sandbox ;
- rejouer l’IPN et vérifier que la facture n’est pas soldée deux fois ;
- tester les séparations propriétaire, administrateur et autre organisation ;
- activer l’application dans le tableau de bord PayDunya ;
- renseigner l’IPN publique
  `https://votre-domaine-zecontrol.com/api/payment/notification` ;
- déployer explicitement `PAYDUNYA_MODE=production` et les clés live uniquement
  dans l’environnement Vercel Production.
