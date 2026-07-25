import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Clock3 } from "lucide-react";
import { PersonalClockingWorkspace } from "@/components/clocking/personal-clocking-workspace";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const metadata: Metadata = { title: "Mon pointage" };

export default async function AdminClockingPage() {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (
    access.status !== "ready" ||
    !access.organisation ||
    !access.productProfile ||
    access.productProfile.role === "agent"
  ) {
    redirect("/dashboard");
  }

  return (
    <div className="dashboard-settings-page admin-clocking-page">
      <header className="dashboard-content-header">
        <div>
          <span>Espace personnel</span>
          <h1>Mon pointage</h1>
          <p>Enregistrez votre propre journée, indépendamment du suivi de l’équipe.</p>
        </div>
        <div className="settings-page-avatar"><Clock3 size={23} /></div>
      </header>
      <PersonalClockingWorkspace
        profileId={access.profile.id}
        organisationId={access.organisation.id}
        organisationName={access.organisation.name}
        fullname={access.profile.fullname}
        policy={access.productProfile.policy}
        canRemote={access.productProfile.can_remote}
        timeZone={access.organisation.timezone}
        mode="manager"
        showReports={false}
      />
    </div>
  );
}
