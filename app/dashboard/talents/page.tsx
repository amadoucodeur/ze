import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, Check, Plus, UserRoundSearch } from "lucide-react";
import { TalentPoolExplorer, type TalentPoolItem } from "@/components/talents/talent-pool-explorer";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Talents" };
export const dynamic = "force-dynamic";

type TalentsPageProps = { searchParams: Promise<{ created?: string; imported?: string; deleted?: string; archived?: string; q?: string }> };

export default async function TalentsPage({ searchParams }: TalentsPageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id) redirect("/dashboard");

  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const showArchived = params.archived === "1";
  const admin = createAdminClient();
  let talentsQuery = admin.from("candidats").select("id, fullname, poste_type, localisation, summary, statut, performance_score, archived_at, created_by, created_at, industries, skills(name, expertise), languages(name, level)").eq("organisation_id", profile.organisation_id).order("created_at", { ascending: false }).limit(250);
  talentsQuery = showArchived ? talentsQuery.not("archived_at", "is", null) : talentsQuery.is("archived_at", null);
  const [{ data }, { data: creatorData }] = await Promise.all([
    talentsQuery,
    admin.from("profiles").select("id, fullname").eq("organisation_id", profile.organisation_id),
  ]);
  const talents = data ?? [];
  const creatorNames = new Map((creatorData ?? []).map((creator) => [creator.id, creator.fullname]));
  const talentItems: TalentPoolItem[] = talents.map((talent) => ({
    id: talent.id,
    fullname: talent.fullname,
    posteType: talent.poste_type,
    localisation: talent.localisation,
    summary: talent.summary,
    statut: talent.statut || "unknown",
    performanceScore: talent.performance_score,
    archivedAt: talent.archived_at,
    createdAt: talent.created_at,
    creatorName: creatorNames.get(talent.created_by) || "un membre de l’équipe",
    industries: Array.isArray(talent.industries) ? talent.industries : [],
    skills: Array.isArray(talent.skills) ? talent.skills : [],
    languages: Array.isArray(talent.languages) ? talent.languages : [],
  }));
  const canCreate = profile.role !== "viewer";
  const created = params.created === "1";
  const imported = Math.min(10, Math.max(0, Number(params.imported) || 0));
  const deleted = params.deleted === "1";

  return (
    <div className="dashboard-settings-page talents-page">
      <header className="dashboard-content-header"><div><span>{showArchived ? "Archives" : "Vivier"}</span><h1>{showArchived ? "Talents archivés" : "Talents"}</h1><p>{talents.length ? `${talents.length} profil${talents.length > 1 ? "s" : ""} ${showArchived ? "archivé" : "actif"}${talents.length > 1 ? "s" : ""}.` : showArchived ? "Aucun profil archivé." : "Construisez un vivier clair, exploitable et partagé avec votre équipe."}</p></div>{canCreate && !showArchived && <Link className="button button-primary team-add-button" href="/dashboard/talents/nouveau"><Plus size={18} /> Importer des CV</Link>}</header>
      {created && <div className="dashboard-success-banner" role="status"><Check size={20} /><div><strong>Talent ajouté au vivier</strong><p>Le profil est maintenant disponible pour votre organisation.</p></div></div>}
      {imported > 0 && <div className="dashboard-success-banner" role="status"><Check size={20} /><div><strong>{imported} profil{imported > 1 ? "s ajoutés" : " ajouté"} au vivier</strong><p>{imported > 1 ? "Ils sont maintenant prêts à être consultés par votre équipe." : "Il est maintenant prêt à être consulté par votre équipe."}</p></div></div>}
      {deleted && <div className="dashboard-success-banner" role="status"><Check size={20} /><div><strong>Profil supprimé</strong><p>Le profil et ses données analysées ont été supprimés définitivement.</p></div></div>}
      <nav className="talents-view-switch" aria-label="Affichage du vivier"><Link className={!showArchived ? "is-active" : ""} href="/dashboard/talents">Profils actifs</Link><Link className={showArchived ? "is-active" : ""} href="/dashboard/talents?archived=1"><Archive size={15} /> Archives</Link></nav>
      {talents.length === 0 ? <div className="talents-empty-state"><span>{showArchived ? <Archive size={30} /> : <UserRoundSearch size={30} />}</span><div><small>{showArchived ? "Archives vides" : "Votre première étape utile"}</small><h2>{showArchived ? "Aucun profil archivé." : "Transformez votre premier CV en profil."}</h2><p>{showArchived ? "Les profils archivés restent récupérables et apparaîtront ici." : "Déposez plusieurs documents ou collez un texte. ZeRecruit crée un profil distinct pour chaque personne."}</p>{canCreate && !showArchived ? <Link className="button button-primary" href="/dashboard/talents/nouveau"><Plus size={18} /> Importer mes premiers CV</Link> : !showArchived && <p className="talents-viewer-note">Votre accès est en lecture seule. Un recruteur de l’organisation peut créer le premier profil.</p>}</div></div> : <TalentPoolExplorer talents={talentItems} archived={showArchived} initialQuery={query} />}
    </div>
  );
}
