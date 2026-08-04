import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ReceiptText,
} from "lucide-react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatXof } from "@/lib/billing/pricing";
import {
  synchronizePayDunyaPayment,
  type PaymentSyncResult,
} from "@/lib/billing/payments";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const metadata: Metadata = { title: "Confirmation du paiement" };
export const dynamic = "force-dynamic";

export default async function BillingReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (
    access.productProfile?.role !== "owner" ||
    !access.organisation
  ) {
    redirect("/dashboard");
  }

  const { token } = await searchParams;
  let result: PaymentSyncResult | null = null;
  let message =
    "La référence du paiement est absente. Revenez à la facturation pour reprendre.";
  if (token) {
    try {
      result = await synchronizePayDunyaPayment(
        token,
        access.organisation.id,
      );
      if (result.status === "completed") {
        revalidatePath("/dashboard", "layout");
        revalidatePath("/dashboard/facturation");
      }
    } catch (error) {
      message =
        error instanceof Error
          ? error.message
          : "Le paiement n’a pas encore pu être vérifié.";
    }
  }

  const completed = result?.status === "completed";
  const pending = result?.status === "pending";

  return (
    <div className="billing-return-page">
      <section
        className={`billing-return-card${
          completed
            ? " is-success"
            : pending
              ? " is-pending"
              : " is-error"
        }`}
      >
        <span>
          {completed ? (
            <CheckCircle2 size={34} />
          ) : pending ? (
            <Clock3 size={34} />
          ) : (
            <AlertCircle size={34} />
          )}
        </span>
        <small>
          {completed
            ? "Paiement confirmé"
            : pending
              ? "Paiement en cours"
              : "Vérification nécessaire"}
        </small>
        <h1>
          {completed
            ? "La facture ZeControl est réglée."
            : pending
              ? "Le paiement est encore en cours de traitement."
              : "La facture n’a pas encore été réglée."}
        </h1>
        <p>
          {completed && result
            ? `Le règlement de ${formatXof(result.amount)} F CFA a été vérifié. Votre équipe peut continuer à pointer.`
            : pending
              ? "La validation Mobile Money peut prendre un instant. Vous pourrez vérifier à nouveau depuis la facturation."
              : message}
        </p>
        <div>
          {result?.receiptUrl && (
            <a
              className="button button-secondary"
              href={result.receiptUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ReceiptText size={17} /> Ouvrir le reçu
            </a>
          )}
          <Link
            className="button button-primary"
            href="/dashboard/facturation"
          >
            Voir la facturation <ArrowRight size={17} />
          </Link>
        </div>
      </section>
    </div>
  );
}
