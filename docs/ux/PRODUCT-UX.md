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

### First CV import

Talent pool -> one or more PDF/DOCX/TXT/MD files or pasted text -> local text extraction -> user verification/correction -> AI structuring and embeddings -> profiles visible in the talent pool.

Files are read in the browser. Only the user-verifiable extracted text is sent to the server. The server owns Mammouth AI calls and the multi-table write because they require a secret and trusted tenant isolation. During processing, the interface reports the real server stage for every document (`queued`, `parsing`, `embedding`, `saving`) and a heartbeat with elapsed time; do not use simulated progress. A batch can partially succeed: completed profiles are preserved and every failed document keeps an actionable retry state.

Optimize time to first value separately from full search readiness. After the structured facts are validated, persist the essential candidate and its professional evidence in one trusted transaction before computing search vectors. The user may open, read and edit this real profile while search preparation continues. Show `indexing`, `ready` or `failed` truthfully; if indexing fails, preserve the profile and its chunks and offer a targeted retry that does not parse or upload the CV again.

When a provider response contains invalid structured data, the parser performs one automatic second reading and reports `La mise en page demande une seconde lecture…` without exposing model or schema vocabulary. If that recovery still fails, the extracted text remains editable and the document stays ready for a one-click retry; never force the user to upload the file again.

The first parser pass uses the configured fast structured-output model; a stronger fallback is used only for an invalid schema. Search indexing keeps at most 32 high-value, deduplicated chunks sampled across the whole document. A versioned SHA-256 fingerprint scoped to the organisation avoids reprocessing an identical active document without storing its source text.

The import surface supports batches of up to 25 documents from different people. It states clearly that one document creates one distinct profile, extracts all selected files locally in parallel, preserves partial successes, and lets the user add more files or remove individual documents before starting. Large batches remain readable through a compact per-profile list and real per-document processing states.

Do not expose implementation vocabulary such as provider names, embeddings, vectors or browser storage in the normal import interface. User-facing stages are `En attente`, `Lecture`, `Organisation`, `Finalisation` and `Terminé`. A successful single import opens the created talent profile directly; a successful batch returns to the talent pool.

### Talent profile

Talent pool card -> readable profile -> explicit `Modifier le profil` action -> edit essential information -> save -> readable updated profile. Read-only information must remain visually distinct from editable fields. Viewers never see the edit action. Until authenticated candidate-update RLS policies have been verified with safe non-impersonated test accounts, profile updates stay behind a server-side organisation and role check.

The profile opens as a professional-evidence dashboard. It shows a 0–100 overall profile score, its documented components, an indicative salary range with currency, period and confidence, strengths, evidence and points to deepen. These indicators help a recruiter read the CV; they are never presented as an automated hiring recommendation and never use sensitive personal traits. The candidate `statut` means professional availability only (`Disponible`, `En poste`, `À l’écoute`, `Freelance`, `En formation`, `Indisponible`, `À confirmer`) and must never be reused as a recruitment pipeline stage.

Archiving is the reversible way to remove a profile from the active pool. Deletion remains progressively disclosed, requires typing the exact candidate name and permanently removes the profile and its analysis. A viewer can read performance evidence but cannot edit, archive, restore or delete.

Embeddings live only on granular `section_chunks`; the candidate record never carries a duplicate global vector. Chunk types identify the professional section precisely (summary, experience, responsibility, achievement, project, education, certification, training, skill, language, industry, salary, contact, document or another explicit source). Formation `issuer_date` always means the date obtained and `institution_name` identifies the issuing institution.

Every candidate stores the immutable `created_by` profile that added it. The database verifies that this creator is an active member of the same organisation at creation time. The creator is visible on pool cards, search results and the candidate profile; it is never accepted from an untrusted client value.

### Candidate enrichment

`Modifier le profil` -> progressively disclose `Informations additionnelles` -> paste professional text and/or add up to five PDF/DOCX/TXT/MD documents -> local text extraction -> merge with the saved profile -> refreshed evidence dashboard.

The enrichment starts from the currently saved profile, so the interface tells the user to save any manual corrections first. Raw files stay in the browser; only extracted text is sent to the secret-backed analysis route. The result is a complete merged profile: existing facts remain unless newer information explicitly contradicts them, and missing AI fields must not erase previously documented skills, languages, formations, contact details, availability or salary context.

User-facing stages are `Lecture`, `Fusion`, `Actualisation` and `Terminé`, with real elapsed time and no provider, embedding or schema vocabulary. If analysis fails, the text and document-derived content remain ready for retry. If the multi-table save fails, the previous candidate profile and its related records are restored. Viewers never see this section, archived profiles must be restored first, and the immutable original `created_by` attribution never changes.

The value event is `candidate_enrichment_completed`, with the candidate identifier, number of source documents, presence of manual text and processing duration. Never include document text, candidate names or contact data in analytics.

### Talent pool search

`Vivier` in the sidebar contains only `Tous les profils`, `Rechercher`, `Collections` and, for roles allowed to create, `Importer des CV`. `Tous les profils` provides instant client-side discovery across names, métiers, skills, locations, languages, industries, availability and profile completeness, with progressively disclosed filters. Its semantic action carries the current wording into `Rechercher`, which remains the single ranking destination: natural language is the default and structured criteria are progressively disclosed inside the same workspace. Never split the same ranking job between an “AI assistant” page and an “advanced search” page.

The editable criteria are role or mission, required skills, desired skills, availability, location, language, industry, minimum experience and salary budget. Applying them reformulates a complete professional request and runs the same tenant-scoped semantic workflow. Empty results always propose widening or correcting the criteria. Returning from a talent profile restores the current search and result position from temporary same-tab state; this temporary state is not authoritative product data.

The value event is `cv_import_completed`, with the number of successfully created profiles, the source types and the processing duration. Never include CV text, names or contact data in analytics.

CV performance measurement includes browser extraction, parser duration and retry count, embedding duration, transactional save duration, input character count, selected chunk count and reuse count. These metrics may be stored in privacy-safe product events and candidate analysis metadata, but never with names, contacts or document content.

### Conversational talent search

`Assistant IA` -> describe the recruiting need in natural language -> clarify only when the request is too vague -> structure professional criteria -> create one to three semantic search formulations -> search granular candidate chunks inside the authenticated organisation -> rank profiles by relevance -> inspect matches and gaps -> open or collect a profile.

The assistant corrects and expands search vocabulary with useful synonyms but never invents a requirement. Sensitive or discriminatory criteria are excluded from both search and ranking, and the interface explains this without repeating personal data. After understanding, required and desired criteria remain visually distinct and editable. The displayed percentage is a relevance score for the current request, never a general candidate score or hiring decision. Ranking combines semantic similarity, explicitly requested professional criteria and a small evidence-completeness factor; every result exposes at most two primary matches and one point to verify before progressively disclosing professional evidence.

Never infer total career duration from the longest duration attached to a skill. Until structured employment dates exist, a requested minimum duration remains a semantic search signal and is explicitly marked as something to confirm in the profile. Search evidence uses stable professional section labels rather than exposing vector, chunk or provider vocabulary.

User-facing stages are `Compréhension`, `Préparation`, `Recherche` and `Classement`. A clarification remains in the short conversation so the next answer completes the same request. Empty results suggest widening professional criteria, while errors preserve the last user request for retry. The AI and embedding calls stay server-side; the vector function derives tenant membership from the authenticated profile and never accepts an untrusted organisation id.

Recent searches store only the sanitized understood request, structured criteria, result count and clarification count for the authenticated user. Raw conversation text is not durable search history. The value event is `talent_semantic_search_completed`, with result count, clarification count and duration. Do not log the raw request, candidate names, matched text or contact data.

### Talent collections

Search results -> select one or more profiles -> choose an existing shared collection or create one inline -> profiles appear in `Collections` -> order priorities, add optional team notes, rename, describe, remove profiles or delete the collection. Deleting a collection never deletes its candidate profiles.

Collections are shared within one organisation. Active owners, administrators and recruiters can create and manage them; viewers can only read them. The interface shows who created a collection and who added each profile. On mobile, collection selection uses a compact selector instead of stacking the full collection list above the active content. Ordinary collection reads and writes use the browser Supabase client after RLS policies and tenant triggers have been installed. The database derives `organisation_id`, `created_by` and `added_by` from the authenticated profile, verifies that collections and candidates belong to the same active organisation, and rejects archived candidates. Collection deletion is progressively disclosed and confirmed.

The value event is `candidate_added_to_collection`, with collection id and source surface only. Never include candidate names or collection content in analytics.

### Offers and recruitment process

`Offres` -> `Créer une offre` -> provide any useful combination of structured fields, an existing PDF/DOCX/TXT/MD document and free text -> AI proposes a structured professional need -> recruiter validates the exact intention -> create the offer -> compare the organisation talent pool -> add selected profiles to the recruitment process.

The author does not need to complete a long form before obtaining value. A title plus meaningful context is sufficient to start; documents are read in the browser and only their extracted text is sent to the server. The AI may infer and reformulate professional requirements, distinguish indispensable criteria from desirable ones and surface ambiguities, but it never invents a requirement or retains a sensitive personal criterion. The recruiter reviews and can edit every criterion before it influences matching. AI analysis remains server-side because it uses a provider secret; offer reads and ordinary writes use the browser Supabase client behind verified organisation RLS.

An offer records the mission, responsibilities, expected outcomes, recruiter intent, required and desired skills, experience, languages, industries, education, location, work mode, contract, headcount, intended start and salary range. Optional fields remain progressively disclosed by the natural creation flow rather than becoming blockers. The value event is `offer_created`, with offer id, publication status and input source types only.

The contextual matching percentage measures relevance to this validated offer only. It is never the candidate's general performance score or an automated hiring decision. Offer matching consumes the recruiter-validated structured criteria directly; it must not ask the AI to reinterpret the offer a second time. Semantic retrieval ranks the available evidence, while a structured fallback still compares active profiles when no vector result is returned. The process stages are `À examiner`, `Présélectionné`, `Entretien`, `Proposition`, `Retenu` and `Refusé`; candidate professional availability remains a separate property. Adding a profile creates one organisation-safe candidature and records the score and professional evidence that explained the addition. The value event is `candidate_added_to_offer`.

When a candidature reaches `Entretien`, its compact pipeline card opens a dedicated full-screen interview mode; the question form must never expand inside a pipeline column. The recruiter may ask ZeRecruit for a contextual guide. Questions use the offer, documented candidate evidence and gaps to verify. They must remain professional, explain what each question verifies and avoid sensitive personal criteria. Show one question at a time with visible progress. The user records the candidate's answer separately from the recruiter's optional note and evaluates answer strength on a 0–100 scale. Partial answers can be saved and resumed. The value events are `interview_guide_created` and `interview_response_saved`; analytics never contain questions, answers, names or notes.

Active owners, administrators and recruiters can create offers, manage candidatures and record interviews. Viewers can read but cannot mutate. The database derives organisation and actor identifiers from the authenticated active profile, validates that every offer, candidate and assignee belongs to the same organisation and records stage history. Loading, empty, success, error, permission and retry states are mandatory on creation, matching, pipeline and interview surfaces.

The credential always uses the format `user@organisation`. Example: `amadou@trabad`. The creator's permanent profile identifier is `admin@organisation`, even though the owner authenticates with Google.

The technical Supabase Auth address is derived as `user@organisation.zerecruit.local` and is never shown. The collaborator only sees `user@organisation`; the professional email remains a contact field. At creation and reset, the owner may generate a password or define one, and the collaborator must replace it at the next connection. A refused connection explicitly distinguishes a suspended access from invalid credentials.

## Canonical vocabulary

- `Organisation`: the secure tenant and billing workspace.
- `Talent`: the human-friendly navigation label for a person in the talent pool.
- `Candidat`: the record and contextual label when linked to a recruitment process.
- `Offre`: a role or position being recruited for.
- `Équipe`: the organisation's users and their access.
- `Propriétaire`, `Administrateur`, `Recruteur`, `Lecteur`: the only role labels.
- `Identifiant de connexion`: the complete `user@organisation` value stored in the profile.
- `Identifiant de l’organisation`: the permanent suffix used by every member login.
- `Mot de passe de départ`: the generated or owner-defined password that must be replaced on next sign-in.

Owners and administrators can create and manage collaborators in their own organisation. The owner is never manageable from the team list, and an administrator cannot alter their own role, status or password from the administration surface.

Do not introduce synonyms unless the context materially requires them.

## Target information architecture

- Accueil
- Vivier
  - Tous les profils
  - Rechercher
  - Collections
  - Importer
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
