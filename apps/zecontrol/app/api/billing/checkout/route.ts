import { z } from "zod";
import { createBillingCheckout } from "@/lib/billing/payments";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";
import { applicationOrigin } from "@/lib/application-origin";

export const runtime = "nodejs";

const checkoutSchema = z.object({
  periodId: z.string().uuid(),
});

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).origin === applicationOrigin();
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json(
      { message: "Cette demande de paiement n’est pas autorisée." },
      { status: 403 },
    );
  }

  const access = await getCurrentZeControlAccess();
  if (!access) {
    return Response.json(
      { message: "Votre session a expiré. Reconnectez-vous." },
      { status: 401 },
    );
  }
  if (access.productProfile?.role !== "owner") {
    return Response.json(
      {
        message:
          "Seul le propriétaire peut régler les factures de l’organisation.",
      },
      { status: 403 },
    );
  }

  const parsed = checkoutSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { message: "Cette période de facturation est invalide." },
      { status: 400 },
    );
  }

  try {
    const result = await createBillingCheckout({
      access,
      periodId: parsed.data.periodId,
      fallbackOrigin: applicationOrigin(),
    });
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("zecontrol_billing_checkout_failed", {
      organisation_id: access.organisation?.id,
      period_id: parsed.data.periodId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return Response.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Le paiement n’a pas pu être préparé.",
      },
      { status: 502 },
    );
  }
}
