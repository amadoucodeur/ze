import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { ProfileForm } from "@/components/settings/profile-form";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Mon profil" };

export default async function ProfileSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");

  return (
    <div className="dashboard-settings-page">
      <header className="dashboard-content-header"><div><span>Paramètres personnels</span><h1>Mon profil</h1><p>Gérez les informations visibles par votre organisation.</p></div><div className="settings-page-avatar"><UserRound size={23} /></div></header>
      <div className="settings-layout"><ProfileForm profile={profile} /><aside className="settings-aside"><div className="settings-summary-card"><span><ShieldCheck size={20} /></span><h3>Compte sécurisé</h3><p>Votre session est protégée par votre méthode de connexion actuelle.</p><div><small>Rôle</small><strong>{profile.role === "owner" ? "Propriétaire" : profile.role === "admin" ? "Administrateur" : profile.role === "recruiter" ? "Recruteur" : "Lecteur"}</strong></div><div><small>Organisation</small><strong>{profile.organisation?.name ?? "Non rattaché"}</strong></div></div><div className="settings-tip"><KeyRound size={18} /><p>Votre email et votre identifiant ne peuvent pas être modifiés depuis cette page.</p></div></aside></div>
    </div>
  );
}
