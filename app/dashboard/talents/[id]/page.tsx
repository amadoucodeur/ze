import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { TalentProfile, type TalentProfileData } from "@/components/talents/talent-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Profil talent" };
export const dynamic = "force-dynamic";

type TalentPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; updated?: string; enriched?: string; archived?: string; restored?: string; actionError?: string; from?: string }>;
};

function textArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function contacts(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.email === "string" ? { email: record.email } : {}),
    ...(typeof record.phone === "string" ? { phone: record.phone } : {}),
    ...(typeof record.linkedin === "string" && /^https?:\/\//i.test(record.linkedin) ? { linkedin: record.linkedin } : {}),
  };
}

function jsonRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export default async function TalentPage({ params, searchParams }: TalentPageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id) redirect("/dashboard");

  const { id } = await params;
  const query = await searchParams;
  const admin = createAdminClient();
  const { data: candidate } = await admin
    .from("candidats")
    .select("id, fullname, poste_type, localisation, summary, statut, source, contacts, industries, weakness, performance_score, performance, archived_at, created_by, created_at, skills(id, name, importance, expertise, source, score, nb_month_of_experiance, industry), languages(id, name, level), formations(id, name, institution_name, issuer_date, type, field_of_study, adresse, description, start_date, end_date, confidence_score)")
    .eq("id", id)
    .eq("organisation_id", profile.organisation_id)
    .maybeSingle();

  if (!candidate) notFound();

  const [{ data: creator }, { data: processing }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, fullname")
      .eq("id", candidate.created_by)
      .eq("organisation_id", profile.organisation_id)
      .maybeSingle(),
    admin
      .from("candidats")
      .select("processing_status")
      .eq("id", candidate.id)
      .eq("organisation_id", profile.organisation_id)
      .maybeSingle(),
  ]);

  const talent: TalentProfileData = {
    id: candidate.id,
    fullname: candidate.fullname,
    posteType: candidate.poste_type,
    localisation: candidate.localisation,
    summary: candidate.summary,
    statut: candidate.statut,
    performanceScore: candidate.performance_score,
    performance: jsonRecord(candidate.performance),
    archivedAt: candidate.archived_at,
    createdBy: creator ? { id: creator.id, fullname: creator.fullname } : null,
    createdAt: candidate.created_at,
    source: candidate.source,
    processingStatus: processing?.processing_status === "indexing" || processing?.processing_status === "failed"
      ? processing.processing_status
      : "ready",
    contacts: contacts(candidate.contacts),
    industries: textArray(candidate.industries),
    pointsAttention: textArray(candidate.weakness),
    skills: (candidate.skills || []).map((skill) => ({ id: skill.id, name: skill.name, importance: skill.importance, expertise: skill.expertise, source: skill.source, score: skill.score, months: skill.nb_month_of_experiance, industry: skill.industry })),
    languages: (candidate.languages || []).map((language) => ({ id: language.id, name: language.name, level: language.level })),
    formations: (candidate.formations || []).map((formation) => ({ id: formation.id, name: formation.name, institutionName: formation.institution_name, issuerDate: formation.issuer_date, type: formation.type, fieldOfStudy: formation.field_of_study, address: formation.adresse, description: formation.description, startDate: formation.start_date, endDate: formation.end_date, confidenceScore: formation.confidence_score })),
  };

  return (
    <div className="dashboard-settings-page talent-profile-page">
      <Link className="dashboard-back-link" href={query.from === "recherche" ? "/dashboard/recherche" : "/dashboard/talents"}><ArrowLeft size={16} /> {query.from === "recherche" ? "Retour aux résultats" : "Retour aux profils"}</Link>
      <TalentProfile candidate={talent} canEdit={profile.role !== "viewer"} justCreated={query.created === "1"} justUpdated={query.updated === "1"} justEnriched={query.enriched === "1"} justArchived={query.archived === "1"} justRestored={query.restored === "1"} actionError={query.actionError} />
    </div>
  );
}
