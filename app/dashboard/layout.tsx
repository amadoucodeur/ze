import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getPlan, hasActivePlanAccess } from "@/lib/billing/plans";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth/clear-session");
  if (profile.must_change_password) redirect("/nouveau-mot-de-passe");
  const plan = getPlan(profile.organisation?.plan);

  return (
    <DashboardShell
      fullname={profile.fullname}
      role={profile.role}
      organisationName={profile.organisation?.name ?? null}
      planName={plan.name}
      planAccessActive={!profile.organisation || hasActivePlanAccess(profile.organisation)}
      teamManagementEnabled={plan.teamManagementEnabled}
    >
      {children}
    </DashboardShell>
  );
}
