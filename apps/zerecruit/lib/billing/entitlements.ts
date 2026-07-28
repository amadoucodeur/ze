import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrentOrganisation } from "@/lib/supabase/current-profile";
import { getPlan, hasActivePlanAccess } from "@/lib/billing/plans";

export type PlanUsage = {
  seats: number;
  candidates: number;
  activeOffers: number;
  offerMatchings: number;
};

export type CapacityResult = {
  allowed: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
  reason: "inactive" | "limit" | null;
};

function capacity(active: boolean, used: number, limit: number | null, requested = 1): CapacityResult {
  if (!active) return { allowed: false, used, limit, remaining: limit === null ? null : Math.max(0, limit - used), reason: "inactive" };
  const remaining = limit === null ? null : Math.max(0, limit - used);
  return { allowed: remaining === null || remaining >= requested, used, limit, remaining, reason: remaining !== null && remaining < requested ? "limit" : null };
}

export async function getPlanUsage(organisationId: string): Promise<PlanUsage> {
  const admin = createAdminClient();
  const [seats, candidates, activeOffers, offerMatchings] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("is_active", true).eq("zerecruit_access", true),
    admin.from("candidats").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).is("archived_at", null),
    admin.from("offres").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).neq("status", "closed"),
    admin.from("plan_usage_events").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("metric", "offer_matching"),
  ]);
  return {
    seats: seats.count ?? 0,
    candidates: candidates.count ?? 0,
    activeOffers: activeOffers.count ?? 0,
    offerMatchings: offerMatchings.count ?? 0,
  };
}

export async function getCandidateCapacity(organisation: CurrentOrganisation, requested = 1) {
  const plan = getPlan(organisation.plan);
  const admin = createAdminClient();
  const { count } = await admin.from("candidats").select("id", { count: "exact", head: true })
    .eq("organisation_id", organisation.id).is("archived_at", null);
  return capacity(hasActivePlanAccess(organisation), count ?? 0, plan.candidateLimit, requested);
}

export async function getSeatCapacity(organisation: CurrentOrganisation, requested = 1) {
  const plan = getPlan(organisation.plan);
  const admin = createAdminClient();
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true })
    .eq("organisation_id", organisation.id).eq("is_active", true).eq("zerecruit_access", true);
  return capacity(hasActivePlanAccess(organisation), count ?? 0, plan.seatLimit, requested);
}

export async function getActiveOfferCapacity(organisation: CurrentOrganisation, requested = 1) {
  const plan = getPlan(organisation.plan);
  const admin = createAdminClient();
  const { count } = await admin.from("offres").select("id", { count: "exact", head: true })
    .eq("organisation_id", organisation.id).neq("status", "closed");
  return capacity(hasActivePlanAccess(organisation), count ?? 0, plan.activeOfferLimit, requested);
}

type UsageReservation = { allowed: boolean; eventId: string | null; remaining: number | null };

export async function reserveOfferMatching(organisation: CurrentOrganisation, offerId: string): Promise<UsageReservation> {
  if (!hasActivePlanAccess(organisation)) return { allowed: false, eventId: null, remaining: 0 };
  const plan = getPlan(organisation.plan);
  if (plan.offerMatchingLimit === null) return { allowed: true, eventId: null, remaining: null };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_plan_usage", {
    target_organisation_id: organisation.id,
    target_metric: "offer_matching",
    target_context: { offer_id: offerId },
  });
  if (error) throw new Error("Le quota de matching n’a pas pu être vérifié. Réessayez.");
  const result = Array.isArray(data) ? data[0] : data;
  return {
    allowed: Boolean(result?.allowed),
    eventId: typeof result?.event_id === "string" ? result.event_id : null,
    remaining: typeof result?.remaining === "number" ? result.remaining : null,
  };
}

export async function releaseUsageReservation(eventId: string | null) {
  if (!eventId) return;
  const admin = createAdminClient();
  await admin.rpc("release_plan_usage", { target_event_id: eventId });
}
