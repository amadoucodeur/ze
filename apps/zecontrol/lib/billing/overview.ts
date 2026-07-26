import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type BillingPeriod = {
  id: string;
  period_starts_at: string;
  period_ends_at: string;
  unit_price: number;
  currency: "XOF";
  billable_user_count: number;
  amount_due: number;
  status: "open" | "closed" | "overdue" | "paid" | "void";
  due_at: string | null;
  paid_at: string | null;
};

export type BillingUsage = {
  id: string;
  period_id: string;
  profile_id: string;
  first_event_id: string | null;
  first_qualified_at: string;
  source_pointed_at: string;
  source_kind: string;
  unit_price: number;
  fullname: string;
  identifiant: string;
};

export type BillingPayment = {
  id: string;
  period_id: string;
  amount: number;
  currency: "XOF";
  status: string;
  receipt_url: string | null;
  created_at: string;
  paid_at: string | null;
};

export async function getBillingOverview(organisationId: string) {
  const admin = createAdminClient();
  const { error: finalizeError } = await admin
    .schema("zecontrol")
    .rpc("finalize_due_billing_periods", {
      target_organisation_id: organisationId,
    });
  if (finalizeError) {
    throw new Error(
      "La facturation ZeControl n’est pas encore disponible. Appliquez la migration la plus récente.",
    );
  }

  const [accountResult, periodsResult, paymentsResult] = await Promise.all([
    admin
      .schema("zecontrol")
      .from("billing_accounts")
      .select("status")
      .eq("organisation_id", organisationId)
      .single(),
    admin
      .schema("zecontrol")
      .from("billing_periods")
      .select(
        "id, period_starts_at, period_ends_at, unit_price, currency, billable_user_count, amount_due, status, due_at, paid_at",
      )
      .eq("organisation_id", organisationId)
      .order("period_starts_at", { ascending: false })
      .limit(13),
    admin
      .schema("zecontrol")
      .from("billing_payments")
      .select(
        "id, period_id, amount, currency, status, receipt_url, created_at, paid_at",
      )
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (
    accountResult.error ||
    periodsResult.error ||
    paymentsResult.error
  ) {
    throw new Error(
      "Les informations de facturation ne sont pas accessibles.",
    );
  }

  const periods = (periodsResult.data ?? []) as BillingPeriod[];
  const periodIds = periods.map((period) => period.id);
  let usage: BillingUsage[] = [];

  if (periodIds.length) {
    const { data: usageRows, error: usageError } = await admin
      .schema("zecontrol")
      .from("billing_usage")
      .select(
        "id, period_id, profile_id, first_event_id, first_qualified_at, source_pointed_at, source_kind, unit_price",
      )
      .in("period_id", periodIds)
      .order("first_qualified_at", { ascending: true });
    if (usageError) {
      throw new Error(
        "Le détail des consommations n’est pas accessible.",
      );
    }

    const typedUsage = (usageRows ?? []) as Omit<
      BillingUsage,
      "fullname" | "identifiant"
    >[];
    const profileIds = [...new Set(typedUsage.map((row) => row.profile_id))];
    const { data: profiles, error: profilesError } = profileIds.length
      ? await admin
          .from("profiles")
          .select("id, fullname, identifiant")
          .in("id", profileIds)
      : { data: [], error: null };
    if (profilesError) {
      throw new Error(
        "Les collaborateurs facturés ne sont pas accessibles.",
      );
    }
    const profileMap = new Map(
      (profiles ?? []).map((profile) => [profile.id, profile]),
    );
    usage = typedUsage.map((row) => ({
      ...row,
      fullname:
        profileMap.get(row.profile_id)?.fullname ?? "Collaborateur",
      identifiant:
        profileMap.get(row.profile_id)?.identifiant ?? "Compte ZeControl",
    }));
  }

  return {
    accountStatus: accountResult.data.status as
      | "active"
      | "past_due"
      | "suspended",
    periods,
    usage,
    payments: (paymentsResult.data ?? []) as BillingPayment[],
  };
}

