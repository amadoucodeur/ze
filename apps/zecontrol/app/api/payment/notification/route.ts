import {
  fingerprintPayDunyaPayload,
  parsePayDunyaFormData,
  verifyPayDunyaHash,
  type PayDunyaInvoiceData,
} from "@/lib/billing/paydunya";
import { synchronizePayDunyaPayment } from "@/lib/billing/payments";

export const runtime = "nodejs";

async function readPayload(
  request: Request,
): Promise<PayDunyaInvoiceData | null> {
  const contentType =
    request.headers.get("content-type")?.toLowerCase() || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as {
      data?: unknown;
    } | null;
    const value = body?.data ?? body;
    return value && typeof value === "object"
      ? (value as PayDunyaInvoiceData)
      : null;
  }
  return parsePayDunyaFormData(await request.formData());
}

export async function POST(request: Request) {
  const payload = await readPayload(request).catch(() => null);
  if (!payload) {
    return Response.json({ received: false }, { status: 400 });
  }
  if (!verifyPayDunyaHash(payload.hash)) {
    console.warn("zecontrol_paydunya_ipn_rejected", {
      fingerprint: fingerprintPayDunyaPayload(payload),
    });
    return Response.json({ received: false }, { status: 401 });
  }

  const token = payload.invoice?.token;
  if (!token) {
    return Response.json({ received: false }, { status: 400 });
  }

  try {
    const result = await synchronizePayDunyaPayment(token);
    console.info("zecontrol_paydunya_ipn_processed", {
      token_suffix: token.slice(-8),
      status: result.status,
      applied: result.applied,
    });
    return Response.json({ received: true });
  } catch (error) {
    console.error("zecontrol_paydunya_ipn_failed", {
      token_suffix: token.slice(-8),
      error: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ received: false }, { status: 503 });
  }
}

