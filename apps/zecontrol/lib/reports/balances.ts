export type BalanceEligibleDay = {
  isPotentialAbsence: boolean;
  end?: unknown;
  evaluation: {
    automaticClosure: "none" | "scheduled_end" | "break_start";
  } | null;
};

/**
 * A balance must include every past scheduled day, including a day with no
 * pointage. Completed and automatically closed days remain eligible as well.
 */
export function isBalanceEligibleDay(day: BalanceEligibleDay) {
  return Boolean(
    day.evaluation &&
      (day.isPotentialAbsence ||
        day.end ||
        day.evaluation.automaticClosure !== "none"),
  );
}
