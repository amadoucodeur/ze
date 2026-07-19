import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, UserCog } from "lucide-react";
import { CollaboratorManagement } from "@/components/team/collaborator-management";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Gérer un collaborateur" };

export default async function CollaboratorPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (profile.role !== "owner" && profile.role !== "admin") redirect("/dashboard");
  if (!profile.organisation_id || !profile.organisation) redirect(profile.role === "owner" ? "/dashboard/organisation/nouvelle" : "/dashboard");

  const { id } = await params;
  const admin = createAdminClient();
  const { data: collaborator } = await admin
    .from("profiles")
    .select("id, fullname, email, phone, identifiant, role, is_active, must_change_password")
    .eq("id", id)
    .eq("organisation_id", profile.organisation_id)
    .neq("id", profile.id)
    .neq("role", "owner")
    .maybeSingle();
  if (!collaborator) redirect("/dashboard/equipe");

  return (
    <div className="dashboard-settings-page collaborator-detail-page">
      <Link className="dashboard-back-link" href="/dashboard/equipe"><ArrowLeft size={15} /> Retour à l’équipe</Link>
      <header className="dashboard-content-header"><div><span>Gestion de l’accès</span><h1>{collaborator.fullname}</h1><p>{collaborator.identifiant} · gérez ses informations, son rôle et sa connexion.</p></div><div className="settings-page-avatar"><UserCog size={23} /></div></header>
      <CollaboratorManagement
        collaborator={{ ...collaborator, role: collaborator.role as "admin" | "recruiter" | "viewer" }}
        organisationIdentifier={profile.organisation.identifiant}
      />
    </div>
  );
}
