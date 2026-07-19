import { createEmbeddings } from "@/lib/cv/mammouth";
import { finalizeCandidateIndexing, markCandidateIndexingFailed } from "@/lib/cv/persistence";
import type { CvEmbeddingChunk } from "@/lib/cv/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const maxDuration = 180;

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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ message: "Cette requête n’est pas autorisée." }, { status: 403 });
  const profile = await getCurrentProfile();
  if (!profile) return Response.json({ message: "Votre session a expiré. Reconnectez-vous." }, { status: 401 });
  if (!profile.organisation_id || profile.role === "viewer" || profile.organisation?.status !== "active") {
    return Response.json({ message: "Votre rôle ne permet pas de relancer cette préparation." }, { status: 403 });
  }

  const { id } = await params;
  const admin = createAdminClient();
  const { data: candidate } = await admin
    .from("candidats")
    .select("id")
    .eq("id", id)
    .eq("organisation_id", profile.organisation_id)
    .maybeSingle();
  if (!candidate) return Response.json({ message: "Ce profil est introuvable dans votre organisation." }, { status: 404 });

  const { data, error } = await admin
    .from("section_chunks")
    .select("content, type")
    .eq("candidat_id", id)
    .eq("organisation_id", profile.organisation_id);
  if (error || !data?.length) {
    return Response.json({ message: "Aucun contenu professionnel n’est disponible pour relancer la recherche." }, { status: 409 });
  }

  const chunks = data as CvEmbeddingChunk[];
  try {
    const startedAt = Date.now();
    const embeddings = await createEmbeddings(chunks.map((chunk) => chunk.content));
    await finalizeCandidateIndexing({
      candidateId: id,
      organisationId: profile.organisation_id,
      chunks,
      chunkEmbeddings: embeddings,
      analysisMetrics: { embeddingDurationMs: Date.now() - startedAt, chunkCount: chunks.length },
    });
    return Response.json({ candidateId: id, status: "ready" });
  } catch {
    await markCandidateIndexingFailed(id, profile.organisation_id).catch(() => undefined);
    return Response.json({ message: "La préparation pour la recherche n’a pas abouti. Réessayez dans un instant." }, { status: 502 });
  }
}
