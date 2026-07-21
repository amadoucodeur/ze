<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ZeRecruit UX product contract

These rules are mandatory for every future product change. They remain in force until the user explicitly replaces them.

## Product north star

ZeRecruit must feel immediately understandable, ergonomic, calm, and easy to learn. Optimize for the shortest safe path to a useful recruiting outcome, not for the number of visible features.

The activation path is:

1. owner signs in with Google;
2. owner creates the minimum viable organisation;
3. owner creates a first offer from a title, text or document;
4. owner imports one or more CVs;
5. ZeRecruit returns candidate results contextualized against the offer;
6. owner invites collaborators;
7. collaborators sign in with the credentials supplied by their organisation.

Do not put organisation creation and collaborator creation in the wrong order.

The canonical login identifier is `user@organisation`. The owner created through Google receives the permanent identifier `admin@organisation`, while collaborators receive a local user part chosen by the owner, such as `amadou@trabad`. Store and display the complete identifier in `profiles.identifiant`. The organisation identifier becomes immutable after creation because changing it would silently invalidate every team login.

For collaborators, Supabase Auth uses the invisible technical email `user@organisation.zerecruit.local`, derived only from the canonical login identifier. Never display or store this technical address as the collaborator's professional contact email. `profiles.email` remains the contact email. Creating users, changing roles or identifiers, suspending access and resetting another user's password are privileged server operations. A suspended collaborator must receive a clear suspension message at sign-in.

Both `owner` and `admin` roles can manage the organisation's collaborators. Neither may modify the owner. An admin may not change, suspend or reset their own account; those self-service security operations require the owner or another authorised administrator.

## Non-negotiable UX rules

- One clear primary action per screen.
- Keep the permanent sidebar limited to the five core destinations: `Accueil`, `Offres`, `Vivier`, `Importer` and, when authorised, `Équipe`. Search and collections belong inside `Vivier`; profile and organisation settings belong in the account and workspace controls.
- The dashboard shows one contextual next action, not a checklist or a catalogue of features.
- Value before configuration; defer optional settings.
- Never expose an unavailable feature as a primary navigation item.
- Use progressive disclosure instead of showing all complexity at once.
- Keep product vocabulary stable across marketing, authentication and the app.
- Make navigation and landing content role-aware: owner, admin, recruiter, viewer.
- Every meaningful action needs loading, success, empty, error and permission states.
- Never use text below 12px for functional content. Body text should normally be at least 14px.
- Interactive targets must be at least 44px where practical and have a visible focus state.
- Every new or changed workflow must work on mobile, keyboard and screen reader paths.
- Do not style read-only information like an editable field.
- Explain errors in plain French and always give the user a next action.
- For AI workflows, optimize time to first useful result separately from background enrichment. Persist and label partial readiness truthfully, and always provide a targeted retry for failed non-destructive background work.
- Destructive or security-sensitive actions require confirmation or a reversible path.
- Do not simulate completed backend capabilities in the UI.
- Preserve multi-tenant isolation and determine organisation membership from the authenticated profile, never from an untrusted client value.

## Required workflow for every feature

Before implementation, identify:

- the user role and job to be done;
- the shortest happy path;
- permissions and organisation boundaries;
- loading, empty, success, error and unavailable states;
- desktop and mobile behavior;
- the event that proves the user obtained value.

Before marking work complete, use the checklist in `docs/ux/PRODUCT-UX.md`. A feature is not complete because its happy-path screen looks polished.

## Supabase client-first architecture

Prefer Supabase operations from Client Components for ordinary product reads and writes when the relevant Row Level Security policies are enabled, verified and sufficient. This is the default ZeRecruit architecture preference because it gives faster interactions, simpler realtime updates and better optimistic UX.

Use the browser Supabase client with the publishable key for operations such as:

- reading organisation-scoped product data allowed by RLS;
- creating and updating ordinary records allowed by the authenticated user's role;
- realtime subscriptions;
- direct Storage uploads when bucket policies, file constraints and paths are safe;
- user-scoped preferences that do not require a secret.

Keep operations on the server when they involve:

- the Supabase secret/service-role key or any third-party secret;
- Auth administration or creating, suspending and deleting other users;
- organisation membership, ownership, roles or permission changes;
- billing, plan enforcement or privileged usage changes;
- signed URL issuance or access to private files that RLS alone does not safely cover;
- AI provider calls, parsing pipelines, embeddings or other secret-backed processing;
- cross-tenant maintenance, trusted background jobs or bypassing RLS;
- rate limits, audit guarantees or atomic multi-record workflows that require trusted execution.

Billing is always server-owned. PayDunya keys must remain in non-public environment variables. A plan is activated only after the IPN SHA-512 signature is valid, ZeRecruit confirms the invoice directly with PayDunya, and the token, amount and internal reference match the pending ledger entry. Completion and organisation activation must be idempotent and transactional. Only the owner manages billing; administrators never receive access to payment history.

The canonical commercial plans are: `Free` for 30 days and 1 user, `Essentiel` at 9,000 FCFA per month for 1 user, and `Équipe` at 30,000 FCFA per month for up to 8 users. Annual payment covers twelve months for the price of ten. Existing data remains readable after expiry, while new imports and secret-backed AI work require an active access period.

Never use the admin client merely for convenience on a normal product query. Before moving an operation client-side, inspect the real database policies and test at least one allowed and one forbidden role/organisation case. RLS is part of the feature, not a substitute for verification. Never expose a secret key or trust an `organisation_id` only because it came from the client.

## UX governance

- Keep `docs/ux/PRODUCT-UX.md` current when navigation, vocabulary, roles, core journeys or UX standards change.
- Prefer reusable components and shared design tokens over one-off visual rules.
- Prefer client-side data interactions backed by verified RLS for ordinary product workflows; document why an operation remains server-side when it is not obviously sensitive.
- Validate changes in the real application at desktop and mobile widths.
- Run the build and accessibility lint checks available in the repository.
- Preserve ZeRecruit's forest, lime and cream identity while prioritizing contrast and readability.
