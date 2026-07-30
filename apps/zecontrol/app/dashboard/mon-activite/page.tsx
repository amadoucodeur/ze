import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PersonalActivityDashboard } from "@/components/reports/personal-activity-dashboard";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const metadata: Metadata = { title: "Mon activité" };

export default async function MyActivityPage() {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (
    access.status !== "ready" ||
    !access.organisation ||
    !access.productProfile ||
    access.productProfile.role === "owner"
  ) {
    redirect("/dashboard");
  }

  return (
    <div className="agent-activity-page">
      <Link className="dashboard-back-link" href="/dashboard"><ArrowLeft size={15} /> Retour au pointage</Link>
      <PersonalActivityDashboard
        profileId={access.profile.id}
        organisationId={access.organisation.id}
        fullname={access.profile.fullname}
        service={access.productProfile.service}
        activatedAt={access.productProfile.created_at}
        timeZone={access.organisation.timezone}
      />
    </div>
  );
}
