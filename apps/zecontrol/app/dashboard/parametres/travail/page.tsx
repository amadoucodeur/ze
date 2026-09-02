import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Clock3, ShieldCheck } from "lucide-react";
import { WorkPolicyConfigurator } from "@/components/settings/work-policy-configurator";
import { ScopedWorkRules } from "@/components/settings/scoped-work-rules";
import { NonWorkingDays } from "@/components/settings/non-working-days";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const metadata: Metadata = { title: "Cadre de travail" };

export default async function WorkPolicySettingsPage() {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (
    access.status !== "ready" ||
    !access.organisation ||
    access.productProfile?.role !== "owner"
  ) {
    redirect("/dashboard");
  }

  return (
    <div className="dashboard-settings-page work-policy-page">
      <header className="dashboard-content-header">
        <div>
          <span>Paramètres de l’espace</span>
          <h1>Cadre de travail</h1>
          <p>Définissez des repères simples pour analyser les journées de votre équipe.</p>
        </div>
        <div className="settings-page-avatar"><Clock3 size={23} /></div>
      </header>
      <nav className="settings-section-tabs" aria-label="Sections des paramètres">
        <Link href="/dashboard/parametres/organisation"><Building2 size={16} /> Organisation</Link>
        <Link className="is-active" href="/dashboard/parametres/travail" aria-current="page"><ShieldCheck size={16} /> Cadre de travail</Link>
      </nav>
      <WorkPolicyConfigurator
        organisationId={access.organisation.id}
        profileId={access.profile.id}
        timeZone={access.organisation.timezone}
      />
      <NonWorkingDays
        organisationId={access.organisation.id}
        profileId={access.profile.id}
        timeZone={access.organisation.timezone}
      />
      <ScopedWorkRules
        organisationId={access.organisation.id}
        profileId={access.profile.id}
        timeZone={access.organisation.timezone}
      />
    </div>
  );
}
