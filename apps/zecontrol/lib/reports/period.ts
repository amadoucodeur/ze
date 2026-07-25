export type ReportPeriod = "day" | "week" | "month" | "all" | "custom";

export function dateKey(date: Date, timeZone?: string) {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function defaultPeriodDates(period: ReportPeriod, reference = new Date(), timeZone?: string) {
  const end = dateKey(reference, timeZone);
  if (period === "all") return { start: "", end };
  const start = new Date(`${end}T12:00:00`);
  if (period === "week") {
    const weekday = start.getDay() || 7;
    start.setDate(start.getDate() - weekday + 1);
  } else if (period === "month") {
    start.setDate(1);
  }
  return { start: dateKey(start), end };
}

export function zonedDayBoundary(value: string, timeZone: string) {
  const [year, month, day] = value.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const representedAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return new Date(utcGuess - (representedAsUtc - utcGuess));
}

export function periodLabel(period: ReportPeriod, start: string, end: string) {
  if (period === "all") return "Toutes les données";
  const formatter = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  if (start === end) return formatter.format(new Date(`${start}T12:00:00`));
  return `${formatter.format(new Date(`${start}T12:00:00`))} — ${formatter.format(new Date(`${end}T12:00:00`))}`;
}
