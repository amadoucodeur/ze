import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Building2, LockKeyhole, UserPlus } from "lucide-react";
import { CollaboratorForm } from "@/components/team/collaborator-form";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Ajouter un collaborateur" };

export default async function NewCollaboratorPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (profile.role !== "owner") redirect("/dashboard");
  if (!profile.organisation_id || !profile.organisation) redirect("/dashboard/organisation/nouvelle");

  return (
    <div className="dashboard-settings-page new-collaborator-page">
      <Link className="dashboard-back-link" href="/dashboard/equipe"><ArrowLeft size={15} /> Retour à l’équipe</Link>
      <header className="dashboard-content-header"><div><span>Nouvel accès</span><h1>Ajouter un collaborateur</h1><p>Créez un compte rattaché exclusivement à {profile.organisation.name}.</p></div><div className="settings-page-avatar"><UserPlus size={23} /></div></header>
      <div className="collaborator-prerequisite"><Building2 size={19} /><div><strong>Organisation vérifiée</strong><p>Ce collaborateur sera automatiquement rattaché à {profile.organisation.name}.</p></div><span><LockKeyhole size={13} /> Accès isolé</span></div>
      <CollaboratorForm organisationName={profile.organisation.name} />
    </div>
  );
}
