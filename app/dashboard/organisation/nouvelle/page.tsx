import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2, Check, Sparkles } from "lucide-react";
import { OrganisationForm } from "@/components/settings/organisation-form";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Créer mon entreprise" };

export default async function CreateOrganisationPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (profile.role !== "owner") redirect("/dashboard");
  if (profile.organisation_id) redirect("/dashboard/parametres/organisation");

  return (
    <div className="dashboard-settings-page organisation-onboarding">
      <div className="onboarding-progress"><span className="complete"><Check size={13} /> Compte créé</span><i /><span className="current">2. Votre entreprise</span><i /><span>3. Premier vivier</span></div>
      <header className="dashboard-content-header onboarding-header"><div><span>Bienvenue, {profile.fullname}</span><h1>Créons votre espace de recrutement.</h1><p>Quelques informations suffisent pour configurer votre organisation et isoler correctement ses données.</p></div><div className="settings-page-avatar onboarding-avatar"><Building2 size={25} /></div></header>
      <div className="onboarding-value-strip"><Sparkles size={19} /><p><strong>Un espace dédié à votre entreprise.</strong> Vos candidats, utilisateurs et paramètres resteront regroupés dans cette organisation.</p></div>
      <OrganisationForm mode="create" defaultEmail={profile.email} />
    </div>
  );
}
