import { generateInterviewGuide } from "@/lib/offers/mammouth";
import { interviewGuideRequestSchema } from "@/lib/offers/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";
import { ZodError } from "zod";

export const maxDuration = 120;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  try { return Boolean(host) && new URL(origin).host === host; } catch { return false; }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ message: "Cette requête n’est pas autorisée." }, { status: 403 });
  const profile = await getCurrentProfile();
  if (!profile) return Response.json({ message: "Votre session a expiré. Reconnectez-vous." }, { status: 401 });
  if (!profile.organisation_id || profile.role === "viewer") return Response.json({ message: "Votre accès ne permet pas de préparer un entretien." }, { status: 403 });
  const parsed = interviewGuideRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "La candidature n’est pas valide." }, { status: 400 });

  const admin = createAdminClient();
  const { data: application } = await admin
    .from("candidatures")
    .select("id, stage, offre:offres(id, title, summary, mission, responsibilities, must_have_skills, nice_to_have_skills, languages, min_experience_months, success_outcomes, recruiter_intent), candidat:candidats(id, fullname, poste_type, summary, statut, localisation, skills(name, expertise, score, nb_month_of_experiance), languages(name, level), formations(name, institution_name, type))")
    .eq("id", parsed.data.candidatureId)
    .eq("organisation_id", profile.organisation_id)
    .maybeSingle();
  if (!application?.offre || !application.candidat) return Response.json({ message: "Cette candidature n’est plus disponible." }, { status: 404 });

  try {
    const guide = await generateInterviewGuide({ offer: application.offre as unknown as Record<string, unknown>, candidate: application.candidat as unknown as Record<string, unknown> });
    return Response.json({ guide });
  } catch (error) {
    const message = error instanceof ZodError || error instanceof SyntaxError
      ? "Le guide demande une nouvelle préparation. Réessayez dans un instant."
      : error instanceof Error ? error.message : "Le guide d’entretien n’a pas pu être préparé.";
    return Response.json({ message }, { status: 502 });
  }
}
