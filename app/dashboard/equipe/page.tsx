import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock3, Settings2, UserPlus, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, type ProfileRole } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Équipe" };

const roleLabels: Record<ProfileRole, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  recruiter: "Recruteur",
  viewer: "Lecteur",
};

function formatDate(value: string | null) {
  if (!value) return "Jamais connecté";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value));
}

export default async function TeamPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (profile.role !== "owner" && profile.role !== "admin") redirect("/dashboard");
  if (!profile.organisation_id || !profile.organisation) redirect(profile.role === "owner" ? "/dashboard/organisation/nouvelle" : "/dashboard");

  const admin = createAdminClient();
  const { data: members } = await admin
    .from("profiles")
    .select("id, fullname, identifiant, email, role, is_active, last_login_at, created_at")
    .eq("organisation_id", profile.organisation_id)
    .order("created_at", { ascending: true });
  const team = members ?? [];
  const collaborators = team.filter(member => member.role !== "owner");
  const activeCollaborators = collaborators.filter(member => member.is_active).length;

  return (
    <div className="dashboard-settings-page team-page">
      <header className="dashboard-content-header"><div><span>Administration</span><h1>Votre équipe</h1><p>Créez et gérez les accès des collaborateurs de {profile.organisation.name}.</p></div><Link className="button button-primary team-add-button" href="/dashboard/equipe/nouveau"><UserPlus size={17} /> Ajouter un collaborateur</Link></header>
      <div className="team-stats-grid"><article><span><Users size={19} /></span><div><small>Collaborateurs</small><strong>{collaborators.length}</strong></div></article><article><span><CheckCircle2 size={19} /></span><div><small>Accès actifs</small><strong>{activeCollaborators}</strong></div></article><article><span><Clock3 size={19} /></span><div><small>Organisation</small><strong>{profile.organisation.name}</strong></div></article></div>
      {collaborators.length === 0 ? <div className="team-empty-state"><span><UserPlus size={27} /></span><h2>Invitez votre premier collaborateur.</h2><p>Créez son identifiant utilisateur@organisation, puis générez ou définissez son mot de passe de départ.</p><Link className="button button-primary" href="/dashboard/equipe/nouveau">Créer un accès <ArrowRight size={17} /></Link></div> : <div className="team-table-card"><div className="team-table-heading"><div><h2>Collaborateurs</h2><p>{activeCollaborators} accès actif{activeCollaborators > 1 ? "s" : ""} dans cette organisation.</p></div></div><div className="team-table"><div className="team-table-row team-table-header"><span>Collaborateur</span><span>Rôle</span><span>Dernière connexion</span><span>Statut</span><span>Action</span></div>{collaborators.map(member => <div className="team-table-row" key={member.id}><div className="team-member"><span>{member.fullname.slice(0, 2).toUpperCase()}</span><div><strong>{member.fullname}</strong><small>{member.identifiant}</small></div></div><span className="team-role">{roleLabels[member.role as ProfileRole]}</span><span className="team-last-login">{formatDate(member.last_login_at)}</span><span className={`team-status ${member.is_active ? "active" : "inactive"}`}>{member.is_active ? "Actif" : "Suspendu"}</span>{member.id === profile.id ? <span className="team-self-label">Votre compte</span> : <Link className="team-manage-link" href={`/dashboard/equipe/${member.id}`}><Settings2 size={15} /> Gérer</Link>}</div>)}</div></div>}
    </div>
  );
}
