import { redirect } from "next/navigation";
import { AccessRoleSynchronizer } from "@/components/dashboard/access-role-synchronizer";
import { AgentShell } from "@/components/dashboard/agent-shell";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/auth/clear-session");
  if (access.profile.must_change_password) redirect("/nouveau-mot-de-passe");
  const isOwnerOnboarding =
    access.status === "organisation-missing" && access.profile.role === "owner";
  if (access.status !== "ready" && !isOwnerOnboarding) redirect("/activation");
  const productRole = access.productProfile?.role ?? "owner";
  const canManageTeam = access.status === "ready" && productRole !== "agent";
  let pendingRequestCount = 0;
  if (canManageTeam && access.organisation) {
    const supabase = await createClient();
    const { count } = await supabase.schema("zecontrol").from("event_change_requests").select("id", { count: "exact", head: true }).eq("organisation_id", access.organisation.id).eq("status", "pending");
    pendingRequestCount = count ?? 0;
  }

  if (productRole === "agent") {
    return (
      <>
        <AccessRoleSynchronizer profileId={access.profile.id} role={productRole} />
        <AgentShell fullname={access.profile.fullname}>{children}</AgentShell>
      </>
    );
  }

  return (
    <>
      <AccessRoleSynchronizer profileId={access.profile.id} role={productRole} />
      <DashboardShell
        fullname={access.profile.fullname}
        role={productRole}
        organisationName={access.organisation?.name ?? null}
        canManageTeam={canManageTeam}
        pendingRequestCount={pendingRequestCount}
      >
        {children}
      </DashboardShell>
    </>
  );
}
