import { hasActivePlanAccess } from "@/lib/billing/plans";
import { candidateEnrichmentRequestSchema } from "@/lib/cv/schema";
import { dispatchAiJobs } from "@/lib/jobs/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const maxDuration = 300;

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  try { return Boolean(host) && new URL(origin).host === host; } catch { return false; }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ message: "Cette requête n’est pas autorisée." }, { status: 403 });
  const profile = await getCurrentProfile();
  if (!profile) return Response.json({ message: "Votre session a expiré. Reconnectez-vous pour continuer." }, { status: 401 });
  if (!profile.organisation_id || profile.role === "viewer") return Response.json({ message: "Votre rôle ne permet pas d’actualiser ce profil." }, { status: 403 });
  if (!profile.organisation || profile.organisation.status !== "active" || !hasActivePlanAccess(profile.organisation)) return Response.json({ message: "Renouvelez le plan de l’organisation avant d’analyser de nouvelles informations." }, { status: 402 });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return Response.json({ message: "Ce profil est introuvable." }, { status: 404 });
  if (Number(request.headers.get("content-length") || 0) > 600_000) return Response.json({ message: "Les informations sont trop volumineuses. Retirez un document puis réessayez." }, { status: 413 });
  const parsed = candidateEnrichmentRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Les informations ne sont pas valides." }, { status: 400 });

  const admin = createAdminClient();
  const { data: candidate } = await admin.from("candidats").select("id, fullname, archived_at").eq("id", id).eq("organisation_id", profile.organisation_id).maybeSingle();
  if (!candidate) return Response.json({ message: "Ce profil est introuvable dans votre organisation." }, { status: 404 });
  if (candidate.archived_at) return Response.json({ message: "Restaurez d’abord ce profil avant de l’actualiser." }, { status: 409 });
  const { count: activeJobCount } = await admin.from("ai_processing_jobs").select("id", { count: "exact", head: true }).eq("target_candidat_id", id).in("status", ["queued", "processing", "retry_wait"]);
  if ((activeJobCount ?? 0) > 0) return Response.json({ message: "Une actualisation est déjà en cours pour ce profil. Elle reprendra automatiquement si nécessaire." }, { status: 409 });

  const sourceName = parsed.data.items[0]?.sourceName || `Actualisation de ${candidate.fullname}`;
  const { data: job, error } = await admin.from("ai_processing_jobs").insert({
    organisation_id: profile.organisation_id,
    kind: "candidate_enrichment",
    source_name: sourceName,
    payload: { enrichment: parsed.data },
    created_by: profile.id,
    target_candidat_id: id,
    candidat_id: id,
  }).select("id, client_reference, source_name, status, progress_step, progress_message, attempt_count, max_attempts, next_attempt_at, candidat_id, result, created_at").single();
  if (error || !job) return Response.json({ message: "L’actualisation n’a pas pu être placée dans la file. Réessayez." }, { status: 500 });
  dispatchAiJobs([job.id]);
  return Response.json({ job }, { status: 202 });
}
