import type { Metadata } from "next";
import { redirect } from "next/navigation";
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
