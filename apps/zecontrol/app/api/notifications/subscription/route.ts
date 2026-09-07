import { z } from "zod";
import { applicationOrigin } from "@/lib/application-origin";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2_048).refine(
    (value) => value.startsWith("https://"),
    "L’adresse Push doit être sécurisée.",
  ),
  expirationTime: z.number().finite().positive().nullable(),
  keys: z.object({
    auth: z.string().min(8).max(512),
    p256dh: z.string().min(16).max(512),
  }),
});

const removalSchema = z.object({
  endpoint: z.string().url().max(2_048),
  auth: z.string().min(8).max(512),
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

export async function GET() {
  return Response.json(
    { publicKey: process.env.VAPID_PUBLIC_KEY?.trim() || null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ message: "Demande non autorisée." }, { status: 403 });
  }
  const access = await getCurrentZeControlAccess();
  if (
    access?.status !== "ready" ||
    !access.organisation ||
    !access.productProfile ||
    access.productProfile.role === "owner"
  ) {
    return Response.json({ message: "Accès refusé." }, { status: 403 });
  }
  const parsed = subscriptionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ message: "Abonnement Push invalide." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .schema("zecontrol")
    .from("push_subscriptions")
    .upsert(
      {
        profile_id: access.profile.id,
        organisation_id: access.organisation.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth_key: parsed.data.keys.auth,
        expires_at: parsed.data.expirationTime
          ? new Date(parsed.data.expirationTime).toISOString()
          : null,
        user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
  if (error) {
    console.error("zecontrol_push_subscription_save_failed", {
      profile_id: access.profile.id,
      code: error.code,
    });
    return Response.json(
      { message: "L’abonnement n’a pas pu être enregistré." },
      { status: 503 },
    );
  }
  return Response.json({ subscribed: true });
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ message: "Demande non autorisée." }, { status: 403 });
  }
  const parsed = removalSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ message: "Abonnement Push invalide." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .schema("zecontrol")
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", parsed.data.endpoint)
    .eq("auth_key", parsed.data.auth);
  if (error) {
    console.error("zecontrol_push_subscription_remove_failed", {
      code: error.code,
    });
    return Response.json(
      { message: "L’abonnement n’a pas pu être supprimé." },
      { status: 503 },
    );
  }
  return Response.json({ subscribed: false });
}
