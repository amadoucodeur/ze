import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const runtime = "nodejs";

/**
 * What reminders need to know about the signed-in person. The role and the
 * organisation are read on the server because their columns are not exposed to
 * browser clients. Used by the page and by the Android app.
 */
export async function GET() {
  const access = await getCurrentZeControlAccess();
  if (!access) {
    return Response.json({ eligible: false }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const ready = access.status === "ready" && access.organisation && access.productProfile;
  return Response.json(
    {
      profileId: access.profile.id,
      eligible: Boolean(ready && access.productProfile?.role !== "owner"),
      timeZone: access.organisation?.timezone ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
