"use client";

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { PLAN_CATALOG, formatXof, getPlanPrice, type BillingCycle, type PaidPlanCode } from "@/lib/billing/plans";

export function BillingPlanSelector({
  currentPlan,
  initialCycle = "month",
  requestedPlan,
}: {
  currentPlan: string;
  initialCycle?: BillingCycle;
  requestedPlan?: string | null;
}) {
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);
  const paidPlans = PLAN_CATALOG.filter((plan) => plan.code === "essential" || plan.code === "team");

  return <section className="billing-plan-section" aria-labelledby="billing-plans-title">
    <div className="billing-plan-heading"><div><span>Choisir votre rythme</span><h2 id="billing-plans-title">Un plan qui suit votre organisation</h2><p>Le paiement prolonge immédiatement votre accès après confirmation.</p></div><div className="billing-toggle" aria-label="Période de facturation"><button type="button" className={cycle === "month" ? "active" : ""} aria-pressed={cycle === "month"} onClick={() => setCycle("month")}>Mensuel</button><button type="button" className={cycle === "year" ? "active" : ""} aria-pressed={cycle === "year"} onClick={() => setCycle("year")}>Annuel <span>2 mois économisés</span></button></div></div>
    <div className="billing-plan-grid">{paidPlans.map((plan) => {
      const amount = getPlanPrice(plan, cycle);
      const active = currentPlan === plan.code;
      const requested = requestedPlan === plan.code;
      return <article className={`${plan.featured ? "is-featured" : ""}${requested ? " is-requested" : ""}`} key={plan.code}>
        {plan.featured && <span className="billing-recommended"><Sparkles size={13} /> Recommandé</span>}
        <div><small>{plan.eyebrow}</small><h3>{plan.name}</h3><strong>{plan.promise}</strong><p>{plan.description}</p></div>
        <div className="billing-plan-price"><strong>{amount ? formatXof(amount) : "—"}</strong><span>FCFA<br /><small>{cycle === "year" ? "/ an" : "/ mois"}</small></span></div>
        {cycle === "year" && amount && <p className="billing-plan-saving">Équivaut à {formatXof(Math.round(amount / 12))} FCFA par mois.</p>}
        <ul>{plan.features.map((feature) => <li key={feature}><Check size={15} /> {feature}</li>)}</ul>
        <CheckoutButton plan={plan.code as PaidPlanCode} cycle={cycle} featured={plan.featured} label={active ? `Renouveler ${plan.name}` : `Choisir ${plan.name}`} />
      </article>;
    })}</div>
    <p className="billing-provider-note"><ShieldCopy /> Le règlement s’effectue sur la page sécurisée PayDunya. ZeRecruit ne reçoit jamais votre code Mobile Money ou vos données bancaires.</p>
  </section>;
}

function ShieldCopy() {
  return <span aria-hidden="true">✓</span>;
}
