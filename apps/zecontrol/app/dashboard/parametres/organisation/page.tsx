import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ShieldCheck, UsersRound } from "lucide-react";
import { OrganisationSettingsWorkspace } from "@/components/settings/organisation-settings-workspace";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const metadata: Metadata = { title: "Paramètres de l’organisation" };

export default async function OrganisationSettingsPage() {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (access.status !== "ready" || !access.organisation || access.productProfile?.role !== "owner") {
    redirect("/dashboard");
  }

  return (
    <div className="dashboard-settings-page organisation-settings-page">
      <header className="dashboard-content-header"><div><span>Paramètres de l’espace</span><h1>Organisation</h1><p>Gérez l’identité de l’entreprise et les règles communes de ZeControl.</p></div><div className="settings-page-avatar"><Building2 size={23} /></div></header>
      <div className="organisation-status-bar"><div><span className="organisation-logo-preview">{access.organisation.name.slice(0, 2).toUpperCase()}</span><div><small>Organisation active</small><strong>{access.organisation.name}</strong></div></div><div><span><ShieldCheck size={14} /> Propriétaire</span><Link href="/dashboard/equipe"><UsersRound size={14} /> Configurer l’équipe</Link></div></div>
      <OrganisationSettingsWorkspace organisationId={access.organisation.id} organisationIdentifier={access.organisation.identifiant} />
    </div>
  );
}
