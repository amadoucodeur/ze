import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { OfferList } from "@/components/offers/offer-list";
import { getActiveOfferCapacity } from "@/lib/billing/entitlements";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Offres" };

export default async function OffersPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id) redirect("/dashboard");
  const capacity = profile.organisation ? await getActiveOfferCapacity(profile.organisation) : null;
  const canManage = profile.role !== "viewer";
  const canCreate = canManage && Boolean(capacity?.allowed);
  return <div className="offers-page"><header className="dashboard-content-header"><div><span>Recrutement</span><h1>Offres</h1><p>Cadrez le besoin, trouvez les profils pertinents et suivez chaque recrutement.</p></div>{canCreate && <Link className="button button-primary" href="/dashboard/offres/nouvelle"><Plus size={18} /> Créer une offre</Link>}</header>{canManage && capacity && !capacity.allowed && <div className="plan-limit-notice" role="status"><div><strong>{capacity.reason === "inactive" ? "Création suspendue" : "Recrutement Free déjà utilisé"}</strong><span>{capacity.reason === "inactive" ? "Renouvelez le plan pour créer une nouvelle offre." : "Clôturez l’offre active ou passez à Essentiel pour gérer plusieurs recrutements."}</span></div>{profile.role === "owner" && <Link href="/dashboard/abonnement?plan=essential">Voir Essentiel</Link>}</div>}<OfferList canManage={canManage} /></div>;
}
