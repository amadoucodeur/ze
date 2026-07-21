# Ze platform engineering rules

This repository contains several independently deployable Next.js applications that share a platform foundation.

## Repository boundaries

- `apps/portal` is the neutral product discovery and application launcher.
- `apps/zerecruit` owns recruitment workflows and keeps its existing product contract.
- `apps/zecontrol` owns attendance, working-time and offline clocking workflows.
- `packages/*` contains only genuinely shared foundations. Product-specific business logic stays in its application.
- The products use one Supabase project. ZeRecruit data stays in `public`; ZeControl business data stays in `zecontrol`.

## Change safety

- Preserve ZeRecruit behavior while extracting shared foundations.
- Do not move product-specific roles, profiles or UI into a shared package merely because names look similar.
- Shared product access must remain separate from each product's business permissions.
- Keep each application independently buildable and deployable.
- Treat desktop, mobile and tablet as supported experiences; adapt workflows to the role and device instead of stretching one layout.

## Next.js

This version has breaking changes. Read the relevant guide in the installed `next/dist/docs/` before changing framework conventions, APIs or file structure.

