"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Columns3,
  CalendarDays,
  Check,
  Clock3,
  Coffee,
  LoaderCircle,
  LogIn,
  LogOut,
  PenLine,
  Plus,
  RotateCcw,
  TimerReset,
  X,
} from "lucide-react";
import { EventRequestPanel, type EventRequestIntent } from "@/components/clocking/event-request-panel";
import { ReportPeriodToolbar } from "./report-period-toolbar";
import { createClient } from "@/lib/supabase/client";
import { exportCsv, exportExcel, exportPdf } from "@/lib/reports/export";
import { dateKey, defaultPeriodDates, periodLabel, type ReportPeriod } from "@/lib/reports/period";

type EventType = "start" | "break" | "resume" | "end";
type ActivityEvent = { id: string; type: EventType; event_status: "pending" | "accepted" | "rejected" | "cancelled"; pointed_at: string };
type ActivityColumn = "day" | "start" | "firstBreak" | "firstResume" | "end" | "worked" | "pause" | "status";

const typeLabels: Record<EventType, string> = { start: "Arrivée", break: "Pause", resume: "Reprise", end: "Départ" };
const typeIcons = { start: LogIn, break: Coffee, resume: RotateCcw, end: LogOut };
const columnOrder: ActivityColumn[] = ["day", "start", "firstBreak", "firstResume", "end", "worked", "pause", "status"];
const columnLabels: Record<ActivityColumn, string> = {
  day: "Journée",
  start: "Début de service",
  firstBreak: "Première pause",
  firstResume: "Première reprise",
  end: "Fin de service",
  worked: "Temps travaillé",
  pause: "Temps de pause",
  status: "État",
};
const defaultColumns = columnOrder;

function durationLabel(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}`;
}

function minutesForDay(events: ActivityEvent[], timeZone: string) {
  const valid = [...events].filter((event) => event.event_status === "accepted" || event.event_status === "pending").sort((a, b) => +new Date(a.pointed_at) - +new Date(b.pointed_at));
  let opened: number | null = null;
  let total = 0;
  for (const event of valid) {
    const time = +new Date(event.pointed_at);
    if (event.type === "start" || event.type === "resume") opened = time;
    if ((event.type === "break" || event.type === "end") && opened !== null) { total += Math.max(0, time - opened); opened = null; }
  }
  if (opened !== null && dateKey(new Date(opened), timeZone) === dateKey(new Date(), timeZone)) total += Math.max(0, Date.now() - opened);
  return Math.floor(total / 60_000);
}

function pauseMinutesForDay(events: ActivityEvent[], timeZone: string) {
  const valid = [...events].filter((event) => event.event_status === "accepted" || event.event_status === "pending").sort((a, b) => +new Date(a.pointed_at) - +new Date(b.pointed_at));
  let pausedAt: number | null = null;
  let total = 0;
  for (const event of valid) {
    const time = +new Date(event.pointed_at);
    if (event.type === "break") pausedAt = time;
    if ((event.type === "resume" || event.type === "end") && pausedAt !== null) { total += Math.max(0, time - pausedAt); pausedAt = null; }
  }
  if (pausedAt !== null && dateKey(new Date(pausedAt), timeZone) === dateKey(new Date(), timeZone)) total += Math.max(0, Date.now() - pausedAt);
  return Math.floor(total / 60_000);
}

export function PersonalActivityDashboard({ profileId, fullname, timeZone }: { profileId: string; fullname: string; timeZone: string }) {
  const supabase = useMemo(() => createClient(), []);
  const initialDates = useMemo(() => defaultPeriodDates("month", new Date(), timeZone), [timeZone]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<ReportPeriod>("month");
  const [start, setStart] = useState(initialDates.start);
  const [end, setEnd] = useState(initialDates.end);
  const [requestIntent, setRequestIntent] = useState<EventRequestIntent | null>(null);
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [visibleColumns, setVisibleColumns] = useState<ActivityColumn[]>(defaultColumns);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const collected: ActivityEvent[] = [];
      for (let page = 0; page < 20; page += 1) {
        const from = page * 1000;
        const { data, error } = await supabase.schema("zecontrol").from("events").select("id, type, event_status, pointed_at").eq("profile_id", profileId).order("pointed_at", { ascending: false }).range(from, from + 999);
        if (error || !active) break;
        const batch = (data ?? []) as ActivityEvent[];
        collected.push(...batch);
        if (batch.length < 1000) break;
      }
      if (active) { setEvents(collected); setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [profileId, supabase]);

  function changePeriod(next: ReportPeriod) {
    setPeriod(next);
    if (next !== "custom") {
      const dates = defaultPeriodDates(next, new Date(), timeZone);
      setStart(dates.start);
      setEnd(dates.end);
    }
  }

  const filteredEvents = events.filter((event) => period === "all" || ((!start || dateKey(new Date(event.pointed_at), timeZone) >= start) && (!end || dateKey(new Date(event.pointed_at), timeZone) <= end)));
  const dayKeys = [...new Set(filteredEvents.map((event) => dateKey(new Date(event.pointed_at), timeZone)))].sort((a, b) => b.localeCompare(a));
  const days = dayKeys.map((key) => {
    const dayEvents = filteredEvents.filter((event) => dateKey(new Date(event.pointed_at), timeZone) === key).sort((a, b) => +new Date(a.pointed_at) - +new Date(b.pointed_at));
    const valid = dayEvents.filter((event) => event.event_status === "accepted" || event.event_status === "pending");
    return { key, events: dayEvents, valid, minutes: minutesForDay(dayEvents, timeZone), pauseMinutes: pauseMinutesForDay(dayEvents, timeZone), first: valid.find((event) => event.type === "start"), firstBreak: valid.find((event) => event.type === "break"), firstResume: valid.find((event) => event.type === "resume"), end: [...valid].reverse().find((event) => event.type === "end"), last: valid.at(-1), pauses: valid.filter((event) => event.type === "break").length, completed: valid.at(-1)?.type === "end", issue: dayEvents.some((event) => event.event_status === "pending" || event.event_status === "rejected") };
  });
  const totalMinutes = days.reduce((sum, day) => sum + day.minutes, 0);
  const completedDays = days.filter((day) => day.completed).length;
  const issueCount = days.filter((day) => day.issue).length;
  const averageMinutes = days.length ? Math.round(totalMinutes / days.length) : 0;
  const label = periodLabel(period, start, end);
  const eventYears = [...new Set(events.map((event) => new Date(event.pointed_at).getFullYear()))].sort((a, b) => b - a);
  if (!eventYears.includes(calendarYear)) eventYears.unshift(calendarYear);
  const yearStart = new Date(calendarYear, 0, 1);
  const yearEnd = new Date(calendarYear, 11, 31);
  const calendarStart = new Date(yearStart);
  calendarStart.setDate(calendarStart.getDate() - calendarStart.getDay());
  const calendarEnd = new Date(yearEnd);
  calendarEnd.setDate(calendarEnd.getDate() + (6 - calendarEnd.getDay()));
  const calendarDayMap = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const key = dateKey(new Date(event.pointed_at), timeZone);
    const existing = calendarDayMap.get(key) ?? [];
    existing.push(event);
    calendarDayMap.set(key, existing);
  }
  const calendarCells: Array<{ key: string; date: Date; week: number; weekday: number; minutes: number; count: number; level: number; issue: boolean; inYear: boolean }> = [];
  for (let cursor = new Date(calendarStart), index = 0; cursor <= calendarEnd; cursor.setDate(cursor.getDate() + 1), index += 1) {
    const date = new Date(cursor);
    const key = dateKey(date);
    const dayEvents = calendarDayMap.get(key) ?? [];
    const minutes = minutesForDay(dayEvents, timeZone);
    const count = dayEvents.filter((event) => event.event_status === "accepted" || event.event_status === "pending").length;
    const level = count === 0 ? 0 : minutes < 240 ? 1 : minutes < 420 ? 2 : minutes < 540 ? 3 : 4;
    calendarCells.push({ key, date, week: Math.floor(index / 7) + 1, weekday: index % 7 + 1, minutes, count, level, issue: dayEvents.some((event) => event.event_status === "pending" || event.event_status === "rejected"), inYear: date.getFullYear() === calendarYear });
  }
  const calendarWeeks = Math.max(...calendarCells.map((cell) => cell.week));
  const monthMarkers = Array.from({ length: 12 }, (_, month) => { const date = new Date(calendarYear, month, 1); return { label: new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(date), week: Math.floor((+date - +calendarStart) / 604_800_000) + 1 }; });
  const calendarWorkedDays = calendarCells.filter((cell) => cell.inYear && cell.count > 0).length;
  const selectedDay = selectedDayKey ? days.find((day) => day.key === selectedDayKey) ?? null : null;
  const mobileMonthKey = (start || dateKey(new Date(), timeZone)).slice(0, 7);
  const [mobileYear, mobileMonth] = mobileMonthKey.split("-").map(Number);
  const mobileMonthStart = new Date(mobileYear, mobileMonth - 1, 1);
  const mobileMonthLength = new Date(mobileYear, mobileMonth, 0).getDate();
  const mobileMonthOffset = (mobileMonthStart.getDay() + 6) % 7;
  const mobileMonthDays = Array.from({ length: mobileMonthLength }, (_, index) => {
    const key = `${mobileMonthKey}-${String(index + 1).padStart(2, "0")}`;
    const dayEvents = calendarDayMap.get(key) ?? [];
    return {
      key,
      day: index + 1,
      minutes: minutesForDay(dayEvents, timeZone),
      issue: dayEvents.some((event) => event.event_status === "pending" || event.event_status === "rejected"),
      hasEvents: dayEvents.length > 0,
    };
  });

  function toggleColumn(column: ActivityColumn) {
    if (column === "day") return;
    setVisibleColumns((columns) => columns.includes(column)
      ? columns.filter((item) => item !== column)
      : columnOrder.filter((item) => item === column || columns.includes(item)));
  }

  function timeOf(event: ActivityEvent | undefined) {
    return event ? new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(event.pointed_at)) : "—";
  }

  function dayStatus(day: (typeof days)[number]) {
    return day.issue ? "À vérifier" : day.completed ? "Terminée" : "En cours";
  }

  function cellValue(day: (typeof days)[number], column: ActivityColumn) {
    if (column === "day") return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${day.key}T12:00:00`));
    if (column === "start") return timeOf(day.first);
    if (column === "firstBreak") return timeOf(day.firstBreak);
    if (column === "firstResume") return timeOf(day.firstResume);
    if (column === "end") return timeOf(day.end);
    if (column === "worked") return durationLabel(day.minutes);
    if (column === "pause") return durationLabel(day.pauseMinutes);
    return dayStatus(day);
  }

  const headers = visibleColumns.map((column) => columnLabels[column]);
  const rows = days.map((day) => visibleColumns.map((column) => cellValue(day, column)));

  async function handleExport(format: "pdf" | "excel" | "csv") {
    const filename = `zecontrol-mon-activite-${start || "tout"}-${end || "tout"}`;
    if (format === "csv") exportCsv(filename, headers, rows);
    if (format === "excel") await exportExcel(filename, `Activité de ${fullname}`, headers, rows);
    if (format === "pdf") await exportPdf(filename, `Activité de ${fullname}`, `${label} · ${timeZone}`, headers, rows);
  }

  if (loading) return <div className="activity-dashboard-loading"><LoaderCircle className="spin" size={22} /> Préparation de votre activité...</div>;

  return (
    <div className="personal-activity-dashboard">
      <header className="activity-dashboard-heading"><div><span>Mon activité</span><h1>Mes repères</h1><p>{label}</p></div><button type="button" onClick={() => setRequestIntent({ key: "missing-from-activity", kind: "missing_event", requestedAt: new Date(Date.now() - 86_400_000).toISOString() })}><Plus size={16} /> Ajouter un pointage oublié</button></header>
      <ReportPeriodToolbar period={period} start={start} end={end} onPeriodChange={changePeriod} onStartChange={setStart} onEndChange={setEnd} onExport={handleExport} />
      <section className="activity-kpi-board">
        <article className="primary"><span><TimerReset size={22} /></span><div><small>Temps travaillé</small><strong>{durationLabel(totalMinutes)}</strong><p>sur {days.length} journée{days.length > 1 ? "s" : ""}</p></div><i style={{ "--kpi-progress": `${Math.min(100, days.length ? completedDays / days.length * 100 : 0)}%` } as React.CSSProperties} /></article>
        <article><span><CalendarDays size={20} /></span><div><small>Jours travaillés</small><strong>{days.length}</strong></div></article>
        <article><span><Clock3 size={20} /></span><div><small>Moyenne par jour</small><strong>{durationLabel(averageMinutes)}</strong></div></article>
        <article className={issueCount ? "attention" : ""}><span>{issueCount ? <AlertTriangle size={20} /> : <Check size={20} />}</span><div><small>À vérifier</small><strong>{issueCount}</strong></div></article>
      </section>
      <section className="activity-calendar-card">
        <header><div><small>Empreinte annuelle</small><h2>{calendarWorkedDays} journée{calendarWorkedDays > 1 ? "s" : ""} travaillée{calendarWorkedDays > 1 ? "s" : ""}</h2></div><label><span className="sr-only">Année</span><select value={calendarYear} onChange={(event) => setCalendarYear(Number(event.target.value))}>{eventYears.map((year) => <option value={year} key={year}>{year}</option>)}</select></label></header>
        <div className="activity-calendar-scroll"><div className="activity-calendar-layout" style={{ "--calendar-weeks": calendarWeeks } as React.CSSProperties}><div className="activity-calendar-months">{monthMarkers.map((month) => <span style={{ gridColumn: month.week }} key={`${month.label}-${month.week}`}>{month.label}</span>)}</div><div className="activity-calendar-weekdays"><span>Lun</span><span>Mer</span><span>Ven</span></div><div className="activity-calendar-grid">{calendarCells.map((cell) => <button className={`level-${cell.level} ${cell.issue ? "has-issue" : ""} ${start === cell.key && end === cell.key ? "selected" : ""}`} style={{ gridColumn: cell.week, gridRow: cell.weekday }} type="button" disabled={!cell.inYear} title={`${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(cell.date)} · ${durationLabel(cell.minutes)}`} aria-label={`Afficher le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(cell.date)}, ${durationLabel(cell.minutes)}`} onClick={() => { setPeriod("custom"); setStart(cell.key); setEnd(cell.key); }} key={cell.key} />)}</div></div></div>
        <footer><span>Cliquez sur un jour pour l’ouvrir</span><div><small>0h</small><i className="level-0" /><i className="level-1" /><i className="level-2" /><i className="level-3" /><i className="level-4" /><small>9h+</small></div></footer>
      </section>
      <section className="activity-mobile-calendar">
        <header><div><small>Vue mensuelle</small><h2>{new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(mobileMonthStart)}</h2></div><span>{mobileMonthDays.filter((day) => day.hasEvents).length} jours pointés</span></header>
        <div className="activity-mobile-weekdays">{["L", "M", "M", "J", "V", "S", "D"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
        <div className="activity-mobile-month-grid">
          {Array.from({ length: mobileMonthOffset }, (_, index) => <i key={`blank-${index}`} />)}
          {mobileMonthDays.map((day) => <button className={`${day.hasEvents ? "has-events" : ""} ${day.issue ? "has-issue" : ""} ${start === day.key && end === day.key ? "selected" : ""}`} type="button" aria-label={`${day.day} ${new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(mobileMonthStart)}, ${durationLabel(day.minutes)}`} onClick={() => { setPeriod("custom"); setStart(day.key); setEnd(day.key); }} key={day.key}><span>{day.day}</span>{day.hasEvents && <small>{durationLabel(day.minutes)}</small>}</button>)}
        </div>
      </section>
      <section className="activity-days-table"><header><div><small>Détail</small><h2>{start === end && period === "custom" ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(`${start}T12:00:00`)) : "Mes journées"}</h2></div><div className="activity-table-actions"><span>{days.length} résultat{days.length > 1 ? "s" : ""}</span><details className="activity-column-picker"><summary><Columns3 size={15} /> Colonnes</summary><div>{columnOrder.map((column) => <label key={column}><input type="checkbox" checked={visibleColumns.includes(column)} disabled={column === "day"} onChange={() => toggleColumn(column)} /><span>{columnLabels[column]}</span></label>)}</div></details></div></header>{days.length ? <div className="activity-configurable-table"><table><thead><tr>{visibleColumns.map((column) => <th className={column === "day" ? "sticky-column" : ""} key={column}>{columnLabels[column]}</th>)}</tr></thead><tbody>{days.map((day) => <tr tabIndex={0} role="button" aria-label={`Voir le détail du ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(`${day.key}T12:00:00`))}`} onClick={() => setSelectedDayKey(day.key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedDayKey(day.key); }} key={day.key}>{visibleColumns.map((column) => <td className={`${column === "day" ? "sticky-column activity-day-date" : ""} ${column === "status" ? `status-cell ${day.issue ? "issue" : day.completed ? "done" : "open"}` : ""}`} key={column}>{column === "day" ? <><strong>{cellValue(day, column)}</strong><small>{day.valid.length} pointage{day.valid.length > 1 ? "s" : ""}</small></> : cellValue(day, column)}</td>)}</tr>)}</tbody></table></div> : <div className="activity-table-empty"><CalendarDays size={24} /><strong>Aucune journée</strong><p>Aucun pointage n’est enregistré sur cette date.</p>{period === "custom" && start === end && <button type="button" onClick={() => setRequestIntent({ key: `missing-${start}`, kind: "missing_event", requestedAt: new Date(`${start}T09:00:00`).toISOString() })}><Plus size={15} /> Ajouter un pointage</button>}</div>}</section>
      {selectedDay && <div className="activity-detail-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDayKey(null); }}><aside className="activity-day-detail" role="dialog" aria-modal="true" aria-labelledby="activity-detail-title"><button className="activity-detail-close" type="button" aria-label="Fermer" onClick={() => setSelectedDayKey(null)}><X size={19} /></button><header><span>Détail de la journée</span><h2 id="activity-detail-title">{new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${selectedDay.key}T12:00:00`))}</h2><div><strong>{durationLabel(selectedDay.minutes)}</strong><small>travaillées</small><i /> <strong>{durationLabel(selectedDay.pauseMinutes)}</strong><small>de pause</small></div></header><div className="activity-detail-events">{selectedDay.events.map((event) => { const Icon = typeIcons[event.type]; const editable = event.event_status === "accepted" || event.event_status === "pending"; return <article className={`detail-event event-${event.type} status-${event.event_status}`} key={event.id}><span><Icon size={17} /></span><div><small>{typeLabels[event.type]}</small><strong>{timeOf(event)}</strong></div><em>{event.event_status === "cancelled" ? "Annulé" : event.event_status === "rejected" ? "Refusé" : event.event_status === "pending" ? "À vérifier" : "Validé"}</em>{editable && <button type="button" onClick={() => { setSelectedDayKey(null); setRequestIntent({ key: event.id, kind: "correction", eventId: event.id }); }}><PenLine size={14} /> Modifier</button>}</article>; })}</div><footer><button type="button" onClick={() => { setSelectedDayKey(null); setRequestIntent({ key: `missing-detail-${selectedDay.key}`, kind: "missing_event", requestedAt: new Date(`${selectedDay.key}T09:00:00`).toISOString() }); }}><Plus size={15} /> Ajouter un pointage oublié</button></footer></aside></div>}
      <EventRequestPanel key={requestIntent?.key ?? "activity-request"} profileId={profileId} events={events.filter((event) => event.event_status === "accepted" || event.event_status === "pending").map(({ id, type, pointed_at }) => ({ id, type, pointed_at }))} initialIntent={requestIntent} onClose={() => setRequestIntent(null)} showLauncher={false} />
    </div>
  );
}
