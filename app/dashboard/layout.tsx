import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth/clear-session");
  if (profile.must_change_password) redirect("/nouveau-mot-de-passe");

  return (
    <DashboardShell
      fullname={profile.fullname}
      role={profile.role}
      organisationName={profile.organisation?.name ?? null}
    >
      {children}
    </DashboardShell>
  );
}
