import type { Metadata } from "next";
import { UnifiedAuthForm } from "@/components/auth/credentials-form";

export const metadata: Metadata = { title: "Créer un compte" };
type SignupPageProps = { searchParams: Promise<{ plan?: string; cycle?: string }> };
export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const selectedPlan = ["free", "essential", "team", "scale"].includes(params.plan || "") ? params.plan : null;
  const selectedCycle = params.cycle === "year" ? "year" : "month";
  return <UnifiedAuthForm selectedPlan={selectedPlan} selectedCycle={selectedCycle} />;
}
