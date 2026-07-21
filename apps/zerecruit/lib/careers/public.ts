import "server-only";
import { unstable_cache } from "next/cache";
import { hasActivePlanAccess } from "@/lib/billing/plans";
import { createAdminClient } from "@/lib/supabase/admin";

export type PublicCareerOrganisation = {
  id: string;
  name: string;
  identifiant: string;
  description: string | null;
  website_url: string | null;
};

export type PublicCareerOffer = {
  id: string;
  public_slug: string;
  title: string;
  department: string | null;
  contract_type: string | null;
  work_mode: string | null;
  location: string | null;
  summary: string | null;
  mission: string | null;
  responsibilities: string[];
  must_have_skills: string[];
  nice_to_have_skills: string[];
  success_outcomes: string[];
  published_at: string;
};

export type PublicCareerDirectoryOffer = PublicCareerOffer & {
  organisation_name: string;
  organisation_identifier: string;
};

const getCachedPublicCareerOrganisation = unstable_cache(async (identifier: string) => {
  const admin = createAdminClient();
  const { data } = await admin.from("organisations")
    .select("id, name, identifiant, description, website_url, plan, trial_ends_at, plan_expires_at, billing_status, status")
    .eq("identifiant", identifier)
    .eq("status", "active")
    .maybeSingle();
  if (!data || !hasActivePlanAccess(data)) return null;
  return data as PublicCareerOrganisation & typeof data;
}, ["public-career-organisation-v1"], { revalidate: 60, tags: ["public-careers"] });

export async function getPublicCareerOrganisation(identifier: string) {
  return getCachedPublicCareerOrganisation(identifier);
}

const getCachedPublicCareerOffers = unstable_cache(async (organisationId: string) => {
  const admin = createAdminClient();
  const { data } = await admin.from("offres")
    .select("id, public_slug, title, department, contract_type, work_mode, location, summary, mission, responsibilities, must_have_skills, nice_to_have_skills, success_outcomes, published_at")
    .eq("organisation_id", organisationId)
    .eq("status", "open")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false });
  return (data || []) as PublicCareerOffer[];
}, ["public-career-offers-v1"], { revalidate: 60, tags: ["public-careers"] });

export async function getPublicCareerOffers(organisationId: string) {
  return getCachedPublicCareerOffers(organisationId);
}

const getCachedPublicCareerOffer = unstable_cache(async (organisationId: string, slug: string) => {
  const admin = createAdminClient();
  const { data } = await admin.from("offres")
    .select("id, public_slug, title, department, contract_type, work_mode, location, summary, mission, responsibilities, must_have_skills, nice_to_have_skills, success_outcomes, published_at")
    .eq("organisation_id", organisationId)
    .eq("public_slug", slug)
    .eq("status", "open")
    .not("published_at", "is", null)
    .maybeSingle();
  return data as PublicCareerOffer | null;
}, ["public-career-offer-v1"], { revalidate: 60, tags: ["public-careers"] });

export async function getPublicCareerOffer(organisationId: string, slug: string) {
  return getCachedPublicCareerOffer(organisationId, slug);
}

const getCachedPublicCareerDirectoryOffers = unstable_cache(async () => {
  const admin = createAdminClient();
  const { data: organisations, error: organisationError } = await admin.from("organisations")
    .select("id, name, identifiant, plan, trial_ends_at, plan_expires_at, billing_status")
    .eq("status", "active");
  if (organisationError) throw new Error("Les organisations qui recrutent n’ont pas pu être chargées.");
  const activeOrganisations = (organisations || []).filter((organisation) => hasActivePlanAccess(organisation));
  if (!activeOrganisations.length) return [] as PublicCareerDirectoryOffer[];

  const organisationById = new Map(activeOrganisations.map((organisation) => [organisation.id, organisation]));
  const { data: offers, error: offerError } = await admin.from("offres")
    .select("id, organisation_id, public_slug, title, department, contract_type, work_mode, location, summary, mission, responsibilities, must_have_skills, nice_to_have_skills, success_outcomes, published_at")
    .in("organisation_id", activeOrganisations.map((organisation) => organisation.id))
    .eq("status", "open")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(200);
  if (offerError) throw new Error("Les offres ouvertes n’ont pas pu être chargées.");

  return (offers || []).flatMap((offer) => {
    const organisation = organisationById.get(offer.organisation_id);
    if (!organisation) return [];
    const safeOffer: PublicCareerOffer = {
      id: offer.id,
      public_slug: offer.public_slug,
      title: offer.title,
      department: offer.department,
      contract_type: offer.contract_type,
      work_mode: offer.work_mode,
      location: offer.location,
      summary: offer.summary,
      mission: offer.mission,
      responsibilities: offer.responsibilities,
      must_have_skills: offer.must_have_skills,
      nice_to_have_skills: offer.nice_to_have_skills,
      success_outcomes: offer.success_outcomes,
      published_at: offer.published_at,
    };
    return [{
      ...safeOffer,
      organisation_name: organisation.name,
      organisation_identifier: organisation.identifiant,
    } as PublicCareerDirectoryOffer];
  });
}, ["public-career-directory-v1"], { revalidate: 60, tags: ["public-careers"] });

export async function getPublicCareerDirectoryOffers() {
  return getCachedPublicCareerDirectoryOffers();
}
