import { createHash, randomUUID } from "node:crypto";
import { publicApplicationSchema } from "@/lib/careers/schema";
import { getPlan, hasActivePlanAccess } from "@/lib/billing/plans";
import { dispatchAiJobs } from "@/lib/jobs/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";

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

function requestFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  const secret = process.env.PUBLIC_APPLICATION_HASH_SECRET
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || "zerecruit-public-application";
  return createHash("sha256").update(`${secret}:${address}`).digest("hex");
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ message: "Cette requête n’est pas autorisée." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 800_000) {
    return Response.json({ message: "Le contenu du CV est trop volumineux. Essayez un document plus court." }, { status: 413 });
  }
  const parsed = publicApplicationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ message: parsed.error.issues[0]?.message || "Vérifiez les informations saisies." }, { status: 400 });
  }

  const input = parsed.data;
  const admin = createAdminClient();
  const { data: organisation } = await admin.from("organisations")
    .select("id, plan, trial_ends_at, plan_expires_at, billing_status, status")
    .eq("identifiant", input.organisation)
    .eq("status", "active")
    .maybeSingle();
  if (!organisation || !hasActivePlanAccess(organisation)) {
    return Response.json({ message: "Cette page de candidature n’est plus disponible." }, { status: 404 });
  }
  const { data: offer } = await admin.from("offres")
    .select("id, organisation_id, created_by, title")
    .eq("organisation_id", organisation.id)
    .eq("public_slug", input.offerSlug)
    .eq("status", "open")
    .not("published_at", "is", null)
    .maybeSingle();
  if (!offer) {
    return Response.json({ message: "Cette offre n’accepte plus de candidatures." }, { status: 404 });
  }

  const fingerprint = requestFingerprint(request);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
  const { count: recentRequests } = await admin.from("public_applications")
    .select("id", { count: "exact", head: true })
    .eq("request_fingerprint", fingerprint)
    .gte("created_at", oneHourAgo);
  if ((recentRequests ?? 0) >= 8) {
    return Response.json({ message: "Trop de candidatures ont été envoyées depuis cette connexion. Réessayez dans une heure." }, { status: 429 });
  }

  const duplicateSince = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const { data: duplicate } = await admin.from("public_applications")
    .select("id")
    .eq("offre_id", offer.id)
    .ilike("email", input.email)
    .gte("created_at", duplicateSince)
    .limit(1)
    .maybeSingle();
  if (duplicate) {
    return Response.json({ received: true, message: "Votre candidature a déjà été reçue pour cette offre." }, { status: 200 });
  }

  const plan = getPlan(organisation.plan);
  if (plan.candidateLimit !== null) {
    const [{ count: candidateCount }, { count: pendingCount }] = await Promise.all([
      admin.from("candidats").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).is("archived_at", null),
      admin.from("ai_processing_jobs").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).in("status", ["queued", "processing", "retry_wait"]),
    ]);
    if ((candidateCount ?? 0) + (pendingCount ?? 0) >= plan.candidateLimit) {
      return Response.json({ message: "Cette organisation ne peut pas recevoir de nouvelle candidature pour le moment." }, { status: 409 });
    }
  }

  const identityBlock = [
    "INFORMATIONS FOURNIES PAR LE CANDIDAT",
    `Nom complet : ${input.fullname}`,
    `Email : ${input.email}`,
    input.phone ? `Téléphone : ${input.phone}` : "",
    input.coverNote ? `Message de candidature : ${input.coverNote}` : "",
    "",
    "CONTENU DU CV",
  ].filter(Boolean).join("\n");
  const queuedItem = {
    ...input.item,
    clientId: randomUUID(),
    text: `${identityBlock}\n${input.item.text}`.slice(0, 60_000),
  };
  const now = new Date().toISOString();
  const { data: application, error: applicationError } = await admin.from("public_applications").insert({
    organisation_id: organisation.id,
    offre_id: offer.id,
    fullname: input.fullname,
    email: input.email.toLowerCase(),
    phone: input.phone || null,
    cover_note: input.coverNote || null,
    source_name: input.item.sourceName,
    request_fingerprint: fingerprint,
    consent_at: now,
    status_message: "Candidature reçue. Préparation du profil en cours.",
  }).select("id").single();
  if (applicationError || !application) {
    return Response.json({ message: "Votre candidature n’a pas pu être enregistrée. Réessayez." }, { status: 500 });
  }
  const { data: job, error: jobError } = await admin.from("ai_processing_jobs").insert({
    organisation_id: organisation.id,
    kind: "public_application",
    client_reference: queuedItem.clientId,
    source_name: queuedItem.sourceName,
    payload: { item: queuedItem, offerId: offer.id },
    created_by: offer.created_by,
    public_application_id: application.id,
  }).select("id").single();
  if (jobError || !job) {
    await admin.from("public_applications").update({ status: "failed", status_message: "La candidature est reçue, mais le CV doit être vérifié par l’équipe." }).eq("id", application.id);
    return Response.json({ message: "Votre candidature est enregistrée. L’équipe vérifiera votre CV manuellement." }, { status: 202 });
  }
  dispatchAiJobs([job.id]);
  return Response.json({ received: true, message: "Votre candidature a bien été envoyée." }, { status: 202 });
}
