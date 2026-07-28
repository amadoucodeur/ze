import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { ProfileSettingsForm } from "@/components/settings/profile-settings-form";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";
import { offlinePolicyOptions } from "@/lib/offline-policy";

export const metadata: Metadata = { title: "Mon profil" };

const roleLabels = {
  owner: "Propriétaire",
  admin: "Administrateur",
  agent: "Agent",
} as const;

export default async function ProfileSettingsPage() {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (access.status !== "ready" || !access.productProfile || !access.organisation) {
    redirect("/dashboard");
  }
  const productProfile = access.productProfile;

  return (
    <div className="dashboard-settings-page">
      <header className="dashboard-content-header">
        <div><span>Paramètres personnels</span><h1>Mon profil</h1><p>Gérez votre identité et les informations visibles dans ZeControl.</p></div>
        <div className="settings-page-avatar"><UserRound size={23} /></div>
      </header>
      <div className="settings-layout">
        <ProfileSettingsForm profile={access.profile} config={productProfile} />
        <aside className="settings-aside">
          <section className="settings-summary-card">
            <span><ShieldCheck size={20} /></span>
            <h3>Configuration ZeControl</h3>
            <p>Vos règles de pointage sont définies par l’administration de votre organisation.</p>
            <div><small>Rôle</small><strong>{roleLabels[productProfile.role]}</strong></div>
            <div><small>Hors connexion</small><strong>{offlinePolicyOptions.find((option) => option.value === productProfile.policy)?.label ?? "Non configuré"}</strong></div>
            <div><small>Pointage à distance</small><strong>{productProfile.can_remote ? "Autorisé" : "Sur site uniquement"}</strong></div>
            <div><small>Organisation</small><strong>{access.organisation.name}</strong></div>
          </section>
          <div className="settings-tip"><KeyRound size={18} /><p>Votre rôle, votre règle hors connexion et votre identifiant sont protégés. Un propriétaire ou un administrateur les gère depuis l’espace Équipe.</p></div>
          <div className="settings-tip"><MapPin size={18} /><p>Les règles de localisation seront affichées ici lorsqu’un site de pointage vous sera attribué.</p></div>
        </aside>
      </div>
    </div>
  );
}
