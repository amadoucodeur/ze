import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, Check, FolderHeart, Plus, Search } from "lucide-react";
import { TalentPoolExplorer } from "@/components/talents/talent-pool-explorer";
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
  const canCreate = profile.role !== "viewer";
  const created = params.created === "1";
  const imported = Math.min(10, Math.max(0, Number(params.imported) || 0));
  const deleted = params.deleted === "1";

  return (
    <div className="dashboard-settings-page talents-page">
      <header className="dashboard-content-header"><div><span>{showArchived ? "Archives" : "Vivier"}</span><h1>{showArchived ? "Talents archivés" : "Talents"}</h1><p>{showArchived ? "Retrouvez les profils mis de côté et restaurez-les si nécessaire." : "Recherchez, filtrez et ouvrez uniquement les profils utiles à votre recrutement."}</p></div>{canCreate && !showArchived && <Link className="button button-primary team-add-button" href="/dashboard/talents/nouveau"><Plus size={18} /> Importer des CV</Link>}</header>
      {created && <div className="dashboard-success-banner" role="status"><Check size={20} /><div><strong>Talent ajouté au vivier</strong><p>Le profil est maintenant disponible pour votre organisation.</p></div></div>}
      {imported > 0 && <div className="dashboard-success-banner" role="status"><Check size={20} /><div><strong>{imported} profil{imported > 1 ? "s ajoutés" : " ajouté"} au vivier</strong><p>{imported > 1 ? "Ils sont maintenant prêts à être consultés par votre équipe." : "Il est maintenant prêt à être consulté par votre équipe."}</p></div></div>}
      {deleted && <div className="dashboard-success-banner" role="status"><Check size={20} /><div><strong>Profil supprimé</strong><p>Le profil et ses données analysées ont été supprimés définitivement.</p></div></div>}
      <div className="talents-context-bar">
        <nav className="talents-view-switch" aria-label="Affichage du vivier"><Link className={!showArchived ? "is-active" : ""} href="/dashboard/talents">Profils actifs</Link><Link className={showArchived ? "is-active" : ""} href="/dashboard/talents?archived=1"><Archive size={15} /> Archives</Link></nav>
        {!showArchived && <nav className="talents-secondary-tools" aria-label="Outils du vivier"><Link href="/dashboard/recherche"><Search size={16} /> Recherche intelligente</Link><Link href="/dashboard/collections"><FolderHeart size={16} /> Collections</Link></nav>}
      </div>
      <TalentPoolExplorer archived={showArchived} initialQuery={query} canCreate={canCreate} />
    </div>
  );
}
