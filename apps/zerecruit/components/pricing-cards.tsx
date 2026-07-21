"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { PLAN_CATALOG, formatXof, getPlanPrice, type BillingCycle } from "@/lib/billing/plans";

const ctaLabels = {
  free: "Commencer avec Free",
  essential: "Choisir Essentiel",
  team: "Choisir Équipe",
  scale: "Parler de vos besoins",
} as const;

export function PricingCards({ compact = false }: { compact?: boolean }) {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("month");
  const annual = billingCycle === "year";

  return (
    <div className={`pricing-module${compact ? " pricing-module-compact" : ""}`}>
      <div className="billing-toggle" aria-label="Période de facturation">
        <button type="button" className={!annual ? "active" : ""} aria-pressed={!annual} onClick={() => setBillingCycle("month")}>Mensuel</button>
        <button type="button" className={annual ? "active" : ""} aria-pressed={annual} onClick={() => setBillingCycle("year")}>Annuel <span>2 mois économisés</span></button>
      </div>

      <div className="pricing-card-grid">
        {PLAN_CATALOG.map((plan) => {
          const features = compact ? plan.features.slice(0, 4) : plan.features;
          const price = getPlanPrice(plan, billingCycle);
          const customPrice = price === null;
          const href = plan.code === "free" || plan.code === "scale"
            ? `/inscription?plan=${plan.code}`
            : `/inscription?plan=${plan.code}&cycle=${billingCycle}`;

          return (
            <article className={`pricing-card${plan.featured ? " pricing-card-featured" : ""}`} key={plan.code}>
              {plan.featured && <div className="popular-ribbon"><Sparkles size={13} /> Recommandé</div>}
              <div className="pricing-card-top">
                <span>{plan.eyebrow}</span>
                <h3>{plan.name}</h3>
                <strong className="plan-promise">{plan.promise}</strong>
                <p>{plan.description}</p>
              </div>
              <div className={`plan-price${customPrice ? " plan-price-custom" : ""}`}>
                <strong>{customPrice ? "Sur devis" : formatXof(price)}</strong>
                {!customPrice && <div><span>FCFA</span><small>{plan.code === "free" ? "/ 30 jours" : annual ? "/ an" : "/ mois"}</small></div>}
              </div>
              <p className="billing-note">{plan.code === "free" ? "Accès limité à 30 jours" : annual && price ? `Soit ${formatXof(Math.round(price / 12))} FCFA par mois` : customPrice ? "Une offre adaptée à votre usage" : "Renouvellement mensuel, sans engagement annuel"}</p>
              <Link className={`button plan-button ${plan.featured ? "button-lime" : "button-primary"}`} href={href}>
                {ctaLabels[plan.code]} <ArrowRight size={17} />
              </Link>
              <div className="plan-feature-list">
                <strong>Ce qui est inclus</strong>
                {features.map((feature) => <span key={feature}><Check size={15} /> {feature}</span>)}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
