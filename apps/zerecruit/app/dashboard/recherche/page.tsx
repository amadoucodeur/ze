import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { TalentSearchChat } from "@/components/search/talent-search-chat";
import { getPlan, hasActivePlanAccess } from "@/lib/billing/plans";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Rechercher dans le vivier" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function value(params: Record<string, string | string[] | undefined>, key: string) {
  const candidate = params[key];
  return typeof candidate === "string" ? candidate.trim().slice(0, 160) : "";
}

function legacyQuery(params: Record<string, string | string[] | undefined>) {
  const parts = [value(params, "q"), value(params, "skill"), value(params, "location"), value(params, "industry"), value(params, "language"), value(params, "education")].filter(Boolean);
  const availability = value(params, "availability");
  const experience = value(params, "experienceYears");
  const salary = value(params, "maxSalary");
  const currency = value(params, "currency") || "XOF";
  if (availability) parts.push(`disponibilité ${availability}`);
  if (experience) parts.push(`${experience} années d’expérience minimum`);
  if (salary) parts.push(`budget maximum ${salary} ${currency} par mois`);
  return parts.join(", ");
}

export default async function TalentSearchPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id) redirect("/dashboard");
  const initialQuery = legacyQuery(await searchParams);
  const plan = getPlan(profile.organisation?.plan);
  const collectionsEnabled = Boolean(profile.organisation) && hasActivePlanAccess(profile.organisation!) && plan.collectionsEnabled;

  return (
    <div className="talent-chat-page talent-search-redesign">
      <header className="dashboard-content-header">
        <div><span><Sparkles size={15} /> Assistant IA</span><h1>Quel profil cherchez-vous&nbsp;?</h1><p>Expliquez le besoin comme à un collègue. ZeRecruit retrouve et explique les profils les plus pertinents.</p></div>
        <Link className="button button-ghost" href="/dashboard/talents"><ArrowLeft size={17} /> Retour au vivier</Link>
      </header>
      <TalentSearchChat key={initialQuery || "new-search"} canManageCollections={profile.role !== "viewer" && collectionsEnabled} initialQuery={initialQuery} />
    </div>
  );
}
