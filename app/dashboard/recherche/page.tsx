import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Check, Search, Sparkles } from "lucide-react";
import { TalentSearchChat } from "@/components/search/talent-search-chat";
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

  return (
    <div className="talent-chat-page talent-search-redesign">
      <header className="dashboard-content-header">
        <div><span>Recherche intelligente</span><h1>Décrivez la mission. ZeRecruit trouve les bons profils.</h1><p>Écrivez naturellement votre besoin ou précisez vos critères. Chaque résultat est classé et expliqué.</p></div>
        <Link className="button button-ghost" href="/dashboard/talents"><ArrowLeft size={17} /> Tous les profils</Link>
      </header>
      <div className="talent-search-how" aria-label="Fonctionnement de la recherche">
        <span><Search size={17} /><b>1</b> Décrivez le besoin</span>
        <span><Sparkles size={17} /><b>2</b> Vérifiez les critères</span>
        <span><Check size={17} /><b>3</b> Comparez les profils</span>
      </div>
      <TalentSearchChat canManageCollections={profile.role !== "viewer"} initialQuery={initialQuery} />
    </div>
  );
}
