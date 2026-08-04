import "server-only";

import type { ZeControlContext } from "@/lib/supabase/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatBillingPeriod } from "@/lib/billing/pricing";
import {
  confirmPayDunyaCheckout,
  createPayDunyaCheckout,
  fingerprintPayDunyaPayload,
  normalizedPayDunyaStatus,
  verifyPayDunyaHash,
} from "@/lib/billing/paydunya";

type BillingPeriodRow = {
  id: string;
  organisation_id: string;
  period_starts_at: string;
  period_ends_at: string;
  unit_price: number;
  currency: "XOF";
  billable_user_count: number;
  amount_due: number;
  status: "open" | "closed" | "overdue" | "paid" | "void";
};

type PaymentRow = {
  id: string;
  internal_reference: string;
  organisation_id: string;
  period_id: string;
  initiated_by: string;
  provider_token: string | null;
  amount: number;
  status: string;
  checkout_url: string | null;
};

function cleanSiteUrl(fallbackOrigin?: string) {
  const normalizeOrigin = (value?: string) => {
    if (!value?.trim()) return null;
    try {
      const raw = value.trim();
      const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
      return url.origin;
    } catch {
      return null;
    }
  };
  const isPublicHttps = (value: string) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  };

  const requestOrigin = normalizeOrigin(fallbackOrigin);
  const configuredOrigin = normalizeOrigin(
    process.env.NEXT_PUBLIC_SITE_URL,
  );
  const vercelProductionOrigin = normalizeOrigin(
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  );
  const vercelDeploymentOrigin = normalizeOrigin(process.env.VERCEL_URL);
  const candidates = [
    requestOrigin,
    configuredOrigin,
    vercelProductionOrigin,
    vercelDeploymentOrigin,
  ].filter((value): value is string => Boolean(value));

  if (process.env.PAYDUNYA_MODE === "production") {
    const publicOrigin = candidates.find(isPublicHttps);
    if (publicOrigin) return publicOrigin;
    throw new Error(
      "Le paiement PayDunya en production doit être lancé depuis l’adresse HTTPS publique de ZeControl.",
    );
  }

  return candidates[0] ?? "http://localhost:3001";
}

function assertOwnerAccess(
  access: ZeControlContext | null,
): asserts access is ZeControlContext & {
  organisation: NonNullable<ZeControlContext["organisation"]>;
  productProfile: NonNullable<ZeControlContext["productProfile"]>;
} {
  if (
    !access ||
    access.status !== "ready" ||
    !access.organisation ||
    !access.productProfile ||
    access.productProfile.role !== "owner"
  ) {
    throw new Error(
      "Seul le propriétaire peut gérer la facturation ZeControl.",
    );
  }
}

export async function createBillingCheckout(input: {
  access: ZeControlContext | null;
  periodId: string;
  fallbackOrigin?: string;
}) {
  assertOwnerAccess(input.access);
  const access = input.access;
  const admin = createAdminClient();

  await admin
    .schema("zecontrol")
    .rpc("finalize_due_billing_periods", {
      target_organisation_id: access.organisation.id,
    });

  const { data: period, error: periodError } = await admin
    .schema("zecontrol")
    .from("billing_periods")
    .select(
      "id, organisation_id, period_starts_at, period_ends_at, unit_price, currency, billable_user_count, amount_due, status",
    )
    .eq("id", input.periodId)
    .eq("organisation_id", access.organisation.id)
    .maybeSingle();

  if (periodError || !period) {
    throw new Error("Cette facture est introuvable.");
  }
  const typedPeriod = period as BillingPeriodRow;
  if (!["closed", "overdue"].includes(typedPeriod.status)) {
    throw new Error(
      typedPeriod.status === "paid"
        ? "Cette facture est déjà réglée."
        : "La période doit être terminée avant son règlement.",
    );
  }
  if (
    typedPeriod.amount_due <= 0 ||
    typedPeriod.billable_user_count <= 0
  ) {
    throw new Error("Cette période ne contient rien à régler.");
  }

  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: reusable } = await admin
    .schema("zecontrol")
    .from("billing_payments")
    .select(
      "id, internal_reference, organisation_id, period_id, initiated_by, provider_token, amount, status, checkout_url",
    )
    .eq("period_id", typedPeriod.id)
    .eq("amount", typedPeriod.amount_due)
    .eq("status", "pending")
    .gte("created_at", tenMinutesAgo)
    .not("checkout_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reusable?.checkout_url) {
    return { checkoutUrl: reusable.checkout_url, reused: true };
  }

  const siteUrl = cleanSiteUrl(input.fallbackOrigin);
  const internalReference = crypto.randomUUID();
  const { data: payment, error: insertError } = await admin
    .schema("zecontrol")
    .from("billing_payments")
    .insert({
      internal_reference: internalReference,
      organisation_id: access.organisation.id,
      period_id: typedPeriod.id,
      initiated_by: access.profile.id,
      amount: typedPeriod.amount_due,
      currency: typedPeriod.currency,
      status: "initiated",
      metadata: {
        user_count: typedPeriod.billable_user_count,
        unit_price: typedPeriod.unit_price,
      },
    })
    .select(
      "id, internal_reference, organisation_id, period_id, initiated_by, provider_token, amount, status, checkout_url",
    )
    .single();
  if (insertError || !payment) {
    throw new Error(
      "Le paiement n’a pas pu être préparé. Réessayez.",
    );
  }

  try {
    const checkout = await createPayDunyaCheckout({
      amount: typedPeriod.amount_due,
      unitPrice: typedPeriod.unit_price,
      userCount: typedPeriod.billable_user_count,
      periodLabel: formatBillingPeriod(
        typedPeriod.period_starts_at,
        typedPeriod.period_ends_at,
      ),
      periodId: typedPeriod.id,
      internalReference,
      organisationId: access.organisation.id,
      organisationName: access.organisation.name,
      customer: {
        name: access.profile.fullname,
        email: access.profile.email,
        phone: access.profile.phone,
      },
      callbackUrl: `${siteUrl}/api/payment/notification`,
      returnUrl: `${siteUrl}/dashboard/facturation/retour`,
      cancelUrl: `${siteUrl}/dashboard/facturation?payment=cancelled`,
    });

    const { error: updateError } = await admin
      .schema("zecontrol")
      .from("billing_payments")
      .update({
        provider_token: checkout.token,
        checkout_url: checkout.checkoutUrl,
        provider_response_code: checkout.responseCode,
        provider_response_text: checkout.responseText,
        status: "pending",
        metadata: {
          user_count: typedPeriod.billable_user_count,
          unit_price: typedPeriod.unit_price,
          paydunya_mode: checkout.mode,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.id)
      .eq("status", "initiated");
    if (updateError) {
      throw new Error(
        "La facture a été créée mais n’a pas pu être enregistrée.",
      );
    }
    return { checkoutUrl: checkout.checkoutUrl, reused: false };
  } catch (error) {
    await admin
      .schema("zecontrol")
      .from("billing_payments")
      .update({
        status: "error",
        provider_response_text:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Erreur PayDunya",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.id);
    throw error;
  }
}

export type PaymentSyncResult = {
  status: "completed" | "pending" | "cancelled" | "failed";
  applied: boolean;
  amount: number;
  periodId: string;
  receiptUrl: string | null;
};

export async function synchronizePayDunyaPayment(
  token: string,
  expectedOrganisationId?: string,
): Promise<PaymentSyncResult> {
  if (!token || token.length > 180) {
    throw new Error("La référence de paiement est invalide.");
  }
  const admin = createAdminClient();
  const { data: payment, error: paymentError } = await admin
    .schema("zecontrol")
    .from("billing_payments")
    .select(
      "id, internal_reference, organisation_id, period_id, initiated_by, provider_token, amount, status, checkout_url",
    )
    .eq("provider", "paydunya")
    .eq("provider_token", token)
    .maybeSingle();
  if (paymentError || !payment) {
    throw new Error("Ce paiement est introuvable.");
  }
  const typedPayment = payment as PaymentRow;
  if (
    expectedOrganisationId &&
    typedPayment.organisation_id !== expectedOrganisationId
  ) {
    throw new Error(
      "Ce paiement n’appartient pas à votre organisation.",
    );
  }

  const confirmation = await confirmPayDunyaCheckout(token);
  if (confirmation.response_code !== "00") {
    throw new Error("PayDunya ne reconnaît pas encore ce paiement.");
  }
  if (!verifyPayDunyaHash(confirmation.hash)) {
    throw new Error(
      "La confirmation PayDunya n’a pas pu être authentifiée.",
    );
  }

  const confirmedToken = confirmation.invoice?.token || token;
  if (confirmedToken !== token) {
    throw new Error(
      "La référence confirmée ne correspond pas au paiement.",
    );
  }
  const confirmedAmount = Number(confirmation.invoice?.total_amount);
  if (
    !Number.isInteger(confirmedAmount) ||
    confirmedAmount !== typedPayment.amount
  ) {
    throw new Error(
      "Le montant confirmé ne correspond pas à la facture ZeControl.",
    );
  }
  const customReference = confirmation.custom_data?.payment_reference;
  if (
    customReference !== undefined &&
    String(customReference) !== typedPayment.internal_reference
  ) {
    throw new Error(
      "La facture confirmée ne correspond pas à cette demande.",
    );
  }
  const customPeriod = confirmation.custom_data?.billing_period_id;
  if (
    customPeriod !== undefined &&
    String(customPeriod) !== typedPayment.period_id
  ) {
    throw new Error(
      "La période confirmée ne correspond pas à cette facture.",
    );
  }

  const status = normalizedPayDunyaStatus(confirmation.status);
  const receiptUrl =
    typeof confirmation.receipt_url === "string"
      ? confirmation.receipt_url
      : null;
  const fingerprint = fingerprintPayDunyaPayload(confirmation);

  if (status === "completed") {
    const { data, error } = await admin
      .schema("zecontrol")
      .rpc("apply_completed_paydunya_payment", {
        target_token: token,
        confirmed_amount: confirmedAmount,
        confirmed_receipt_url: receiptUrl,
        confirmed_payload_fingerprint: fingerprint,
      });
    if (error) {
      throw new Error(
        "Le paiement est confirmé, mais la facture n’a pas encore pu être soldée.",
      );
    }
    const result = Array.isArray(data) ? data[0] : data;
    return {
      status,
      applied: Boolean(result?.applied),
      amount: typedPayment.amount,
      periodId: typedPayment.period_id,
      receiptUrl,
    };
  }

  await admin
    .schema("zecontrol")
    .from("billing_payments")
    .update({
      status,
      provider_status: confirmation.status || status,
      provider_response_code: confirmation.response_code || null,
      provider_response_text:
        confirmation.response_text || confirmation.fail_reason || null,
      receipt_url: receiptUrl,
      last_verified_at: new Date().toISOString(),
      payload_fingerprint: fingerprint,
      updated_at: new Date().toISOString(),
    })
    .eq("id", typedPayment.id)
    .neq("status", "completed");

  return {
    status,
    applied: false,
    amount: typedPayment.amount,
    periodId: typedPayment.period_id,
    receiptUrl,
  };
}
