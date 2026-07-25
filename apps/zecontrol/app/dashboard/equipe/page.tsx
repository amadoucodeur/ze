import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock3, UserPlus, UsersRound } from "lucide-react";
import { activateExistingCollaboratorAction } from "@/app/actions/team";
import { TeamDirectory } from "@/components/team/team-directory";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Équipe" };

function formatDate(value: string | null) {
  if (!value) return "Jamais connecté";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value));
}

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (access.status !== "ready" || !access.organisation || !access.productProfile) redirect("/dashboard");
  if (access.productProfile.role !== "owner" && access.productProfile.role !== "admin") redirect("/dashboard");

  const admin = createAdminClient();
  const [{ data: profiles }, { data: configs }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, fullname, identifiant, email, role, is_active, last_login_at, created_at")
      .eq("organisation_id", access.organisation.id)
      .order("created_at", { ascending: true }),
    admin
      .schema("zecontrol")
      .from("profiles_configs")
      .select("id, role, policy, can_remote, is_active, poste, service"),
  ]);
  const organisationProfiles = profiles ?? [];
  const profilesById = new Map(organisationProfiles.map((profile) => [profile.id, profile]));
  const productConfigs = (configs ?? []).filter((config) => profilesById.has(config.id));
  const configIds = new Set(productConfigs.map((config) => config.id));
  const collaborators = productConfigs
    .filter((config) => config.role !== "owner")
    .map((config) => ({ config, profile: profilesById.get(config.id)! }));
  const availableProfiles = organisationProfiles.filter(
    (profile) => profile.id !== access.profile.id && profile.role !== "owner" && profile.is_active && !configIds.has(profile.id),
  );
  const activeCount = collaborators.filter(({ config }) => config.is_active).length;
  const query = await searchParams;

  return (
    <div className="dashboard-settings-page team-page">
      <header className="dashboard-content-header team-page-header"><div><span>Administration</span><h1>Votre équipe</h1><p>Gérez les accès ZeControl de {access.organisation.name}, sans modifier leurs accès aux autres produits.</p></div><Link className="button button-primary team-add-button" href="/dashboard/equipe/nouveau"><UserPlus size={17} /> Ajouter un collaborateur</Link></header>
      {query.error && <div className="form-message form-error">L’activation n’a pas abouti. Réessayez.</div>}

      <div className="team-stats-grid"><article><span><UsersRound size={19} /></span><div><small>Collaborateurs</small><strong>{collaborators.length}</strong></div></article><article><span><CheckCircle2 size={19} /></span><div><small>Accès actifs</small><strong>{activeCount}</strong></div></article><article><span><Clock3 size={19} /></span><div><small>Disponibles dans ZeSuite</small><strong>{availableProfiles.length}</strong></div></article></div>

      {availableProfiles.length > 0 && <section className="team-available-card"><div className="team-table-heading"><div><h2>Déjà présents dans ZeSuite</h2><p>Activez ZeControl sans recréer leur compte, leur identifiant ou leur mot de passe.</p></div><span className="team-available-count">{availableProfiles.length}</span></div><div className="team-available-list">{availableProfiles.map((profile) => <article key={profile.id}><span className="team-avatar">{profile.fullname.slice(0, 2).toUpperCase()}</span><div><strong>{profile.fullname}</strong><small>{profile.identifiant}</small></div><form action={activateExistingCollaboratorAction.bind(null, profile.id)}><button className="button button-ghost" type="submit">Activer ZeControl <ArrowRight size={15} /></button></form></article>)}</div></section>}

      {collaborators.length === 0 ? <section className="team-empty-state"><span><UserPlus size={27} /></span><h2>Ajoutez votre premier collaborateur.</h2><p>Créez un nouvel accès ou activez un profil ZeSuite déjà présent dans l’organisation.</p><Link className="button button-primary" href="/dashboard/equipe/nouveau">Créer un accès <ArrowRight size={17} /></Link></section> : <TeamDirectory items={collaborators.map(({ config, profile }) => ({ id: profile.id, fullname: profile.fullname, identifiant: profile.identifiant, role: config.role as "owner" | "admin" | "agent", isActive: config.is_active, lastLoginLabel: formatDate(profile.last_login_at), poste: config.poste, service: config.service }))} />}
    </div>
  );
}
