import { cvImportRequestSchema } from "@/lib/cv/schema";
import { getCurrentProfile } from "@/lib/supabase/current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlan, hasActivePlanAccess } from "@/lib/billing/plans";
import { dispatchAiJobs } from "@/lib/jobs/dispatch";

export const maxDuration = 600;

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function authorisedProfile() {
  const profile = await getCurrentProfile();
  if (!profile || !profile.organisation_id || profile.role === "viewer") return null;
  if (!profile.organisation || profile.organisation.status !== "active" || !hasActivePlanAccess(profile.organisation)) return null;
  return profile;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ message: "Cette requête n’est pas autorisée." }, { status: 403 });
  const profile = await authorisedProfile();
  if (!profile?.organisation_id || !profile.organisation) {
    return Response.json({ message: "Votre accès ne permet pas de lancer cet import." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 2_500_000) return Response.json({ message: "Le lot est trop volumineux. Importez moins de CV à la fois." }, { status: 413 });
  const body = await request.json().catch(() => null);
  const parsed = cvImportRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Les CV envoyés ne sont pas valides." }, { status: 400 });

  const admin = createAdminClient();
  const plan = getPlan(profile.organisation.plan);
  if (plan.candidateLimit !== null) {
    const [{ count: activeCount }, { count: pendingCount }] = await Promise.all([
      admin.from("candidats").select("id", { count: "exact", head: true }).eq("organisation_id", profile.organisation_id).is("archived_at", null),
      admin.from("ai_processing_jobs").select("id", { count: "exact", head: true }).eq("organisation_id", profile.organisation_id).in("status", ["queued", "processing", "retry_wait"]),
    ]);
    const remaining = Math.max(0, plan.candidateLimit - (activeCount ?? 0) - (pendingCount ?? 0));
    if (parsed.data.items.length > remaining) {
      return Response.json({ message: remaining === 0 ? "La capacité de profils du plan est atteinte, y compris les CV déjà en attente." : `Vous pouvez encore placer ${remaining} CV dans la file.` }, { status: 402 });
    }
  }

  const rows = parsed.data.items.map((item) => ({
    organisation_id: profile.organisation_id,
    kind: "cv_import",
    client_reference: item.clientId,
    source_name: item.sourceName,
    payload: { item },
    created_by: profile.id,
  }));
  const { data, error } = await admin.from("ai_processing_jobs").insert(rows).select("id, client_reference, source_name, status, progress_step, progress_message, attempt_count, max_attempts, next_attempt_at");
  if (error || !data) return Response.json({ message: "La file d’analyse n’a pas pu être créée. Réessayez." }, { status: 500 });
  dispatchAiJobs(data.map((job) => job.id));
  return Response.json({ jobs: data }, { status: 202 });
}

export async function GET(request: Request) {
  const profile = await authorisedProfile();
  if (!profile?.organisation_id) return Response.json({ message: "Votre session a expiré." }, { status: 401 });
  const searchParams = new URL(request.url).searchParams;
  const ids = searchParams.get("ids")?.split(",").filter(Boolean).slice(0, 25) || [];
  const activeOnly = searchParams.get("active") === "1";
  const recoverAll = searchParams.get("recover") === "1";
  if (!ids.length && !activeOnly && !recoverAll) return Response.json({ jobs: [] });
  const admin = createAdminClient();
  let query = admin.from("ai_processing_jobs")
    .select("id, client_reference, source_name, status, progress_step, progress_message, attempt_count, max_attempts, next_attempt_at, last_error, candidat_id, result, created_at, updated_at")
    .eq("organisation_id", profile.organisation_id);
  query = ids.length
    ? query.in("id", ids)
    : recoverAll
      ? query.in("status", ["queued", "processing", "retry_wait"]).order("created_at", { ascending: true }).limit(25)
      : query.eq("kind", "cv_import").in("status", ["queued", "processing", "retry_wait"]).gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString()).order("created_at", { ascending: true }).limit(25);
  const { data, error } = await query;
  if (error) return Response.json({ message: "Le suivi de la file est momentanément indisponible." }, { status: 500 });
  const staleProcessingBefore = Date.now() - 15 * 60 * 1_000;
  const dueIds = (data || []).filter((job) => (
    (["queued", "retry_wait"].includes(job.status) && new Date(job.next_attempt_at).getTime() <= Date.now())
    || (job.status === "processing" && new Date(job.updated_at).getTime() <= staleProcessingBefore)
  )).slice(0, 3).map((job) => job.id);
  if (dueIds.length) dispatchAiJobs(dueIds);
  return recoverAll
    ? Response.json({ resumed: dueIds.length })
    : Response.json({ jobs: data || [] });
}
