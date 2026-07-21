import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Building2, Upload, UserRoundSearch } from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/current-profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (profile.role === "owner" && !profile.organisation_id) redirect("/dashboard/organisation/nouvelle");

  let talentCount = 0;
  let offerCount = 0;
  if (profile.organisation_id) {
    const supabase = await createClient();
    const [talents, offers] = await Promise.all([
      supabase.from("candidats").select("id", { count: "exact", head: true }).is("archived_at", null),
      supabase.from("offres").select("id", { count: "exact", head: true }).in("status", ["draft", "open", "paused"]),
    ]);
    talentCount = talents.count ?? 0;
    offerCount = offers.count ?? 0;
  }

  const canManage = profile.role !== "viewer";
  const nextStep = offerCount === 0
    ? {
        kicker: "Commencez par la mission",
        title: "Quel poste souhaitez-vous pourvoir ?",
        description: "Créez une offre à partir de quelques mots ou d’un document. Les profils seront ensuite comparés à ce besoin précis.",
        href: canManage ? "/dashboard/offres/nouvelle" : "/dashboard/offres",
        label: canManage ? "Créer une offre" : "Voir les offres",
        Icon: BriefcaseBusiness,
      }
    : talentCount === 0
      ? {
          kicker: "Offre prête",
          title: "Ajoutez maintenant les profils à comparer.",
          description: "Importez un ou plusieurs CV. ZeRecruit les structure puis les rapproche de votre recrutement.",
          href: canManage ? "/dashboard/talents/nouveau" : "/dashboard/offres",
          label: canManage ? "Importer des CV" : "Voir le recrutement",
          Icon: Upload,
        }
      : {
          kicker: "Votre espace est prêt",
          title: "Continuez votre recrutement en cours.",
          description: "Ouvrez une offre pour consulter les profils recommandés et choisir la prochaine action.",
          href: "/dashboard/offres",
          label: "Ouvrir les offres",
          Icon: BriefcaseBusiness,
        };
  const NextStepIcon = nextStep.Icon;

  return <div className="dashboard-home simplified-dashboard-home">
    <header className="dashboard-content-header dashboard-home-header"><div><span>{profile.organisation?.name || "ZeRecruit"}</span><h1>Bonjour {profile.fullname}</h1><p>Une seule prochaine étape pour avancer sans vous disperser.</p></div></header>

    {!profile.organisation ? <div className="dashboard-alert"><Building2 size={21} /><div><strong>Votre organisation n’est pas encore disponible</strong><p>Demandez à son propriétaire de terminer la configuration avant de commencer.</p></div></div> : <>
      <section className="activation-hero simplified-next-step" aria-labelledby="next-step-title">
        <div className="activation-copy"><span className="section-kicker">{nextStep.kicker}</span><h2 id="next-step-title">{nextStep.title}</h2><p>{nextStep.description}</p><div className="activation-actions"><Link className="button button-primary" href={nextStep.href}><NextStepIcon size={18} /> {nextStep.label} <ArrowRight size={17} /></Link></div></div>
        <div className="dashboard-at-a-glance" aria-label="Résumé de l’espace"><Link href="/dashboard/offres"><BriefcaseBusiness size={20} /><strong>{offerCount}</strong><span>offre{offerCount > 1 ? "s" : ""} active{offerCount > 1 ? "s" : ""}</span></Link><Link href="/dashboard/talents"><UserRoundSearch size={20} /><strong>{talentCount}</strong><span>profil{talentCount > 1 ? "s" : ""} dans le vivier</span></Link></div>
      </section>
    </>}
  </div>;
}
