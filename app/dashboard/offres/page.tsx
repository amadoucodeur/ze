import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { OfferList } from "@/components/offers/offer-list";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Offres" };

export default async function OffersPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id) redirect("/dashboard");
  const canManage = profile.role !== "viewer";
  return <div className="offers-page"><header className="dashboard-content-header"><div><span>Recrutement</span><h1>Offres</h1><p>Cadrez le besoin, trouvez les profils pertinents et suivez chaque recrutement.</p></div>{canManage && <Link className="button button-primary" href="/dashboard/offres/nouvelle"><Plus size={18} /> Créer une offre</Link>}</header><OfferList canManage={canManage} /></div>;
}
