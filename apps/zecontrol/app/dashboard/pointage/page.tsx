import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PersonalClockingWorkspace } from "@/components/clocking/personal-clocking-workspace";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const metadata: Metadata = { title: "Mon pointage" };

export default async function ClockingPage() {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (
    access.status !== "ready" ||
    !access.organisation ||
    !access.productProfile ||
    access.productProfile.role === "owner"
  ) {
    redirect("/dashboard");
  }

  const isAgent = access.productProfile.role === "agent";

  if (isAgent) {
    return (
      <PersonalClockingWorkspace
        profileId={access.profile.id}
        organisationId={access.organisation.id}
        organisationName={access.organisation.name}
        fullname={access.profile.fullname}
        identifier={access.profile.identifiant}
        canRemote={access.productProfile.can_remote}
        timeZone={access.organisation.timezone}
        mode="agent"
        showReports={false}
        activityHref="/dashboard/mon-activite"
      />
    );
  }

  return (
    <div className="dashboard-settings-page admin-clocking-page">
      <PersonalClockingWorkspace
        profileId={access.profile.id}
        organisationId={access.organisation.id}
        organisationName={access.organisation.name}
        fullname={access.profile.fullname}
        identifier={access.profile.identifiant}
        canRemote={access.productProfile.can_remote}
        timeZone={access.organisation.timezone}
        mode="manager"
        showReports={false}
      />
    </div>
  );
}
