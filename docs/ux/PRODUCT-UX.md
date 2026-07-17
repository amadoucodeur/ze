# ZeRecruit product UX contract

This document is the durable UX reference for ZeRecruit. `AGENTS.md` makes it mandatory for future implementation work.

## North-star outcome

A new organisation should reach a first useful candidate result without training. The product should always make the next useful action obvious.

Target measures:

- organisation created in under 3 minutes;
- first CV imported in under 5 minutes after sign-up;
- first usable candidate result in under 7 minutes;
- collaborator activation completed without support;
- no critical workflow requires desktop-only interaction.

## Canonical journeys

### Owner

Google sign-in -> minimum organisation setup -> first CV -> first result -> invite the team.

### Collaborator

Organisation credentials -> mandatory password replacement -> role-aware workspace -> first useful task.

## Canonical vocabulary

- `Organisation`: the secure tenant and billing workspace.
- `Talent`: the human-friendly navigation label for a person in the talent pool.
- `Candidat`: the record and contextual label when linked to a recruitment process.
- `Offre`: a role or position being recruited for.
- `Équipe`: the organisation's users and their access.
- `Propriétaire`, `Administrateur`, `Recruteur`, `Lecteur`: the only role labels.

Do not introduce synonyms unless the context materially requires them.

## Target information architecture

- Accueil
- Talents
  - Tous les talents
  - Importer
  - Listes
- Recherche
- Offres
- Activité
- Administration
  - Équipe
  - Organisation
  - Abonnement
- Compte
  - Mon profil
  - Sécurité

Only show destinations that work. Navigation is filtered by role and permissions.

## Definition of done

Every feature must satisfy all applicable items:

- [ ] The user role and job to be done are written down.
- [ ] One primary action is visually dominant.
- [ ] Optional complexity is deferred or disclosed progressively.
- [ ] Loading, empty, success and error states exist.
- [ ] Permission and unavailable states exist.
- [ ] Organisation isolation is enforced server-side.
- [ ] Ordinary data interactions use the client-side Supabase path when verified RLS safely permits it.
- [ ] Both an allowed and a forbidden RLS case were tested for client-side data changes.
- [ ] Any server-only implementation states the sensitive or privileged reason that requires it.
- [ ] French copy is concise, actionable and consistent with canonical vocabulary.
- [ ] Functional text is at least 12px and body copy is normally at least 14px.
- [ ] Touch targets are at least 44px where practical.
- [ ] Keyboard navigation and visible focus are verified.
- [ ] Screen-reader names and landmarks are meaningful.
- [ ] Desktop and mobile layouts are verified in the real app.
- [ ] Reduced-motion behavior is respected.
- [ ] The relevant analytics event is defined.
- [ ] Build, lint and the critical user path pass.

## Roadmap gates

1. Foundations: vocabulary, design tokens, navigation, states and measurement.
2. Activation: authentication, organisation creation and role-aware onboarding.
3. First value: secure import, processing feedback, candidate result and search.
4. Collaboration: invitations, activation, roles and activity.
5. Administration: organisation, security, plan and usage.
6. Hardening: accessibility, responsive behavior, performance and recovery.

Do not move a workflow past a gate while its critical state or previous dependency is missing.

## Data interaction standard

ZeRecruit follows a client-first Supabase model. Ordinary organisation-scoped reads and writes should run from Client Components through the publishable browser client when verified RLS policies enforce tenant and role boundaries. This should enable responsive mutations, optimistic feedback and realtime behavior.

Server Functions and Route Handlers are reserved for secrets and privileged work: Auth administration, roles and membership, billing, private signed access, AI processing, background jobs, cross-tenant maintenance and operations that require trusted atomic execution.

For every client-side mutation, the UX must still provide pending, success, error and recovery states. A client-side path is accepted only after testing that the intended role can perform it and that another organisation or forbidden role cannot.
