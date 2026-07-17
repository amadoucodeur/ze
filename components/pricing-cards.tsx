"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Sparkles } from "lucide-react";

type BillingCycle = "monthly" | "annual";

const plans = [
  {
    name: "Free",
    eyebrow: "Pour découvrir",
    description: "Testez la valeur de votre CVthèque pendant un mois, sans carte bancaire.",
    monthlyPrice: "0",
    annualPrice: "0",
    annualTotal: "Accès gratuit pendant 1 mois",
    features: [
      "1 mois d’accès offert",
      "1 utilisateur inclus",
      "Jusqu’à 100 profils",
      "Import de CV inclus",
      "Recherche intelligente",
      "3 matchings par mois",
    ],
    cta: "Commencer gratuitement",
    free: true,
  },
  {
    name: "Essentiel",
    eyebrow: "Pour démarrer",
    description: "Transformez vos premiers CV en vivier structuré et facile à rechercher.",
    monthlyPrice: "9 000",
    annualPrice: "7 500",
    annualTotal: "90 000 FCFA facturés par an",
    features: [
      "1 utilisateur inclus",
      "Jusqu’à 1 000 profils",
      "100 nouveaux CV par mois",
      "Recherche intelligente",
      "Matching candidat–offre",
      "Support par email",
    ],
    cta: "Choisir Essentiel",
  },
  {
    name: "Équipe",
    eyebrow: "Le plus choisi",
    description: "Le rythme idéal pour une équipe qui recrute régulièrement et veut collaborer.",
    monthlyPrice: "30 000",
    annualPrice: "25 000",
    annualTotal: "300 000 FCFA facturés par an",
    features: [
      "8 utilisateurs inclus",
      "Jusqu’à 10 000 profils",
      "500 nouveaux CV par mois",
      "Recherche et matching avancés",
      "Rôles et accès d’équipe",
      "Support prioritaire",
    ],
    cta: "Choisir Équipe",
    featured: true,
  },
  {
    name: "Scale",
    eyebrow: "Pour aller plus loin",
    description: "Un accompagnement et des volumes adaptés aux organisations ambitieuses.",
    monthlyPrice: "Sur devis",
    annualPrice: "Sur devis",
    annualTotal: "Une offre adaptée à votre usage",
    features: [
      "Utilisateurs selon vos besoins",
      "Volume de profils sur mesure",
      "Imports à grande échelle",
      "Paramétrage accompagné",
      "Revue sécurité dédiée",
      "Support prioritaire renforcé",
    ],
    cta: "Choisir Scale",
  },
];

export function PricingCards({ compact = false }: { compact?: boolean }) {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const annual = billingCycle === "annual";

  return (
    <div className={`pricing-module${compact ? " pricing-module-compact" : ""}`}>
      <div className="billing-toggle" aria-label="Période de facturation">
        <button type="button" className={!annual ? "active" : ""} aria-pressed={!annual} onClick={() => setBillingCycle("monthly")}>Mensuel</button>
        <button type="button" className={annual ? "active" : ""} aria-pressed={annual} onClick={() => setBillingCycle("annual")}>Annuel <span>2 mois offerts</span></button>
      </div>

      <div className="pricing-card-grid">
        {plans.map((plan) => {
          const features = compact ? plan.features.slice(0, 4) : plan.features;
          const customPrice = plan.monthlyPrice === "Sur devis";
          const freePrice = "free" in plan && plan.free;

          return (
            <article className={`pricing-card${plan.featured ? " pricing-card-featured" : ""}`} key={plan.name}>
              {plan.featured && <div className="popular-ribbon"><Sparkles size={13} /> Recommandé</div>}
              <div className="pricing-card-top">
                <span>{plan.eyebrow}</span>
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
              </div>
              <div className={`plan-price${customPrice ? " plan-price-custom" : ""}`}>
                <strong>{annual ? plan.annualPrice : plan.monthlyPrice}</strong>
                {!customPrice && <div><span>FCFA</span><small>/ mois</small></div>}
              </div>
              <p className="billing-note">{freePrice ? plan.annualTotal : annual ? plan.annualTotal : customPrice ? "Une offre adaptée à votre usage" : "Facturation mensuelle, sans engagement annuel"}</p>
              <Link className={`button plan-button ${plan.featured ? "button-lime" : "button-primary"}`} href={`/inscription?plan=${plan.name.toLowerCase()}`}>
                {plan.cta} <ArrowRight size={17} />
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
