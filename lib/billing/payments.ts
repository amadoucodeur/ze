import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrentProfile } from "@/lib/supabase/current-profile";
import {
  type BillingCycle,
  type PaidPlanCode,
  getPaidPlan,
  getPlanPrice,
} from "@/lib/billing/plans";
import {
  confirmPayDunyaCheckout,
  createPayDunyaCheckout,
  fingerprintPayDunyaPayload,
  normalizedPayDunyaStatus,
  verifyPayDunyaHash,
} from "@/lib/billing/paydunya";

type PaymentRow = {
  id: string;
  internal_reference: string;
  organisation_id: string;
  initiated_by: string;
  provider_token: string | null;
  plan_code: PaidPlanCode;
  billing_cycle: BillingCycle;
  amount: number;
  status: string;
  checkout_url: string | null;
};

function cleanSiteUrl(fallbackOrigin?: string) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const value = configured || fallbackOrigin || "http://localhost:3000";
  const url = new URL(value);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SITE_URL doit utiliser HTTPS en production.");
  }
  return url.origin;
}

export async function createBillingCheckout(input: {
  profile: CurrentProfile;
  planCode: string;
  cycle: BillingCycle;
  fallbackOrigin?: string;
}) {
  const { profile, cycle } = input;
  if (profile.role !== "owner" || !profile.organisation_id || !profile.organisation) {
    throw new Error("Seul le propriétaire peut gérer l’abonnement.");
  }
  const plan = getPaidPlan(input.planCode);
  if (!plan || (plan.code !== "essential" && plan.code !== "team")) {
    throw new Error("Choisissez un plan disponible au paiement en ligne.");
  }
  const amount = getPlanPrice(plan, cycle);
  if (!amount || amount <= 0) throw new Error("Le prix de ce plan n’est pas disponible.");

  const admin = createAdminClient();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: reusable } = await admin
    .from("billing_payments")
    .select("id, internal_reference, organisation_id, initiated_by, provider_token, plan_code, billing_cycle, amount, status, checkout_url")
    .eq("organisation_id", profile.organisation_id)
    .eq("plan_code", plan.code)
    .eq("billing_cycle", cycle)
    .eq("amount", amount)
    .eq("status", "pending")
    .gte("created_at", tenMinutesAgo)
    .not("checkout_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reusable?.checkout_url) return { checkoutUrl: reusable.checkout_url, reused: true };

  const internalReference = crypto.randomUUID();
  const { data: payment, error: insertError } = await admin
    .from("billing_payments")
    .insert({
      internal_reference: internalReference,
      organisation_id: profile.organisation_id,
      initiated_by: profile.id,
      plan_code: plan.code,
      billing_cycle: cycle,
      amount,
      currency: "XOF",
      status: "initiated",
      metadata: { plan_name: plan.name },
    })
    .select("id, internal_reference, organisation_id, initiated_by, provider_token, plan_code, billing_cycle, amount, status, checkout_url")
    .single();
  if (insertError || !payment) throw new Error("Le paiement n’a pas pu être préparé. Réessayez.");

  const siteUrl = cleanSiteUrl(input.fallbackOrigin);
  try {
    const checkout = await createPayDunyaCheckout({
      amount,
      plan: plan.code,
      planName: plan.name,
      cycle,
      internalReference,
      organisationId: profile.organisation_id,
      organisationName: profile.organisation.name,
      customer: { name: profile.fullname, email: profile.email, phone: profile.phone },
      callbackUrl: `${siteUrl}/api/payment/notification`,
      returnUrl: `${siteUrl}/dashboard/abonnement/retour`,
      cancelUrl: `${siteUrl}/dashboard/abonnement?payment=cancelled`,
    });
    const { error: updateError } = await admin.from("billing_payments").update({
      provider_token: checkout.token,
      checkout_url: checkout.checkoutUrl,
      provider_response_code: checkout.responseCode,
      provider_response_text: checkout.responseText,
      status: "pending",
      metadata: { plan_name: plan.name, paydunya_mode: checkout.mode },
      updated_at: new Date().toISOString(),
    }).eq("id", payment.id).eq("status", "initiated");
    if (updateError) throw new Error("La facture a été créée mais n’a pas pu être enregistrée.");
    return { checkoutUrl: checkout.checkoutUrl, reused: false };
  } catch (error) {
    await admin.from("billing_payments").update({
      status: "error",
      provider_response_text: error instanceof Error ? error.message.slice(0, 500) : "Erreur PayDunya",
      updated_at: new Date().toISOString(),
    }).eq("id", payment.id);
    throw error;
  }
}

export type PaymentSyncResult = {
  status: "completed" | "pending" | "cancelled" | "failed";
  applied: boolean;
  planCode: PaidPlanCode;
  cycle: BillingCycle;
  amount: number;
  receiptUrl: string | null;
  periodEndsAt: string | null;
};

export async function synchronizePayDunyaPayment(token: string, expectedOrganisationId?: string): Promise<PaymentSyncResult> {
  if (!token || token.length > 180) throw new Error("La référence de paiement est invalide.");
  const admin = createAdminClient();
  const { data: payment, error: paymentError } = await admin
    .from("billing_payments")
    .select("id, internal_reference, organisation_id, initiated_by, provider_token, plan_code, billing_cycle, amount, status, checkout_url")
    .eq("provider", "paydunya")
    .eq("provider_token", token)
    .maybeSingle();
  if (paymentError || !payment) throw new Error("Ce paiement est introuvable.");
  const typedPayment = payment as PaymentRow;
  if (expectedOrganisationId && typedPayment.organisation_id !== expectedOrganisationId) {
    throw new Error("Ce paiement n’appartient pas à votre organisation.");
  }

  const confirmation = await confirmPayDunyaCheckout(token);
  if (confirmation.response_code !== "00") throw new Error("PayDunya ne reconnaît pas encore ce paiement.");
  if (!verifyPayDunyaHash(confirmation.hash)) throw new Error("La confirmation PayDunya n’a pas pu être authentifiée.");

  const confirmedToken = confirmation.invoice?.token || token;
  if (confirmedToken !== token) throw new Error("La référence confirmée ne correspond pas au paiement.");
  const confirmedAmount = Number(confirmation.invoice?.total_amount);
  if (!Number.isInteger(confirmedAmount) || confirmedAmount !== typedPayment.amount) {
    throw new Error("Le montant confirmé ne correspond pas à la facture ZeRecruit.");
  }
  const customReference = confirmation.custom_data?.payment_reference;
  if (customReference !== undefined && String(customReference) !== typedPayment.internal_reference) {
    throw new Error("La facture confirmée ne correspond pas à cette demande.");
  }

  const status = normalizedPayDunyaStatus(confirmation.status);
  const receiptUrl = typeof confirmation.receipt_url === "string" ? confirmation.receipt_url : null;
  const fingerprint = fingerprintPayDunyaPayload(confirmation);
  if (status === "completed") {
    const { data, error } = await admin.rpc("apply_completed_paydunya_payment", {
      target_token: token,
      confirmed_amount: confirmedAmount,
      confirmed_receipt_url: receiptUrl,
      confirmed_payload_fingerprint: fingerprint,
    });
    if (error) throw new Error("Le paiement est confirmé, mais le plan n’a pas encore pu être activé.");
    const result = Array.isArray(data) ? data[0] : data;
    if (result?.applied) {
      await admin.from("product_events").insert({
        organisation_id: typedPayment.organisation_id,
        actor_id: typedPayment.initiated_by,
        event_name: "billing_payment_completed",
        properties: { plan_code: typedPayment.plan_code, billing_cycle: typedPayment.billing_cycle, amount: typedPayment.amount, provider_status: status },
      });
    }
    return {
      status,
      applied: Boolean(result?.applied),
      planCode: typedPayment.plan_code,
      cycle: typedPayment.billing_cycle,
      amount: typedPayment.amount,
      receiptUrl,
      periodEndsAt: typeof result?.subscription_ends_at === "string" ? result.subscription_ends_at : null,
    };
  }

  await admin.from("billing_payments").update({
    status,
    provider_status: confirmation.status || status,
    provider_response_code: confirmation.response_code || null,
    provider_response_text: confirmation.response_text || confirmation.fail_reason || null,
    receipt_url: receiptUrl,
    last_verified_at: new Date().toISOString(),
    payload_fingerprint: fingerprint,
    updated_at: new Date().toISOString(),
  }).eq("id", typedPayment.id).neq("status", "completed");

  return {
    status,
    applied: false,
    planCode: typedPayment.plan_code,
    cycle: typedPayment.billing_cycle,
    amount: typedPayment.amount,
    receiptUrl,
    periodEndsAt: null,
  };
}
