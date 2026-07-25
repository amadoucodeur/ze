<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## ZeRecruit parity contract

- ZeRecruit is the functional UX reference for every cross-product workflow in ZeControl: authentication, owner onboarding, dashboard shell, team management, settings, navigation, feedback states and responsive behavior.
- A user moving from ZeRecruit to ZeControl must keep the same sequence of actions, information hierarchy and interaction conventions. Reuse the same wording pattern when the business meaning is equivalent.
- Keep ZeControl's visual identity, attendance vocabulary and business rules distinct. Functional parity does not authorize importing recruitment roles, tables or product-specific logic.
- New ZeControl screens must support desktop, tablet and mobile with the same layout strategy as their ZeRecruit counterpart before being considered complete.

## Supabase mutation boundary

- Prefer browser-side Supabase CRUD protected by RLS for ordinary reads, inserts and updates.
- Server actions using the service role are reserved for security-sensitive operations such as Auth Admin, account provisioning, password resets, billing callbacks or trusted cross-table workflows that cannot be expressed safely through RLS.
- Every new browser-side mutation must ship with explicit RLS policies and, when needed, column-level grants so a client cannot modify protected fields by crafting a request.
