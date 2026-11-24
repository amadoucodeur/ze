/**
 * Déduction salariale des retards d'arrivée.
 *
 * Méthode de calcul transmise par l'organisation :
 * - base mensuelle conventionnelle : 8 h × 5 jours × 4 semaines = 160 h, soit 9 600 minutes ;
 * - coût minute = salaire net mensuel / 9 600 ;
 * - déduction = total des retards d'arrivée (minutes) × coût minute ;
 * - net résultant = salaire net mensuel − déduction ;
 * - montants arrondis au franc CFA le plus proche.
 */
export const MONTHLY_WORK_MINUTES = 8 * 5 * 4 * 60;

export type LateDeduction = {
  minuteCost: number;
  deduction: number;
  netAfterDeduction: number;
};

export function computeLateDeduction(
  monthlyNetSalary: number | null | undefined,
  totalArrivalLateMinutes: number,
): LateDeduction | null {
  if (monthlyNetSalary === null || monthlyNetSalary === undefined) return null;
  if (!Number.isFinite(monthlyNetSalary) || monthlyNetSalary < 0) return null;
  const lateMinutes = Math.max(0, totalArrivalLateMinutes);
  const minuteCost = monthlyNetSalary / MONTHLY_WORK_MINUTES;
  const deduction = Math.min(Math.round(lateMinutes * minuteCost), monthlyNetSalary);
  return {
    minuteCost,
    deduction,
    netAfterDeduction: Math.round(monthlyNetSalary - deduction),
  };
}

export function fcfaLabel(amount: number | null | undefined) {
  if (amount === null || amount === undefined) return "—";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount)} FCFA`;
}
