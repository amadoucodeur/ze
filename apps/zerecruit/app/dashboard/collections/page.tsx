import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderLock } from "lucide-react";
import { CollectionManager } from "@/components/collections/collection-manager";
import { getPlan, hasActivePlanAccess } from "@/lib/billing/plans";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Collections de talents" };
export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id) redirect("/dashboard");
  const plan = getPlan(profile.organisation?.plan);
  const enabled = Boolean(profile.organisation) && hasActivePlanAccess(profile.organisation!) && plan.collectionsEnabled;

  return (
    <div className="collections-page">
      <header className="dashboard-content-header"><div><span>Vivier</span><h1>Collections</h1><p>Regroupez les profils utiles par poste, mission ou campagne et partagez-les avec votre équipe.</p></div></header>
      {enabled ? <CollectionManager canManage={profile.role !== "viewer"} /> : <section className="plan-gate-card"><FolderLock size={28} /><h2>Organisez votre vivier avec les collections</h2><p>Cette fonction est disponible avec Essentiel et Équipe. Vos profils restent accessibles sans modification.</p>{profile.role === "owner" ? <Link className="button button-primary" href="/dashboard/abonnement?plan=essential">Voir les plans</Link> : <span>Demandez au propriétaire de mettre à niveau le plan.</span>}</section>}
    </div>
  );
}
