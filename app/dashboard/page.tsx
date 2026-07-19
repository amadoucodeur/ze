import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Building2, Check, Circle, Search, Sparkles, UserPlus, UserRoundSearch, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const dynamic = "force-dynamic";

const roleLabels = { admin: "Administrateur", recruiter: "Recruteur", viewer: "Lecteur", owner: "Propriétaire" } as const;

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (profile.role === "owner" && !profile.organisation_id) redirect("/dashboard/organisation/nouvelle");

  let talentCount = 0;
  let collaboratorCount = 0;
  if (profile.organisation_id) {
    const admin = createAdminClient();
    const [talents, collaborators] = await Promise.all([
      admin.from("candidats").select("id", { count: "exact", head: true }).eq("organisation_id", profile.organisation_id),
      profile.role === "owner" || profile.role === "admin"
        ? admin.from("profiles").select("id", { count: "exact", head: true }).eq("organisation_id", profile.organisation_id).neq("role", "owner")
        : Promise.resolve({ count: 0 }),
    ]);
    talentCount = talents.count ?? 0;
    collaboratorCount = collaborators.count ?? 0;
  }

  const canCreateTalent = profile.role !== "viewer";
  const hasFirstTalent = talentCount > 0;

  return (
    <div className="dashboard-home">
      <header className="dashboard-content-header dashboard-home-header">
        <div><span>{profile.role === "owner" ? "Votre espace de recrutement" : `Accès ${roleLabels[profile.role]}`}</span><h1>Bonjour {profile.fullname}</h1><p>{profile.organisation ? `${profile.organisation.name} · ${hasFirstTalent ? "Votre vivier est actif." : "Commençons par une première réussite."}` : "Votre organisation doit finaliser la configuration de cet espace."}</p></div>
        <div className="dashboard-header-actions"><span className="dashboard-plan-pill"><Sparkles size={15} /> {profile.role === "owner" ? `Plan ${profile.organisation?.plan ?? "free"}` : roleLabels[profile.role]}</span><div className="dash-avatar" aria-label={`Profil de ${profile.fullname}`}>{profile.fullname.slice(0, 2).toUpperCase()}</div></div>
      </header>

      {!profile.organisation ? <div className="dashboard-alert"><Building2 size={21} /><div><strong>Votre organisation n’est pas encore disponible</strong><p>Demandez à son propriétaire de terminer la configuration avant de commencer.</p></div></div> : <>
        <section className="activation-hero" aria-labelledby="activation-title">
          <div className="activation-copy"><span className="section-kicker">{hasFirstTalent ? "Vivier actif" : "Première étape utile"}</span><h2 id="activation-title">{hasFirstTalent ? "Trouvez maintenant le profil utile à votre mission." : "Ajoutez votre premier talent, simplement."}</h2><p>{hasFirstTalent ? "Décrivez votre besoin avec vos mots. ZeRecruit classe les profils et explique les correspondances importantes." : "Commencez par les informations essentielles. Vous pourrez enrichir le profil à tout moment, sans bloquer votre travail."}</p><div className="activation-actions">{hasFirstTalent ? <Link className="button button-primary" href="/dashboard/recherche"><Search size={18} /> Rechercher un profil</Link> : canCreateTalent && <Link className="button button-primary" href="/dashboard/talents/nouveau"><UserPlus size={18} /> Ajouter mon premier talent</Link>}{hasFirstTalent && canCreateTalent ? <Link className="button button-ghost" href="/dashboard/talents/nouveau"><UserPlus size={18} /> Ajouter un talent</Link> : <Link className="button button-ghost" href="/dashboard/talents"><UserRoundSearch size={18} /> Voir le vivier <ArrowRight size={17} /></Link>}</div></div>
          <div className="activation-score"><div><strong>{talentCount}</strong><span>talent{talentCount > 1 ? "s" : ""}</span></div><p>{hasFirstTalent ? "Votre organisation possède déjà une base exploitable." : "Un premier profil suffit pour prendre ZeRecruit en main."}</p></div>
        </section>

        <section className="activation-grid" aria-label="Progression de votre espace">
          <article className="activation-checklist"><div className="activation-section-heading"><span>Progression</span><h2>Votre espace, étape par étape</h2></div><ol>
            <li className="complete"><span><Check size={17} /></span><div><strong>Organisation créée</strong><p>Votre espace sécurisé est prêt.</p></div></li>
            <li className={hasFirstTalent ? "complete" : "current"}><span>{hasFirstTalent ? <Check size={17} /> : <Circle size={17} />}</span><div><strong>Premier talent</strong><p>{hasFirstTalent ? "Votre vivier a démarré." : "Ajoutez un profil pour obtenir votre première valeur."}</p></div></li>
            {(profile.role === "owner" || profile.role === "admin") && <li className={collaboratorCount > 0 ? "complete" : "optional"}><span>{collaboratorCount > 0 ? <Check size={17} /> : <Users size={17} />}</span><div><strong>Inviter l’équipe <em>Optionnel</em></strong><p>{collaboratorCount > 0 ? `${collaboratorCount} collaborateur${collaboratorCount > 1 ? "s" : ""} dans votre espace.` : "À faire après avoir pris le produit en main."}</p></div>{collaboratorCount === 0 && <Link href="/dashboard/equipe/nouveau" aria-label="Ajouter un collaborateur"><ArrowRight size={17} /></Link>}</li>}
          </ol></article>
          <aside className="activation-help"><span><Sparkles size={21} /></span><div><small>Principe ZeRecruit</small><h2>Avancez sans tout configurer.</h2><p>Les réglages avancés restent disponibles, mais ne bloquent jamais la prochaine action utile.</p></div></aside>
        </section>
      </>}
    </div>
  );
}
