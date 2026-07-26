import type { Metadata } from "next";
import {
  AlertCircle,
  CalendarDays,
  Check,
  Clock3,
  CreditCard,
  ReceiptText,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { redirect } from "next/navigation";
import { CheckoutButton } from "@/components/billing/checkout-button";
import {
  getBillingOverview,
  type BillingPeriod,
} from "@/lib/billing/overview";
import {
  formatBillingPeriod,
  formatXof,
} from "@/lib/billing/pricing";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const metadata: Metadata = { title: "Facturation" };
export const dynamic = "force-dynamic";

const periodStatusLabels = {
  open: "En cours",
  closed: "À régler",
  overdue: "En retard",
  paid: "Payée",
  void: "Sans facturation",
};

const paymentStatusLabels: Record<string, string> = {
  initiated: "Préparation",
  pending: "En attente",
  completed: "Payé",
  cancelled: "Annulé",
  failed: "Échoué",
  error: "À reprendre",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function OutstandingPeriodCard({ period }: { period: BillingPeriod }) {
  return (
    <article
      className={`zec-invoice-due-card is-${period.status}`}
      key={period.id}
    >
      <div className="zec-invoice-due-icon">
        <ReceiptText size={21} />
      </div>
      <div className="zec-invoice-due-copy">
        <small>
          {period.status === "overdue"
            ? "Paiement en retard"
            : "Période terminée"}
        </small>
        <strong>
          {formatBillingPeriod(
            period.period_starts_at,
            period.period_ends_at,
          )}
        </strong>
        <span>
          {period.billable_user_count} collaborateur
          {period.billable_user_count > 1 ? "s" : ""} ayant pointé
        </span>
      </div>
      <div className="zec-invoice-due-total">
        <small>À régler</small>
        <strong>{formatXof(period.amount_due)} F</strong>
        {period.due_at && <span>Échéance {formatDate(period.due_at)}</span>}
      </div>
      <CheckoutButton periodId={period.id} />
    </article>
  );
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (
    access.status !== "ready" ||
    !access.organisation ||
    access.productProfile?.role !== "owner"
  ) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  let overview;
  try {
    overview = await getBillingOverview(access.organisation.id);
  } catch (error) {
    return (
      <div className="dashboard-settings-page zec-billing-page">
        <header className="dashboard-content-header">
          <div>
            <span>Organisation</span>
            <h1>Facturation</h1>
            <p>Payez uniquement les collaborateurs qui ont pointé.</p>
          </div>
          <div className="settings-page-avatar">
            <CreditCard size={23} />
          </div>
        </header>
        <div className="billing-notice is-warning" role="alert">
          <AlertCircle size={20} />
          <div>
            <strong>La facturation doit être initialisée</strong>
            <p>
              {error instanceof Error
                ? error.message
                : "Appliquez la dernière migration ZeControl puis rechargez cette page."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const currentPeriod = overview.periods.find(
    (period) => period.status === "open",
  );
  const currentUsage = currentPeriod
    ? overview.usage.filter(
        (usage) => usage.period_id === currentPeriod.id,
      )
    : [];
  const outstandingPeriods = overview.periods.filter(
    (period) =>
      (period.status === "closed" || period.status === "overdue") &&
      period.amount_due > 0,
  );
  const paidPeriods = overview.periods.filter(
    (period) => period.status === "paid",
  );
  const currentTotal = currentPeriod?.amount_due ?? 0;

  return (
    <div className="dashboard-settings-page zec-billing-page">
      <header className="dashboard-content-header">
        <div>
          <span>Organisation</span>
          <h1>Facturation</h1>
          <p>
            Aucun paiement à l’avance. Vous réglez uniquement les
            collaborateurs qui ont réellement pointé.
          </p>
        </div>
        <div className="settings-page-avatar">
          <CreditCard size={23} />
        </div>
      </header>

      {params.payment === "cancelled" && (
        <div className="billing-notice is-warning" role="status">
          <AlertCircle size={20} />
          <div>
            <strong>Paiement interrompu</strong>
            <p>
              La facture reste disponible. Vous pourrez reprendre son
              règlement quand vous le souhaitez.
            </p>
          </div>
        </div>
      )}

      {overview.accountStatus === "past_due" && (
        <div className="billing-notice is-warning" role="alert">
          <AlertCircle size={20} />
          <div>
            <strong>Une facture a dépassé son échéance</strong>
            <p>
              Réglez-la pour permettre à votre équipe d’enregistrer de
              nouveaux pointages.
            </p>
          </div>
        </div>
      )}

      {outstandingPeriods.length > 0 && (
        <section
          className="zec-invoices-due"
          aria-labelledby="invoices-due-title"
        >
          <div className="zec-section-heading">
            <div>
              <span>À régler</span>
              <h2 id="invoices-due-title">Factures disponibles</h2>
            </div>
            <ShieldCheck size={22} />
          </div>
          <div className="zec-invoices-due-list">
            {outstandingPeriods.map((period) => (
              <OutstandingPeriodCard period={period} key={period.id} />
            ))}
          </div>
        </section>
      )}

      <section
        className="zec-current-bill"
        aria-labelledby="current-bill-title"
      >
        <div className="zec-current-bill-head">
          <div>
            <span className="zec-live-dot" />
            <div>
              <small>Facture en cours</small>
              <h2 id="current-bill-title">
                {currentPeriod
                  ? formatBillingPeriod(
                      currentPeriod.period_starts_at,
                      currentPeriod.period_ends_at,
                    )
                  : "Période courante"}
              </h2>
            </div>
          </div>
          <div className="zec-current-total">
            <small>Total provisoire</small>
            <strong>{formatXof(currentTotal)} F</strong>
          </div>
        </div>

        <div className="zec-billing-metrics">
          <article>
            <span>
              <UsersRound size={19} />
            </span>
            <div>
              <small>Ont pointé</small>
              <strong>{currentUsage.length}</strong>
            </div>
          </article>
          <article>
            <span>
              <CreditCard size={19} />
            </span>
            <div>
              <small>Prix unitaire</small>
              <strong>
                {formatXof(currentPeriod?.unit_price ?? 300)} F
              </strong>
            </div>
          </article>
          <article>
            <span>
              <CalendarDays size={19} />
            </span>
            <div>
              <small>Clôture</small>
              <strong>
                {currentPeriod
                  ? formatDate(currentPeriod.period_ends_at)
                  : "Fin du mois"}
              </strong>
            </div>
          </article>
        </div>

        <div className="zec-usage-list">
          <div className="zec-usage-list-head">
            <strong>Collaborateurs comptabilisés</strong>
            <span>
              Le premier pointage valide ajoute une seule ligne pour le
              mois.
            </span>
          </div>
          {currentUsage.length ? (
            <div className="zec-usage-rows">
              {currentUsage.map((usage) => (
                <article key={usage.id}>
                  <span className="zec-usage-avatar">
                    {usage.fullname.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <strong>{usage.fullname}</strong>
                    <small>{usage.identifiant}</small>
                  </div>
                  <time dateTime={usage.first_qualified_at}>
                    Première utilisation{" "}
                    {new Intl.DateTimeFormat("fr-FR", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(usage.first_qualified_at))}
                  </time>
                  <strong>{formatXof(usage.unit_price)} F</strong>
                </article>
              ))}
            </div>
          ) : (
            <div className="zec-usage-empty">
              <Clock3 size={24} />
              <strong>Aucun collaborateur facturé</strong>
              <p>
                La première ligne apparaîtra dès qu’un pointage valide sera
                enregistré.
              </p>
            </div>
          )}
        </div>
      </section>

      <section
        className="zec-billing-history"
        aria-labelledby="billing-history-title"
      >
        <div className="zec-section-heading">
          <div>
            <span>Historique</span>
            <h2 id="billing-history-title">Périodes et paiements</h2>
          </div>
          <ReceiptText size={22} />
        </div>
        <div className="zec-history-table">
          <div className="zec-history-row is-heading">
            <span>Période</span>
            <span>Utilisateurs</span>
            <span>Montant</span>
            <span>Statut</span>
            <span>Reçu</span>
          </div>
          {overview.periods
            .filter((period) => period.status !== "open")
            .map((period) => {
              const payment = overview.payments.find(
                (item) =>
                  item.period_id === period.id &&
                  item.status === "completed",
              );
              return (
                <div className="zec-history-row" key={period.id}>
                  <strong>
                    {formatBillingPeriod(
                      period.period_starts_at,
                      period.period_ends_at,
                    )}
                  </strong>
                  <span>{period.billable_user_count}</span>
                  <span>{formatXof(period.amount_due)} F</span>
                  <span
                    className={`zec-period-status is-${period.status}`}
                  >
                    {period.status === "paid" ? (
                      <Check size={14} />
                    ) : (
                      <Clock3 size={14} />
                    )}
                    {periodStatusLabels[period.status]}
                  </span>
                  {payment?.receipt_url ? (
                    <a
                      href={payment.receipt_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Reçu
                    </a>
                  ) : (
                    <span>—</span>
                  )}
                </div>
              );
            })}
          {!paidPeriods.length &&
            !outstandingPeriods.length &&
            overview.periods.filter((period) => period.status !== "open")
              .length === 0 && (
              <div className="zec-history-empty">
                Votre première période clôturée apparaîtra ici.
              </div>
            )}
        </div>
        {overview.payments.some(
          (payment) => payment.status !== "completed",
        ) && (
          <p className="zec-payment-attempts-note">
            Dernière tentative :{" "}
            {paymentStatusLabels[overview.payments[0]?.status] ??
              overview.payments[0]?.status}
          </p>
        )}
      </section>
    </div>
  );
}

