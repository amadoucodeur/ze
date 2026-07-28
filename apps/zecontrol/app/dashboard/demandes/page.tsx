import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BellRing } from "lucide-react";
import { ChangeRequestsReview } from "@/components/clocking/change-requests-review";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const metadata: Metadata = { title: "Demandes de pointage" };

export default async function ChangeRequestsPage() {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (access.status !== "ready" || !access.organisation || !access.productProfile || access.productProfile.role === "agent") redirect("/dashboard");

  return (
    <div className="dashboard-settings-page change-requests-page">
      <header className="dashboard-content-header"><div><span>À valider</span><h1>Demandes</h1><p>Acceptez ou refusez les corrections et les pointages oubliés.</p></div><div className="settings-page-avatar"><BellRing size={23} /></div></header>
      <ChangeRequestsReview organisationId={access.organisation.id} />
    </div>
  );
}
