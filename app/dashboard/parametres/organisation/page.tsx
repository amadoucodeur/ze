import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2, Check, Crown, ShieldCheck } from "lucide-react";
import { OrganisationForm } from "@/components/settings/organisation-form";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Paramètres de l’organisation" };

type OrganisationSettingsPageProps = { searchParams: Promise<{ created?: string }> };

export default async function OrganisationSettingsPage({ searchParams }: OrganisationSettingsPageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (profile.role !== "owner") redirect("/dashboard");
  if (!profile.organisation) redirect("/dashboard/organisation/nouvelle");
  const { created } = await searchParams;

  return (
    <div className="dashboard-settings-page">
      <header className="dashboard-content-header"><div><span>Paramètres de l’espace</span><h1>Organisation</h1><p>Gérez l’identité et les préférences partagées par toute votre équipe.</p></div><div className="settings-page-avatar"><Building2 size={23} /></div></header>
      {created === "1" && <div className="dashboard-success-banner"><Check size={18} /><div><strong>Votre organisation est prête.</strong><p>Vous pouvez maintenant finaliser ses préférences et préparer votre équipe.</p></div></div>}
      <div className="organisation-status-bar"><div><span className="organisation-logo-preview">{profile.organisation.name.slice(0, 2).toUpperCase()}</span><div><small>Organisation active</small><strong>{profile.organisation.name}</strong></div></div><div><span><Crown size={14} /> Plan {profile.organisation.plan}</span><span><ShieldCheck size={14} /> Propriétaire</span></div></div>
      <OrganisationForm mode="update" organisation={profile.organisation} />
    </div>
  );
}
