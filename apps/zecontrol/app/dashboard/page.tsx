import { redirect } from "next/navigation";
import { CheckCircle2, Radio } from "lucide-react";
import { PersonalClockingWorkspace } from "@/components/clocking/personal-clocking-workspace";
import { OrganisationReports } from "@/components/reports/organisation-reports";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ activation?: string; organisation?: string }>;
}) {
  const access = await getCurrentZeControlAccess();
  if (!access) return null;
  if (access.status === "organisation-missing" && access.profile.role === "owner") {
    redirect("/dashboard/organisation/nouvelle");
  }
  if (access.status !== "ready" || !access.productProfile || !access.organisation) return null;

  if (access.productProfile.role === "agent") {
    return (
      <PersonalClockingWorkspace
        profileId={access.profile.id}
        organisationId={access.organisation.id}
        organisationName={access.organisation.name}
        fullname={access.profile.fullname}
        policy={access.productProfile.policy}
        canRemote={access.productProfile.can_remote}
        timeZone={access.organisation.timezone}
        mode="agent"
        showReports={false}
        activityHref="/dashboard/mon-activite"
      />
    );
  }

  const query = await searchParams;

  return (
    <div className="dashboard-home manager-dashboard-home manager-live-home">
      <header className="dashboard-content-header dashboard-home-header">
        <div>
          <span>{access.organisation.name}</span>
          <h1>Présences en direct</h1>
          <p>Visualisez la situation actuelle de toute l’équipe, sans quitter l’accueil.</p>
        </div>
        <div className="settings-page-avatar live-home-avatar"><Radio size={23} /></div>
      </header>

      {(query.activation === "success" || query.organisation === "created") && (
        <div className="dashboard-success-banner" role="status">
          <CheckCircle2 size={20} />
          <div>
            <strong>{query.organisation === "created" ? "Votre organisation est prête." : "ZeControl est activé."}</strong>
            <p>Vous pouvez maintenant suivre les présences de votre équipe.</p>
          </div>
        </div>
      )}

      <OrganisationReports organisationId={access.organisation.id} organisationName={access.organisation.name} timeZone={access.organisation.timezone} view="live" />
    </div>
  );
}
