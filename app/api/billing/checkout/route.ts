import { z } from "zod";
import { createBillingCheckout } from "@/lib/billing/payments";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const runtime = "nodejs";

const checkoutSchema = z.object({
  plan: z.enum(["essential", "team"]),
  cycle: z.enum(["month", "year"]),
});

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ message: "Cette demande de paiement n’est pas autorisée." }, { status: 403 });
  }
  const profile = await getCurrentProfile();
  if (!profile) return Response.json({ message: "Votre session a expiré. Reconnectez-vous." }, { status: 401 });
  if (profile.role !== "owner") {
    return Response.json({ message: "Seul le propriétaire peut changer le plan de l’organisation." }, { status: 403 });
  }
  if (!profile.organisation_id || !profile.organisation) {
    return Response.json({ message: "Créez votre organisation avant de choisir un plan." }, { status: 409 });
  }

  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "Choisissez un plan et une période valides." }, { status: 400 });

  try {
    const result = await createBillingCheckout({
      profile,
      planCode: parsed.data.plan,
      cycle: parsed.data.cycle,
      fallbackOrigin: new URL(request.url).origin,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("billing_checkout_failed", {
      organisation_id: profile.organisation_id,
      plan: parsed.data.plan,
      cycle: parsed.data.cycle,
      error: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({
      message: error instanceof Error ? error.message : "Le paiement n’a pas pu être préparé. Réessayez.",
    }, { status: 502 });
  }
}
