import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, UserPlus } from "lucide-react";
import { TalentForm } from "@/components/talents/talent-form";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Ajouter un talent" };

export default async function NewTalentPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id) redirect("/dashboard/organisation/nouvelle");
  if (profile.role === "viewer") redirect("/dashboard/talents");

  return (
    <div className="dashboard-settings-page new-talent-page">
      <Link className="dashboard-back-link" href="/dashboard/talents"><ArrowLeft size={17} /> Retour aux talents</Link>
      <header className="dashboard-content-header"><div><span>Nouveau profil</span><h1>Ajouter un talent</h1><p>Créez un profil utile maintenant, puis enrichissez-le au fil de vos échanges.</p></div><div className="settings-page-avatar"><UserPlus size={24} /></div></header>
      <TalentForm />
    </div>
  );
}
