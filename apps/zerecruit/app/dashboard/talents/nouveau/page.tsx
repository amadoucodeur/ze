import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Check, Files, Sparkles, UsersRound } from "lucide-react";
import { TalentForm } from "@/components/talents/talent-form";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Importer des CV" };

export default async function NewTalentPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id) redirect("/dashboard/organisation/nouvelle");
  if (profile.role === "viewer") redirect("/dashboard/talents");

  return (
    <div className="dashboard-settings-page new-talent-page">
      <Link className="dashboard-back-link" href="/dashboard/talents"><ArrowLeft size={17} /> Retour aux talents</Link>
      <header className="dashboard-content-header"><div><span>Import de profils</span><h1>Ajoutez tout un lot de CV, en une seule fois.</h1><p>Sélectionnez jusqu’à 25 documents de personnes différentes. ZeRecruit crée et suit chaque profil séparément.</p></div><div className="settings-page-avatar"><Sparkles size={24} /></div></header>
      <div className="cv-import-value-strip" aria-label="Fonctionnement de l’import">
        <span><Files size={18} /><b>Import multiple</b><small>PDF, DOCX, TXT ou MD</small></span>
        <span><UsersRound size={18} /><b>Un fichier, un profil</b><small>Chaque personne reste distincte</small></span>
        <span><Check size={18} /><b>Résultats conservés</b><small>Un échec ne bloque pas le lot</small></span>
      </div>
      <TalentForm />
    </div>
  );
}
