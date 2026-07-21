export type PlanCode = "free" | "essential" | "team" | "scale";
export type PaidPlanCode = Extract<PlanCode, "essential" | "team">;
export type BillingCycle = "month" | "year";

export type PlanDefinition = {
  code: PlanCode;
  name: string;
  eyebrow: string;
  promise: string;
  description: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  seatLimit: number | null;
  candidateLimit: number | null;
  activeOfferLimit: number | null;
  offerMatchingLimit: number | null;
  collectionsEnabled: boolean;
  interviewGuidesEnabled: boolean;
  teamManagementEnabled: boolean;
  featured?: boolean;
  features: readonly string[];
};

export const PLAN_CATALOG: readonly PlanDefinition[] = [
  {
    code: "free",
    name: "Free",
    eyebrow: "Découverte · 30 jours",
    promise: "Validez votre méthode sur un premier recrutement.",
    description: "Un espace complet pour créer une offre, importer vos premiers profils et mesurer la valeur de ZeRecruit.",
    monthlyPrice: 0,
    annualPrice: 0,
    seatLimit: 1,
    candidateLimit: 100,
    activeOfferLimit: 1,
    offerMatchingLimit: 3,
    collectionsEnabled: false,
    interviewGuidesEnabled: false,
    teamManagementEnabled: false,
    features: [
      "1 utilisateur",
      "Jusqu’à 100 profils",
      "Création d’offres et pipeline",
      "Recherche intelligente",
      "3 matchings offre–profil",
    ],
  },
  {
    code: "essential",
    name: "Essentiel",
    eyebrow: "Pour un recruteur autonome",
    promise: "Recrutez plus vite sans multiplier les outils.",
    description: "Le nécessaire pour structurer un vivier durable, retrouver les bons profils et piloter chaque recrutement.",
    monthlyPrice: 9_000,
    annualPrice: 90_000,
    seatLimit: 1,
    candidateLimit: 1_000,
    activeOfferLimit: null,
    offerMatchingLimit: null,
    collectionsEnabled: true,
    interviewGuidesEnabled: true,
    teamManagementEnabled: false,
    features: [
      "1 utilisateur",
      "Jusqu’à 1 000 profils",
      "Offres et pipelines illimités",
      "Recherche et matching intelligents",
      "Collections de profils",
      "Support par email",
    ],
  },
  {
    code: "team",
    name: "Équipe",
    eyebrow: "Pour recruter à plusieurs",
    promise: "Alignez toute l’équipe autour des meilleurs profils.",
    description: "Un espace partagé pour répartir les rôles, conduire les entretiens et décider avec le même niveau d’information.",
    monthlyPrice: 30_000,
    annualPrice: 300_000,
    seatLimit: 8,
    candidateLimit: 10_000,
    activeOfferLimit: null,
    offerMatchingLimit: null,
    collectionsEnabled: true,
    interviewGuidesEnabled: true,
    teamManagementEnabled: true,
    featured: true,
    features: [
      "8 utilisateurs inclus",
      "Jusqu’à 10 000 profils",
      "Rôles et droits d’accès",
      "Pipelines collaboratifs",
      "Guides et comptes-rendus d’entretien",
      "Support prioritaire",
    ],
  },
  {
    code: "scale",
    name: "Scale",
    eyebrow: "Pour les grands volumes",
    promise: "Adaptez ZeRecruit à votre organisation.",
    description: "Des volumes, un accompagnement et des garanties adaptés à vos processus et contraintes internes.",
    monthlyPrice: null,
    annualPrice: null,
    seatLimit: null,
    candidateLimit: null,
    activeOfferLimit: null,
    offerMatchingLimit: null,
    collectionsEnabled: true,
    interviewGuidesEnabled: true,
    teamManagementEnabled: true,
    features: [
      "Utilisateurs et profils sur mesure",
      "Imports à grande échelle",
      "Paramétrage accompagné",
      "Revue sécurité dédiée",
      "Support renforcé",
    ],
  },
] as const;

export function getPlan(plan: string | null | undefined) {
  return PLAN_CATALOG.find((item) => item.code === plan) ?? PLAN_CATALOG[0];
}

export function getPaidPlan(plan: string): PlanDefinition | null {
  const definition = PLAN_CATALOG.find((item) => item.code === plan);
  return definition?.code === "essential" || definition?.code === "team" ? definition : null;
}

export function getPlanPrice(plan: PlanDefinition, cycle: BillingCycle) {
  return cycle === "year" ? plan.annualPrice : plan.monthlyPrice;
}

export function formatXof(amount: number) {
  return new Intl.NumberFormat("fr-FR").format(amount);
}

export function hasActivePlanAccess(organisation: {
  plan: string;
  plan_expires_at?: string | null;
  trial_ends_at?: string | null;
  billing_status?: string | null;
}) {
  const end = organisation.plan === "free" ? organisation.trial_ends_at : organisation.plan_expires_at;
  if (!end) return organisation.billing_status !== "expired" && organisation.billing_status !== "suspended";
  return new Date(end).getTime() > Date.now() && organisation.billing_status !== "suspended";
}
