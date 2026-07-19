import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CollectionManager } from "@/components/collections/collection-manager";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Collections de talents" };
export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id) redirect("/dashboard");

  return (
    <div className="collections-page">
      <header className="dashboard-content-header"><div><span>Vivier</span><h1>Collections</h1><p>Regroupez les profils utiles par poste, mission ou campagne et partagez-les avec votre équipe.</p></div></header>
      <CollectionManager canManage={profile.role !== "viewer"} />
    </div>
  );
}
