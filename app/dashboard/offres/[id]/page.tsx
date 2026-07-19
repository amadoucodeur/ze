import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { OfferWorkspace } from "@/components/offers/offer-workspace";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Offre" };
export const dynamic = "force-dynamic";

export default async function OfferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const profile = await getCurrentProfile(); if (!profile) redirect("/connexion"); if (!profile.organisation_id) redirect("/dashboard");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <div className="offer-detail-page"><Link className="dashboard-back-link" href="/dashboard/offres"><ArrowLeft size={17} /> Retour aux offres</Link><OfferWorkspace offerId={id} canManage={profile.role !== "viewer"} justCreated={query.created === "1"} /></div>;
}
