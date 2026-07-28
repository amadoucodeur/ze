import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { OrganisationReports } from "@/components/reports/organisation-reports";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const metadata: Metadata = { title: "Rapports" };

export default async function ReportsPage() {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (access.status !== "ready" || !access.organisation || !access.productProfile || access.productProfile.role === "agent") {
    redirect("/dashboard");
  }

  return (
    <div className="dashboard-settings-page reports-page">
      <header className="dashboard-content-header"><div><span>Analyse et export</span><h1>Rapports</h1><p>Choisissez une période, lisez les résultats et exportez si nécessaire.</p></div><div className="settings-page-avatar"><BarChart3 size={23} /></div></header>
      <OrganisationReports organisationId={access.organisation.id} organisationName={access.organisation.name} timeZone={access.organisation.timezone} />
    </div>
  );
}
