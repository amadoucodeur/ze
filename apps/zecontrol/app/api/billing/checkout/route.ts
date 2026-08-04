import { z } from "zod";
import { createBillingCheckout } from "@/lib/billing/payments";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const runtime = "nodejs";

const checkoutSchema = z.object({
  periodId: z.string().uuid(),
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

function requestOrigin(request: Request) {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  if (
    forwardedHost &&
    (forwardedProtocol === "https" || forwardedProtocol === "http")
  ) {
    try {
      return new URL(`${forwardedProtocol}://${forwardedHost}`).origin;
    } catch {
      // Fall through to the URL normalized by Next.js.
    }
  }
  return new URL(request.url).origin;
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
      fallbackOrigin: requestOrigin(request),
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
