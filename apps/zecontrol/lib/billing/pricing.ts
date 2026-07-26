export function formatXof(amount: number) {
  return new Intl.NumberFormat("fr-FR").format(amount);
}

export function formatBillingPeriod(start: string, end: string) {
  const startDate = new Date(start);
  const inclusiveEnd = new Date(new Date(end).getTime() - 1);
  const formatter = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${formatter.format(startDate)} – ${formatter.format(inclusiveEnd)}`;
}

