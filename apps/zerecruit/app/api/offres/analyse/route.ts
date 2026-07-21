import { analyseOffer } from "@/lib/offers/mammouth";
import { offerAnalysisRequestSchema } from "@/lib/offers/schema";
import { getCurrentProfile } from "@/lib/supabase/current-profile";
import { hasActivePlanAccess } from "@/lib/billing/plans";
import { getActiveOfferCapacity } from "@/lib/billing/entitlements";
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
  if (!profile.organisation_id || profile.organisation?.status !== "active" || profile.role === "viewer") {
    return Response.json({ message: "Votre accès ne permet pas de créer une offre." }, { status: 403 });
  }
  if (!profile.organisation || !hasActivePlanAccess(profile.organisation)) return Response.json({ message: "Renouvelez le plan de l’organisation pour analyser une nouvelle offre." }, { status: 402 });
  const offerCapacity = await getActiveOfferCapacity(profile.organisation);
  if (!offerCapacity.allowed) return Response.json({ message: "Le plan Free permet un recrutement actif. Clôturez l’offre actuelle ou passez à Essentiel pour en créer une autre." }, { status: 402 });
  const parsed = offerAnalysisRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Le contenu de l’offre n’est pas valide." }, { status: 400 });
  try {
    return Response.json({ analysis: await analyseOffer(parsed.data) });
  } catch (error) {
    const message = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      ? "L’analyse demande plus de temps que prévu. Vos informations sont conservées : réessayez simplement."
      : error instanceof ZodError || error instanceof SyntaxError
        ? "La première lecture n’a pas produit une fiche exploitable. Réessayez : vos informations sont conservées."
      : error instanceof Error ? error.message : "L’analyse de l’offre n’a pas pu aboutir.";
    return Response.json({ message }, { status: 502 });
  }
}
