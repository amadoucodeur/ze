import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Building2, LockKeyhole, UserPlus } from "lucide-react";
import { CollaboratorForm } from "@/components/team/collaborator-form";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const metadata: Metadata = { title: "Ajouter un collaborateur" };

export default async function NewCollaboratorPage() {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (access.status !== "ready" || !access.organisation || !access.productProfile) redirect("/dashboard");
  if (access.productProfile.role !== "owner" && access.productProfile.role !== "admin") redirect("/dashboard");

  return <div className="dashboard-settings-page new-collaborator-page"><Link className="dashboard-back-link" href="/dashboard/equipe"><ArrowLeft size={15} /> Retour à l’équipe</Link><header className="dashboard-content-header"><div><span>Nouvel accès</span><h1>Ajouter un collaborateur</h1><p>Créez son compte ZeSuite et sa configuration ZeControl en une seule étape.</p></div><div className="settings-page-avatar"><UserPlus size={23} /></div></header><div className="collaborator-prerequisite"><Building2 size={19} /><div><strong>Organisation vérifiée</strong><p>Ce collaborateur sera automatiquement rattaché à {access.organisation.name}.</p></div><span><LockKeyhole size={13} /> Accès ZeControl</span></div><CollaboratorForm organisationName={access.organisation.name} organisationIdentifier={access.organisation.identifiant} /></div>;
}
