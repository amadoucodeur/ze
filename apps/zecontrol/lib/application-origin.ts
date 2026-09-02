import "server-only";

function normalizeOrigin(value?: string) {
  if (!value?.trim()) return null;
  try {
    const raw = value.trim();
    return new URL(raw.includes("://") ? raw : `https://${raw}`).origin;
  } catch {
    return null;
  }
}

/** Never derive security-sensitive redirects from client-controlled Host headers. */
export function applicationOrigin() {
  return (
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ??
    normalizeOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeOrigin(process.env.VERCEL_URL) ??
    "http://localhost:3001"
  );
}
