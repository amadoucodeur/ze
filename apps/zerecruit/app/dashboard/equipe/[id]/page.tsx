import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, UserCog } from "lucide-react";
import { CollaboratorManagement } from "@/components/team/collaborator-management";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Gérer un collaborateur" };

export default async function CollaboratorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; statusError?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (profile.role !== "owner" && profile.role !== "admin") redirect("/dashboard");
  if (!profile.organisation_id || !profile.organisation) redirect(profile.role === "owner" ? "/dashboard/organisation/nouvelle" : "/dashboard");

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const admin = createAdminClient();
  const { data: collaborator } = await admin
    .from("profiles")
    .select("id, fullname, email, phone, identifiant, role, is_active, must_change_password")
    .eq("id", id)
    .eq("organisation_id", profile.organisation_id)
    .eq("zerecruit_access", true)
    .neq("id", profile.id)
    .neq("role", "owner")
    .maybeSingle();
  if (!collaborator) redirect("/dashboard/equipe");

  return (
    <div className="dashboard-settings-page collaborator-detail-page">
      <Link className="dashboard-back-link" href="/dashboard/equipe"><ArrowLeft size={15} /> Retour à l’équipe</Link>
      <header className="dashboard-content-header"><div><span>Gestion de l’accès</span><h1>{collaborator.fullname}</h1><p>{collaborator.identifiant} · gérez ses informations, son rôle et sa connexion.</p></div><div className="settings-page-avatar"><UserCog size={23} /></div></header>
      {query.status && <div className="form-message form-success" role="status"><Check size={17} />{query.status === "reactivated" ? "L’accès du collaborateur a été réactivé." : "L’accès du collaborateur a été suspendu."}</div>}
      {query.statusError && <div className="form-message form-error" role="alert"><AlertCircle size={17} />{query.statusError === "seat-limit" ? "Toutes les places du plan sont utilisées. Suspendez un autre accès avant de réactiver celui-ci." : query.statusError === "inactive-plan" ? "Le plan est arrivé à échéance. Renouvelez-le avant de réactiver ce collaborateur." : "L’état de l’accès n’a pas pu être modifié. Réessayez."}</div>}
      <CollaboratorManagement
        collaborator={{ ...collaborator, role: collaborator.role as "admin" | "recruiter" | "viewer" }}
        organisationIdentifier={profile.organisation.identifiant}
      />
    </div>
  );
}
