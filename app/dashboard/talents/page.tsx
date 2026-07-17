import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, MapPin, Plus, Search, UserRoundSearch } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Talents" };
export const dynamic = "force-dynamic";

type TalentsPageProps = { searchParams: Promise<{ created?: string; q?: string }> };

export default async function TalentsPage({ searchParams }: TalentsPageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id) redirect("/dashboard");

  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const admin = createAdminClient();
  let talentsQuery = admin.from("candidats").select("id, fullname, poste_type, localisation, summary, statut, created_at").eq("organisation_id", profile.organisation_id).order("created_at", { ascending: false }).limit(100);
  if (query) talentsQuery = talentsQuery.ilike("fullname", `%${query}%`);
  const { data } = await talentsQuery;
  const talents = data ?? [];
  const canCreate = profile.role !== "viewer";
  const created = params.created === "1";

  return (
    <div className="dashboard-settings-page talents-page">
      <header className="dashboard-content-header"><div><span>Vivier</span><h1>Talents</h1><p>{talents.length ? `${talents.length} profil${talents.length > 1 ? "s" : ""} accessible${talents.length > 1 ? "s" : ""} à votre organisation.` : "Construisez un vivier clair, exploitable et partagé avec votre équipe."}</p></div>{canCreate && <Link className="button button-primary team-add-button" href="/dashboard/talents/nouveau"><Plus size={18} /> Ajouter un talent</Link>}</header>
      {created && <div className="dashboard-success-banner" role="status"><Check size={20} /><div><strong>Talent ajouté au vivier</strong><p>Le profil est maintenant disponible pour votre organisation.</p></div></div>}
      {talents.length === 0 && !query ? <div className="talents-empty-state"><span><UserRoundSearch size={30} /></span><div><small>Votre première étape utile</small><h2>Commencez avec un premier talent.</h2><p>Ajoutez les informations dont vous disposez. L’import et l’analyse automatique viendront ensuite enrichir ce même vivier.</p>{canCreate ? <Link className="button button-primary" href="/dashboard/talents/nouveau"><Plus size={18} /> Ajouter mon premier talent</Link> : <p className="talents-viewer-note">Votre accès est en lecture seule. Un recruteur de l’organisation peut créer le premier profil.</p>}</div></div> : <><div className="talents-toolbar"><form action="/dashboard/talents" method="get"><Search size={19} /><input name="q" type="search" aria-label="Rechercher un talent par nom" placeholder="Rechercher par nom…" defaultValue={query} /><button type="submit">Rechercher</button></form><span>{talents.length} résultat{talents.length > 1 ? "s" : ""}</span></div>{talents.length ? <div className="talent-card-grid">{talents.map(talent => <article className="talent-card" key={talent.id}><div className="talent-card-avatar">{talent.fullname.slice(0, 2).toUpperCase()}</div><div className="talent-card-copy"><span>Nouveau talent</span><h2>{talent.fullname}</h2><p>{talent.poste_type || "Expertise à compléter"}</p>{talent.localisation && <small><MapPin size={14} /> {talent.localisation}</small>}</div><div className="talent-card-status">{talent.statut || "Nouveau"}</div></article>)}</div> : <div className="talents-no-result"><Search size={26} /><h2>Aucun talent ne correspond à « {query} ».</h2><Link href="/dashboard/talents">Effacer la recherche</Link></div>}</>}
    </div>
  );
}
