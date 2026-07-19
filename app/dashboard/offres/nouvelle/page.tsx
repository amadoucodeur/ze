import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BriefcaseBusiness } from "lucide-react";
import { OfferForm } from "@/components/offers/offer-form";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Créer une offre" };

export default async function NewOfferPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id) redirect("/dashboard/organisation/nouvelle");
  if (profile.role === "viewer") redirect("/dashboard/offres");
  return <div className="new-offer-page">
    <Link className="dashboard-back-link" href="/dashboard/offres"><ArrowLeft size={17} /> Retour aux offres</Link>
    <header className="dashboard-content-header"><div><span>Nouvelle offre</span><h1>Transformez le besoin réel en critères utiles.</h1><p>Combinez champs, documents et texte libre. Vous gardez le dernier mot sur chaque exigence.</p></div><div className="settings-page-avatar"><BriefcaseBusiness size={24} /></div></header>
    <OfferForm />
  </div>;
}
