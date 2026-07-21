import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, ReceiptText } from "lucide-react";
import { formatXof, getPlan } from "@/lib/billing/plans";
import { synchronizePayDunyaPayment, type PaymentSyncResult } from "@/lib/billing/payments";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export const metadata: Metadata = { title: "Confirmation du paiement" };
export const dynamic = "force-dynamic";

type ReturnPageProps = { searchParams: Promise<{ token?: string }> };

export default async function BillingReturnPage({ searchParams }: ReturnPageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (profile.role !== "owner" || !profile.organisation_id) redirect("/dashboard");
  const { token } = await searchParams;
  let result: PaymentSyncResult | null = null;
  let message = "La référence du paiement est absente. Revenez à votre abonnement pour reprendre.";
  if (token) {
    try {
      result = await synchronizePayDunyaPayment(token, profile.organisation_id);
      if (result.status === "completed") {
        revalidatePath("/dashboard", "layout");
        revalidatePath("/dashboard/abonnement");
      }
    } catch (error) {
      message = error instanceof Error ? error.message : "Le paiement n’a pas encore pu être vérifié.";
    }
  }
  const plan = result ? getPlan(result.planCode) : null;
  const completed = result?.status === "completed";
  const pending = result?.status === "pending";

  return <div className="billing-return-page">
    <section className={`billing-return-card${completed ? " is-success" : pending ? " is-pending" : " is-error"}`}>
      <span>{completed ? <CheckCircle2 size={34} /> : pending ? <Clock3 size={34} /> : <AlertCircle size={34} />}</span>
      <small>{completed ? "Paiement confirmé" : pending ? "Paiement en cours" : "Vérification nécessaire"}</small>
      <h1>{completed ? `Le plan ${plan?.name} est actif.` : pending ? "PayDunya traite encore le paiement." : "Le plan n’a pas encore été activé."}</h1>
      <p>{completed && result ? `Le règlement de ${formatXof(result.amount)} FCFA a été vérifié. Votre équipe peut continuer à utiliser ZeRecruit.` : pending ? "Le délai peut dépendre de la validation Mobile Money. Actualisez cette page dans un instant ou revenez à votre abonnement." : message}</p>
      {completed && result?.periodEndsAt && <div className="billing-return-period"><strong>Accès jusqu’au</strong><span>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(result.periodEndsAt))}</span></div>}
      <div>{result?.receiptUrl && <a className="button button-secondary" href={result.receiptUrl} target="_blank" rel="noreferrer"><ReceiptText size={17} /> Ouvrir le reçu</a>}<Link className="button button-primary" href="/dashboard/abonnement">{pending ? "Vérifier plus tard" : "Voir mon abonnement"} <ArrowRight size={17} /></Link></div>
    </section>
  </div>;
}
