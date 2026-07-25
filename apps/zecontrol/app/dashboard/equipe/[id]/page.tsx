import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, UserRoundCog } from "lucide-react";
import { CollaboratorManagement } from "@/components/team/collaborator-management";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Gérer un collaborateur" };

export default async function CollaboratorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; statusError?: string }> }) {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (access.status !== "ready" || !access.organisation || !access.productProfile) redirect("/dashboard");
  if (access.productProfile.role !== "owner" && access.productProfile.role !== "admin") redirect("/dashboard");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (id === access.profile.id) redirect("/dashboard/equipe");

  const admin = createAdminClient();
  const [{ data: profile }, { data: config }] = await Promise.all([
    admin.from("profiles").select("id, fullname, email, phone, identifiant, must_change_password").eq("id", id).eq("organisation_id", access.organisation.id).maybeSingle(),
    admin.schema("zecontrol").from("profiles_configs").select("id, role, policy, can_remote, poste, service, is_active").eq("id", id).maybeSingle(),
  ]);
  if (!profile || !config || config.role === "owner") redirect("/dashboard/equipe");

  return <div className="dashboard-settings-page collaborator-detail-page"><Link className="dashboard-back-link" href="/dashboard/equipe"><ArrowLeft size={15} /> Retour à l’équipe</Link><header className="dashboard-content-header"><div><span>Gestion de l’accès</span><h1>{profile.fullname}</h1><p>{profile.identifiant} · identité ZeSuite et configuration ZeControl.</p></div><div className="settings-page-avatar"><UserRoundCog size={23} /></div></header>{query.status && <div className="form-message form-success" role="status"><Check size={17} />{query.status === "activated" ? "L’accès ZeControl a été activé. Vérifiez maintenant sa configuration." : query.status === "reactivated" ? "L’accès ZeControl a été réactivé." : "L’accès ZeControl a été suspendu."}</div>}{query.statusError && <div className="form-message form-error" role="alert"><AlertCircle size={17} /> L’état de l’accès n’a pas pu être modifié.</div>}<CollaboratorManagement collaborator={{ ...profile, ...config, role: config.role as "admin" | "agent", policy: config.policy as "strict" | "flexible" | "free" }} organisationIdentifier={access.organisation.identifiant} /></div>;
}
