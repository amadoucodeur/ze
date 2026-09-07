import { timingSafeEqual } from "node:crypto";
import { dispatchDueNotifications } from "@/lib/notifications/push-dispatcher";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.NOTIFICATION_DISPATCH_SECRET?.trim();
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const received = authorization.slice(7);
  const expectedBuffer = Buffer.from(secret);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ processed: false }, { status: 401 });
  }
  try {
    const result = await dispatchDueNotifications();
    console.info("zecontrol_notification_dispatch_complete", result);
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("zecontrol_notification_dispatch_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ processed: false }, { status: 503 });
  }
}
