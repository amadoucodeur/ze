import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, ArrowLeft, BriefcaseBusiness, CalendarDays, Check, Clock3, CreditCard, Crown, Download, ReceiptText, ShieldCheck } from "lucide-react";
import { BillingPlanSelector } from "@/components/billing/billing-plan-selector";
import { getPlanUsage } from "@/lib/billing/entitlements";
import { formatXof, getPlan, hasActivePlanAccess, type BillingCycle } from "@/lib/billing/plans";
import { getCurrentProfile } from "@/lib/supabase/current-profile";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Plan et facturation" };
export const dynamic = "force-dynamic";

type BillingPageProps = { searchParams: Promise<{ payment?: string; plan?: string; cycle?: string }> };
type PaymentHistory = {
  id: string;
  plan_code: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  status: string;
  receipt_url: string | null;
  created_at: string;
  paid_at: string | null;
};

const statusLabels: Record<string, string> = {
  initiated: "Préparation",
  pending: "En attente",
  completed: "Payé",
  cancelled: "Annulé",
  failed: "Échoué",
  error: "À reprendre",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(value));
}

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (profile.role !== "owner") redirect("/dashboard");
  if (!profile.organisation_id || !profile.organisation) redirect("/dashboard/organisation/nouvelle");
  const params = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("billing_payments")
    .select("id, plan_code, billing_cycle, amount, currency, status, receipt_url, created_at, paid_at")
    .order("created_at", { ascending: false })
    .limit(12);
  const payments = (data ?? []) as PaymentHistory[];
  const organisation = profile.organisation;
  const plan = getPlan(organisation.plan);
  const usage = await getPlanUsage(organisation.id);
  const accessActive = hasActivePlanAccess(organisation);
  const accessEnd = organisation.plan === "free" ? organisation.trial_ends_at : organisation.plan_expires_at;
  const requestedCycle: BillingCycle = params.cycle === "year" ? "year" : "month";

  return <div className="dashboard-settings-page billing-page">
    <Link className="dashboard-back-link" href="/dashboard/parametres/organisation"><ArrowLeft size={15} /> Retour à l’organisation</Link>
    <header className="dashboard-content-header"><div><span>Organisation</span><h1>Plan et facturation</h1><p>Un seul endroit pour comprendre votre accès, renouveler et retrouver vos reçus.</p></div><div className="settings-page-avatar"><CreditCard size={23} /></div></header>
    {params.payment === "cancelled" && <div className="billing-notice is-warning" role="status"><AlertCircle size={20} /><div><strong>Paiement interrompu</strong><p>Aucun montant n’a été activé. Vous pouvez reprendre lorsque vous êtes prêt.</p></div></div>}

    <section className={`billing-current-plan${accessActive ? "" : " is-expired"}`} aria-labelledby="current-plan-title">
      <div className="billing-current-main"><span><Crown size={22} /></span><div><small>Plan actuel</small><h2 id="current-plan-title">{plan.name}</h2><p>{accessActive ? plan.promise : "Votre période d’accès est terminée. Vos données restent conservées."}</p></div></div>
      <div className="billing-current-meta"><div><CalendarDays size={17} /><span>{accessActive ? organisation.plan === "free" ? "Fin de la découverte" : "Accès actif jusqu’au" : "Accès arrivé à échéance"}</span><strong>{formatDate(accessEnd)}</strong></div><div><ShieldCheck size={17} /><span>Utilisateurs actifs</span><strong>{usage.seats} / {plan.seatLimit ?? "∞"}</strong></div><div><ReceiptText size={17} /><span>Profils dans le vivier</span><strong>{formatXof(usage.candidates)} / {plan.candidateLimit ? formatXof(plan.candidateLimit) : "∞"}</strong></div><div><BriefcaseBusiness size={17} /><span>Recrutement et matching</span><strong>{plan.code === "free" ? `${usage.activeOffers}/1 actif · ${usage.offerMatchings}/3 matchings` : "Illimités"}</strong></div></div>
    </section>

    <BillingPlanSelector currentPlan={plan.code} initialCycle={requestedCycle} requestedPlan={params.plan} />

    <section className="billing-history" aria-labelledby="billing-history-title">
      <div><span>Historique</span><h2 id="billing-history-title">Vos paiements</h2><p>Les tentatives et reçus PayDunya de cette organisation.</p></div>
      {payments.length ? <div className="billing-history-table"><div className="billing-history-row is-heading"><span>Date</span><span>Plan</span><span>Montant</span><span>Statut</span><span>Reçu</span></div>{payments.map((payment) => <div className="billing-history-row" key={payment.id}><span>{formatDate(payment.paid_at || payment.created_at)}</span><strong>{getPlan(payment.plan_code).name} · {payment.billing_cycle === "year" ? "Annuel" : "Mensuel"}</strong><span>{formatXof(payment.amount)} FCFA</span><span className={`billing-payment-status is-${payment.status}`}>{payment.status === "pending" ? <Clock3 size={14} /> : payment.status === "completed" ? <Check size={14} /> : <AlertCircle size={14} />}{statusLabels[payment.status] || payment.status}</span>{payment.receipt_url ? <a href={payment.receipt_url} target="_blank" rel="noreferrer"><Download size={15} /> Reçu</a> : <span>—</span>}</div>)}</div> : <div className="billing-history-empty"><ReceiptText size={24} /><strong>Aucun paiement pour le moment</strong><p>Votre premier règlement apparaîtra ici après sa préparation.</p></div>}
    </section>
  </div>;
}
