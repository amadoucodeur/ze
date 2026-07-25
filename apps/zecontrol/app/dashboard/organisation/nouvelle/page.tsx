import { redirect } from "next/navigation";
import { Building2, CheckCircle2, UserRound } from "lucide-react";
import { OrganisationForm } from "@/components/onboarding/organisation-form";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const dynamic = "force-dynamic";

export default async function NewOrganisationPage() {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/auth/clear-session");
  if (access.profile.must_change_password) redirect("/nouveau-mot-de-passe");
  if (
    access.profile.role !== "owner" ||
    !access.profile.is_active ||
    access.status !== "organisation-missing"
  ) {
    redirect(access.status === "ready" ? "/dashboard" : "/activation");
  }

  return (
    <div className="dashboard-settings-page organisation-onboarding">
      <div className="onboarding-progress" aria-label="Progression de la configuration">
        <span className="complete"><CheckCircle2 size={15} /> Compte</span>
        <i />
        <span className="current"><Building2 size={15} /> Organisation</span>
        <i />
        <span><UserRound size={15} /> Équipe</span>
      </div>
      <header className="dashboard-content-header onboarding-header">
        <div>
          <span>Première configuration</span>
          <h1>Parlez-nous de votre organisation.</h1>
          <p>Deux informations suffisent pour créer votre espace. Les règles de pointage seront configurées ensuite.</p>
        </div>
        <span className="onboarding-avatar"><Building2 size={25} /></span>
      </header>
      <div className="onboarding-value-strip">
        <CheckCircle2 size={20} />
        <p>Votre compte propriétaire est prêt. Cette étape crée l’organisation partagée et active immédiatement ZeControl.</p>
      </div>
      <section className="organisation-onboarding-form">
        <OrganisationForm />
      </section>
    </div>
  );
}
