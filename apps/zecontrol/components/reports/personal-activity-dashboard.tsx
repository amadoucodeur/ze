"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarX2,
  ChevronRight,
  Clock3,
  Coffee,
  Columns3,
  LoaderCircle,
  LogIn,
  LogOut,
  PenLine,
  Plus,
  RotateCcw,
  Timer,
  X,
} from "lucide-react";
import {
  EventRequestPanel,
  type EventRequestIntent,
} from "@/components/clocking/event-request-panel";
import { createClient } from "@/lib/supabase/client";
import { exportCsv, exportExcel, exportPdf } from "@/lib/reports/export";
import {
  dateKey,
  defaultPeriodDates,
  periodLabel,
  type ReportPeriod,
} from "@/lib/reports/period";
import {
  resolveReportWorkPolicy,
  type ReportTeamMember,
  type ReportWorkPolicy,
  type ReportWorkPolicyAssignment,
  type ReportWorkPolicyVersion,
} from "@/lib/reports/work-policy-resolution";
import { scheduleForDay } from "@/lib/work-policy";
import {
  evaluateWorkday,
  weekdayForDate,
  type WorkdayEvaluation,
} from "@/lib/work-policy-evaluation";
import { ReportPeriodToolbar } from "./report-period-toolbar";

type EventType = "start" | "break" | "resume" | "end";
type EventStatus = "pending" | "accepted" | "rejected" | "cancelled";
type ActivityEvent = {
  id: string;
  type: EventType;
  event_status: EventStatus;
  pointed_at: string;
};
type ActivityColumn =
  | "day"
  | "start"
  | "firstBreak"
  | "firstResume"
  | "end"
  | "breakCount"
  | "pauseDuration"
  | "worked"
  | "late"
  | "balance";

const typeLabels: Record<EventType, string> = {
  start: "Arrivée",
  break: "Pause",
  resume: "Reprise",
  end: "Départ",
};
const typeIcons = {
  start: LogIn,
  break: Coffee,
  resume: RotateCcw,
  end: LogOut,
};
const columnOrder: ActivityColumn[] = [
  "day",
  "start",
  "firstBreak",
  "firstResume",
  "end",
  "breakCount",
  "pauseDuration",
  "worked",
  "late",
  "balance",
];
const columnLabels: Record<ActivityColumn, string> = {
  day: "Journée",
  start: "Début de service",
  firstBreak: "Première pause",
  firstResume: "Première reprise",
  end: "Fin de service",
  breakCount: "Nombre de pauses",
  pauseDuration: "Temps de pause",
  worked: "Temps travaillé",
  late: "Retard",
  balance: "Solde",
};

function activeEvents(events: ActivityEvent[]) {
  return [...events]
    .filter(
      (event) =>
        event.event_status === "accepted" ||
        event.event_status === "pending",
    )
    .sort(
      (first, second) =>
        +new Date(first.pointed_at) - +new Date(second.pointed_at),
    );
}

function durationLabel(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  return `${Math.floor(safeMinutes / 60)}h ${String(safeMinutes % 60).padStart(2, "0")}`;
}

function decimalLabel(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(1).replace(".", ",");
}

function balanceLabel(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${durationLabel(Math.abs(value))}`;
}

function average(values: number[]) {
  return values.length
    ? Math.round(
        values.reduce((total, value) => total + value, 0) / values.length,
      )
    : null;
}

function eventMinuteOfDay(
  event: ActivityEvent | undefined,
  timeZone: string,
) {
  if (!event) return null;
  const parts = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(event.pointed_at));
  return (
    Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 +
    Number(parts.find((part) => part.type === "minute")?.value ?? 0)
  );
}

function averageTime(values: Array<number | null>) {
  const times = values.filter((value): value is number => value !== null);
  if (!times.length) return null;
  const vectors = times.reduce(
    (result, value) => {
      const angle = (value / (24 * 60)) * Math.PI * 2;
      return {
        x: result.x + Math.cos(angle),
        y: result.y + Math.sin(angle),
      };
    },
    { x: 0, y: 0 },
  );
  const angle = Math.atan2(
    vectors.y / times.length,
    vectors.x / times.length,
  );
  return Math.round(
    (((angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2)) *
      24 *
      60) %
      (24 * 60),
  );
}

function minuteOfDayLabel(value: number | null) {
  if (value === null) return "—";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function nextDateKey(value: string) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return dateKey(date);
}

function dateKeysBetween(start: string, end: string) {
  const result: string[] = [];
  let current = start;
  while (current <= end && result.length < 1500) {
    result.push(current);
    current = nextDateKey(current);
  }
  return result;
}

export function PersonalActivityDashboard({
  profileId,
  organisationId,
  fullname,
  service,
  activatedAt,
  timeZone,
}: {
  profileId: string;
  organisationId: string;
  fullname: string;
  service: string | null;
  activatedAt: string;
  timeZone: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const initialDates = useMemo(
    () => defaultPeriodDates("month", new Date(), timeZone),
    [timeZone],
  );
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [workPolicies, setWorkPolicies] = useState<ReportWorkPolicy[]>([]);
  const [workPolicyVersions, setWorkPolicyVersions] = useState<
    ReportWorkPolicyVersion[]
  >([]);
  const [workPolicyAssignments, setWorkPolicyAssignments] = useState<
    ReportWorkPolicyAssignment[]
  >([]);
  const [workTeamMembers, setWorkTeamMembers] = useState<ReportTeamMember[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<ReportPeriod>("month");
  const [start, setStart] = useState(initialDates.start);
  const [end, setEnd] = useState(initialDates.end);
  const [requestIntent, setRequestIntent] =
    useState<EventRequestIntent | null>(null);
  const [calendarYear, setCalendarYear] = useState(
    () => new Date().getFullYear(),
  );
  const [visibleColumns, setVisibleColumns] =
    useState<ActivityColumn[]>(columnOrder);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());

  useEffect(() => {
    let active = true;

    async function load() {
      const collected: ActivityEvent[] = [];
      for (let page = 0; page < 20; page += 1) {
        const from = page * 1000;
        const result = await supabase
          .schema("zecontrol")
          .from("events")
          .select("id, type, event_status, pointed_at")
          .eq("profile_id", profileId)
          .order("pointed_at", { ascending: false })
          .range(from, from + 999);
        if (!active) return;
        if (result.error) break;
        const batch = (result.data ?? []) as ActivityEvent[];
        collected.push(...batch);
        if (batch.length < 1000) break;
      }

      const [policies, versions, assignments, members] = await Promise.all([
        supabase
          .schema("zecontrol")
          .from("work_policies")
          .select("id, is_enabled, is_default")
          .eq("organisation_id", organisationId),
        supabase
          .schema("zecontrol")
          .from("work_policy_versions")
          .select("policy_id, definition, effective_from, version_number")
          .order("effective_from", { ascending: false }),
        supabase
          .schema("zecontrol")
          .from("work_policy_assignments")
          .select(
            "policy_id, target_type, service_name, team_id, profile_id, valid_from, valid_until, priority",
          )
          .eq("organisation_id", organisationId),
        supabase
          .schema("zecontrol")
          .from("work_team_members")
          .select("team_id, profile_id, is_active"),
      ]);
      if (!active) return;

      setEvents(collected);
      if (
        !policies.error &&
        !versions.error &&
        !assignments.error &&
        !members.error
      ) {
        setWorkPolicies((policies.data ?? []) as ReportWorkPolicy[]);
        setWorkPolicyVersions(
          (versions.data ?? []) as ReportWorkPolicyVersion[],
        );
        setWorkPolicyAssignments(
          (assignments.data ?? []) as ReportWorkPolicyAssignment[],
        );
        setWorkTeamMembers((members.data ?? []) as ReportTeamMember[]);
      }
      setLoading(false);
    }

    void load();
    return () => {
      active = false;
    };
  }, [organisationId, profileId, supabase]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function changePeriod(next: ReportPeriod) {
    setPeriod(next);
    if (next !== "custom") {
      const dates = defaultPeriodDates(next, new Date(), timeZone);
      setStart(dates.start);
      setEnd(dates.end);
    }
  }

  const resolveDefinition = useCallback(
    (day: string) =>
      resolveReportWorkPolicy({
        profileId,
        service,
        day,
        policies: workPolicies,
        versions: workPolicyVersions,
        assignments: workPolicyAssignments,
        teamMembers: workTeamMembers,
      }),
    [
      profileId,
      service,
      workPolicies,
      workPolicyAssignments,
      workPolicyVersions,
      workTeamMembers,
    ],
  );

  const days = useMemo(() => {
    const groups = new Map<string, ActivityEvent[]>();
    const scopedEvents = events.filter(
      (event) =>
        period === "all" ||
        ((!start ||
          dateKey(new Date(event.pointed_at), timeZone) >= start) &&
          (!end || dateKey(new Date(event.pointed_at), timeZone) <= end)),
    );
    for (const event of scopedEvents) {
      const key = dateKey(new Date(event.pointed_at), timeZone);
      const current = groups.get(key) ?? [];
      current.push(event);
      groups.set(key, current);
    }

    if (period !== "all" && start && end) {
      const today = dateKey(new Date(clockTick), timeZone);
      const lastRelevantDay = end < today ? end : today;
      const activationDay = dateKey(new Date(activatedAt), timeZone);
      for (const day of dateKeysBetween(start, lastRelevantDay)) {
        if (day < activationDay) continue;
        const definition = resolveDefinition(day);
        const scheduled = definition
          ? scheduleForDay(definition, weekdayForDate(day))
          : null;
        if (start !== end && !scheduled) continue;
        if (!groups.has(day)) groups.set(day, []);
      }
    }

    return Array.from(groups, ([key, dayEvents]) => {
      const chronological = [...dayEvents].sort(
        (first, second) =>
          +new Date(first.pointed_at) - +new Date(second.pointed_at),
      );
      const valid = activeEvents(chronological);
      const definition = resolveDefinition(key);
      const evaluation = definition
        ? evaluateWorkday({
            definition,
            events: chronological,
            date: key,
            now: new Date(clockTick),
            timeZone,
          })
        : null;
      const rawWorkedMinutes = evaluateRawWorkedMinutes(
        chronological,
        key,
        timeZone,
        clockTick,
      );
      const rawPauseMinutes = evaluateRawPauseMinutes(
        chronological,
        key,
        timeZone,
        clockTick,
      );
      const first = valid.find((event) => event.type === "start");
      const firstBreak = valid.find((event) => event.type === "break");
      const firstResume = valid.find((event) => event.type === "resume");
      const endEvent = [...valid]
        .reverse()
        .find((event) => event.type === "end");
      return {
        key,
        events: chronological,
        valid,
        first,
        firstBreak,
        firstResume,
        end: endEvent,
        minutes: evaluation?.workedMinutes ?? rawWorkedMinutes,
        pauseMinutes: evaluation?.pauseMinutes ?? rawPauseMinutes,
        pauses: valid.filter((event) => event.type === "break").length,
        completed: valid.at(-1)?.type === "end",
        issue: chronological.some(
          (event) =>
            event.event_status === "pending" ||
            event.event_status === "rejected",
        ),
        isPotentialAbsence:
          key < dateKey(new Date(clockTick), timeZone) &&
          Boolean((evaluation?.expectedMinutes ?? 0) > 0) &&
          !first,
        evaluation,
      };
    }).sort((first, second) => second.key.localeCompare(first.key));
  }, [
    activatedAt,
    clockTick,
    end,
    events,
    period,
    resolveDefinition,
    start,
    timeZone,
  ]);

  const workedDays = days.filter((day) => Boolean(day.first));
  const expectedDays = days.filter(
    (day) => (day.evaluation?.expectedMinutes ?? 0) > 0,
  );
  const totalMinutes = days.reduce((sum, day) => sum + day.minutes, 0);
  const totalExpected = days.reduce(
    (sum, day) => sum + (day.evaluation?.expectedMinutes ?? 0),
    0,
  );
  const totalArrivalLate = days.reduce(
    (sum, day) => sum + (day.evaluation?.arrivalLateMinutes ?? 0),
    0,
  );
  const totalBreakOverrun = days.reduce(
    (sum, day) => sum + (day.evaluation?.breakOverrunMinutes ?? 0),
    0,
  );
  const totalOvertime = days.reduce(
    (sum, day) => sum + (day.evaluation?.overtimeMinutes ?? 0),
    0,
  );
  const totalBreaks = days.reduce((sum, day) => sum + day.pauses, 0);
  const totalPause = days.reduce(
    (sum, day) => sum + day.pauseMinutes,
    0,
  );
  const absences = days.filter((day) => day.isPotentialAbsence).length;
  const absenceRate = expectedDays.length
    ? (absences / expectedDays.length) * 100
    : null;
  const averageMinutes = average(workedDays.map((day) => day.minutes));
  const averageArrivalLate = average(
    workedDays.map((day) => day.evaluation?.arrivalLateMinutes ?? 0),
  );
  const averageBreakOverrun = average(
    workedDays.map((day) => day.evaluation?.breakOverrunMinutes ?? 0),
  );
  const averagePause = average(
    workedDays.map((day) => day.pauseMinutes),
  );
  const averageOvertime = average(
    workedDays.map((day) => day.evaluation?.overtimeMinutes ?? 0),
  );
  const averageStart = averageTime(
    workedDays.map((day) => eventMinuteOfDay(day.first, timeZone)),
  );
  const averageFirstBreak = averageTime(
    workedDays.map((day) => eventMinuteOfDay(day.firstBreak, timeZone)),
  );
  const averageFirstResume = averageTime(
    workedDays.map((day) => eventMinuteOfDay(day.firstResume, timeZone)),
  );
  const averageEnd = averageTime(
    workedDays.map((day) => eventMinuteOfDay(day.end, timeZone)),
  );
  const issueCount = days.filter((day) => day.issue).length;
  const label = periodLabel(period, start, end);

  const eventYears = [
    ...new Set(events.map((event) => new Date(event.pointed_at).getFullYear())),
  ].sort((first, second) => second - first);
  if (!eventYears.includes(calendarYear)) eventYears.unshift(calendarYear);
  const calendarStart = new Date(calendarYear, 0, 1);
  calendarStart.setDate(calendarStart.getDate() - calendarStart.getDay());
  const calendarEnd = new Date(calendarYear, 11, 31);
  calendarEnd.setDate(calendarEnd.getDate() + (6 - calendarEnd.getDay()));
  const calendarDayMap = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const key = dateKey(new Date(event.pointed_at), timeZone);
    const current = calendarDayMap.get(key) ?? [];
    current.push(event);
    calendarDayMap.set(key, current);
  }
  const calendarCells: Array<{
    key: string;
    date: Date;
    week: number;
    weekday: number;
    minutes: number;
    level: number;
    issue: boolean;
    inYear: boolean;
  }> = [];
  for (
    let cursor = new Date(calendarStart), index = 0;
    cursor <= calendarEnd;
    cursor.setDate(cursor.getDate() + 1), index += 1
  ) {
    const date = new Date(cursor);
    const key = dateKey(date);
    const dayEvents = calendarDayMap.get(key) ?? [];
    const evaluation = days.find((day) => day.key === key);
    const minutes =
      evaluation?.minutes ??
      evaluateRawWorkedMinutes(dayEvents, key, timeZone, clockTick);
    calendarCells.push({
      key,
      date,
      week: Math.floor(index / 7) + 1,
      weekday: index % 7 + 1,
      minutes,
      level:
        minutes === 0
          ? 0
          : minutes < 240
            ? 1
            : minutes < 420
              ? 2
              : minutes < 540
                ? 3
                : 4,
      issue: dayEvents.some(
        (event) =>
          event.event_status === "pending" ||
          event.event_status === "rejected",
      ),
      inYear: date.getFullYear() === calendarYear,
    });
  }
  const calendarWeeks = Math.max(
    ...calendarCells.map((cell) => cell.week),
  );
  const monthMarkers = Array.from({ length: 12 }, (_, month) => {
    const date = new Date(calendarYear, month, 1);
    return {
      label: new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(
        date,
      ),
      week:
        Math.floor((+date - +calendarStart) / 604_800_000) + 1,
    };
  });
  const calendarWorkedDays = calendarCells.filter(
    (cell) => cell.inYear && cell.minutes > 0,
  ).length;
  const selectedDay = selectedDayKey
    ? days.find((day) => day.key === selectedDayKey) ??
      buildEventOnlyDay(selectedDayKey, events, timeZone, clockTick)
    : null;

  const mobileMonthKey = (start || dateKey(new Date(), timeZone)).slice(0, 7);
  const [mobileYear, mobileMonth] = mobileMonthKey.split("-").map(Number);
  const mobileMonthStart = new Date(mobileYear, mobileMonth - 1, 1);
  const mobileMonthLength = new Date(mobileYear, mobileMonth, 0).getDate();
  const mobileMonthOffset = (mobileMonthStart.getDay() + 6) % 7;
  const mobileMonthDays = Array.from(
    { length: mobileMonthLength },
    (_, index) => {
      const key = `${mobileMonthKey}-${String(index + 1).padStart(2, "0")}`;
      const dayEvents = calendarDayMap.get(key) ?? [];
      const reportDay = days.find((day) => day.key === key);
      return {
        key,
        day: index + 1,
        minutes:
          reportDay?.minutes ??
          evaluateRawWorkedMinutes(dayEvents, key, timeZone, clockTick),
        issue: dayEvents.some(
          (event) =>
            event.event_status === "pending" ||
            event.event_status === "rejected",
        ),
        hasEvents: dayEvents.length > 0,
      };
    },
  );

  function toggleColumn(column: ActivityColumn) {
    if (column === "day") return;
    setVisibleColumns((columns) =>
      columns.includes(column)
        ? columns.filter((item) => item !== column)
        : columnOrder.filter(
            (item) => item === column || columns.includes(item),
          ),
    );
  }

  function timeOf(event: ActivityEvent | undefined) {
    return event
      ? new Intl.DateTimeFormat("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone,
        }).format(new Date(event.pointed_at))
      : "—";
  }

  function cellValue(
    day: (typeof days)[number],
    column: ActivityColumn,
  ) {
    if (column === "day") {
      return new Intl.DateTimeFormat("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(new Date(`${day.key}T12:00:00`));
    }
    if (column === "start") return timeOf(day.first);
    if (column === "firstBreak") return timeOf(day.firstBreak);
    if (column === "firstResume") return timeOf(day.firstResume);
    if (column === "end") return timeOf(day.end);
    if (column === "breakCount") return String(day.pauses);
    if (column === "pauseDuration") return durationLabel(day.pauseMinutes);
    if (column === "worked") return durationLabel(day.minutes);
    if (column === "late") {
      return day.evaluation?.lateMinutes
        ? durationLabel(day.evaluation.lateMinutes)
        : "—";
    }
    return balanceLabel(day.evaluation?.differenceMinutes);
  }

  async function handleExport(
    format: "pdf" | "excel" | "csv",
    scope: "summary" | "detail" = "summary",
  ) {
    const filename = `zecontrol-mon-activite-${scope}-${start || "tout"}-${end || "tout"}`;
    const summaryHeaders = [
      "Collaborateur",
      "Période",
      "Jours travaillés",
      "Jours attendus",
      "Temps travaillé",
      "Temps attendu",
      "Moyenne quotidienne",
      "Cumul retard d’arrivée",
      "Moyenne retard d’arrivée",
      "Cumul dépassement de pause",
      "Moyenne dépassement de pause",
      "Nombre de pauses",
      "Temps de pause",
      "Absences potentielles",
      "Taux moyen d’absence",
      "Cumul heures supplémentaires",
      "Moyenne heures supplémentaires",
      "Début moyen",
      "Première pause moyenne",
      "Première reprise moyenne",
      "Fin moyenne",
    ];
    const summaryRows = [
      [
        fullname,
        label,
        String(workedDays.length),
        String(expectedDays.length),
        durationLabel(totalMinutes),
        durationLabel(totalExpected),
        averageMinutes === null ? "—" : durationLabel(averageMinutes),
        durationLabel(totalArrivalLate),
        averageArrivalLate === null ? "—" : durationLabel(averageArrivalLate),
        durationLabel(totalBreakOverrun),
        averageBreakOverrun === null ? "—" : durationLabel(averageBreakOverrun),
        String(totalBreaks),
        durationLabel(totalPause),
        String(absences),
        absenceRate === null ? "—" : `${decimalLabel(absenceRate)} %`,
        durationLabel(totalOvertime),
        averageOvertime === null ? "—" : durationLabel(averageOvertime),
        minuteOfDayLabel(averageStart),
        minuteOfDayLabel(averageFirstBreak),
        minuteOfDayLabel(averageFirstResume),
        minuteOfDayLabel(averageEnd),
      ],
    ];
    const detailHeaders = [
      ...visibleColumns.map((column) => columnLabels[column]),
      "Retard à l’arrivée",
      "Dépassement de pause",
      "Retard cumulé",
      "Heures supplémentaires",
      "Chronologie",
    ];
    const detailRows = days.map((day) => [
      ...visibleColumns.map((column) => cellValue(day, column)),
      durationLabel(day.evaluation?.arrivalLateMinutes ?? 0),
      durationLabel(day.evaluation?.breakOverrunMinutes ?? 0),
      durationLabel(day.evaluation?.lateMinutes ?? 0),
      durationLabel(day.evaluation?.overtimeMinutes ?? 0),
      activeEvents(day.events)
        .map((event) => `${timeOf(event)} ${typeLabels[event.type]}`)
        .join(" · ") || "Aucun pointage",
    ]);
    const headers = scope === "summary" ? summaryHeaders : detailHeaders;
    const rows = scope === "summary" ? summaryRows : detailRows;
    if (format === "csv") exportCsv(filename, headers, rows);
    if (format === "excel") {
      await exportExcel(filename, `Activité de ${fullname}`, headers, rows);
    }
    if (format === "pdf") {
      await exportPdf(
        filename,
        `${scope === "summary" ? "Synthèse" : "Détail"} · ${fullname}`,
        `${label} · ${timeZone}`,
        headers,
        rows,
      );
    }
  }

  if (loading) {
    return (
      <div className="activity-dashboard-loading">
        <LoaderCircle className="spin" size={22} /> Préparation de votre
        activité...
      </div>
    );
  }

  return (
    <div className="personal-activity-dashboard">
      <header className="activity-dashboard-heading">
        <div>
          <span>Mon activité</span>
          <h1>Mes repères</h1>
          <p>{label}</p>
        </div>
        <button
          type="button"
          onClick={() =>
            setRequestIntent({
              key: "missing-from-activity",
              kind: "missing_event",
              requestedAt: new Date(Date.now() - 86_400_000).toISOString(),
            })
          }
        >
          <Plus size={16} /> Ajouter un pointage oublié
        </button>
      </header>

      <ReportPeriodToolbar
        period={period}
        start={start}
        end={end}
        onPeriodChange={changePeriod}
        onStartChange={setStart}
        onEndChange={setEnd}
        onExport={handleExport}
        exportScopes
        exportScopeLabels={{
          summaryTitle: "Synthèse",
          summaryDescription: "Les repères de la période",
          detailTitle: "Détail",
          detailDescription: "Une ligne par journée",
        }}
      />

      <section
        className="report-summary-grid personal-report-summary"
        aria-label="Synthèse de mon activité"
      >
        <article className="primary">
          <span><Timer size={21} /></span>
          <div>
            <small>Temps réalisé</small>
            <strong>
              {durationLabel(totalMinutes)}{" "}
              <em>/ {durationLabel(totalExpected)}</em>
            </strong>
            <p>
              {totalMinutes >= totalExpected ? "+" : "−"}
              {durationLabel(Math.abs(totalMinutes - totalExpected))} sur le
              temps attendu
            </p>
          </div>
        </article>
        <article>
          <span><Clock3 size={20} /></span>
          <div>
            <small>Moyenne quotidienne</small>
            <strong>
              {averageMinutes === null ? "—" : durationLabel(averageMinutes)}
            </strong>
            <p>
              {workedDays.length} journée{workedDays.length > 1 ? "s" : ""}{" "}
              travaillée{workedDays.length > 1 ? "s" : ""}
            </p>
          </div>
        </article>
        <article className={totalArrivalLate ? "attention" : ""}>
          <span><LogIn size={20} /></span>
          <div>
            <small>Cumul des retards d’arrivée</small>
            <strong>{durationLabel(totalArrivalLate)}</strong>
            <p>
              {averageArrivalLate === null
                ? "—"
                : durationLabel(averageArrivalLate)} en moyenne par journée
            </p>
          </div>
        </article>
        <article className={totalBreakOverrun ? "attention" : ""}>
          <span><Coffee size={20} /></span>
          <div>
            <small>Cumul des dépassements de pause</small>
            <strong>{durationLabel(totalBreakOverrun)}</strong>
            <p>
              {averageBreakOverrun === null
                ? "—"
                : durationLabel(averageBreakOverrun)} en moyenne par journée
            </p>
          </div>
        </article>
        <article>
          <span><Coffee size={20} /></span>
          <div>
            <small>Pauses prises</small>
            <strong>{totalBreaks}</strong>
            <p>
              {durationLabel(totalPause)} au total
              {averagePause === null
                ? ""
                : ` · ${durationLabel(averagePause)} en moyenne`}
            </p>
          </div>
        </article>
        <article className={absences ? "attention" : ""}>
          <span><CalendarX2 size={20} /></span>
          <div>
            <small>Cumul des absences</small>
            <strong>{absences}</strong>
            <p>
              {absenceRate === null ? "—" : `${decimalLabel(absenceRate)} %`} en
              moyenne sur les journées attendues
            </p>
          </div>
        </article>
        <article>
          <span><CalendarDays size={20} /></span>
          <div>
            <small>Cumul des heures supplémentaires</small>
            <strong>{durationLabel(totalOvertime)}</strong>
            <p>
              {averageOvertime === null
                ? "—"
                : durationLabel(averageOvertime)} en moyenne par journée
            </p>
          </div>
        </article>
        <div className="report-average-strip">
          <span>
            <small>Début moyen</small>
            <strong>{minuteOfDayLabel(averageStart)}</strong>
          </span>
          <span>
            <small>Première pause</small>
            <strong>{minuteOfDayLabel(averageFirstBreak)}</strong>
          </span>
          <span>
            <small>Première reprise</small>
            <strong>{minuteOfDayLabel(averageFirstResume)}</strong>
          </span>
          <span>
            <small>Fin moyenne</small>
            <strong>{minuteOfDayLabel(averageEnd)}</strong>
          </span>
          <p>
            Calculé sur {workedDays.length} journée
            {workedDays.length > 1 ? "s" : ""} travaillée
            {workedDays.length > 1 ? "s" : ""}.
          </p>
        </div>
      </section>

      <section className="activity-calendar-card">
        <header>
          <div>
            <small>Empreinte annuelle</small>
            <h2>
              {calendarWorkedDays} journée
              {calendarWorkedDays > 1 ? "s" : ""} travaillée
              {calendarWorkedDays > 1 ? "s" : ""}
            </h2>
          </div>
          <label>
            <span className="sr-only">Année</span>
            <select
              value={calendarYear}
              onChange={(event) => setCalendarYear(Number(event.target.value))}
            >
              {eventYears.map((year) => (
                <option value={year} key={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </header>
        <div className="activity-calendar-scroll">
          <div
            className="activity-calendar-layout"
            style={
              {
                "--calendar-weeks": calendarWeeks,
              } as React.CSSProperties
            }
          >
            <div className="activity-calendar-months">
              {monthMarkers.map((month) => (
                <span
                  style={{ gridColumn: month.week }}
                  key={`${month.label}-${month.week}`}
                >
                  {month.label}
                </span>
              ))}
            </div>
            <div className="activity-calendar-weekdays">
              <span>Lun</span><span>Mer</span><span>Ven</span>
            </div>
            <div className="activity-calendar-grid">
              {calendarCells.map((cell) => (
                <button
                  className={`level-${cell.level} ${cell.issue ? "has-issue" : ""} ${start === cell.key && end === cell.key ? "selected" : ""}`}
                  style={{
                    gridColumn: cell.week,
                    gridRow: cell.weekday,
                  }}
                  type="button"
                  disabled={!cell.inYear}
                  title={`${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(cell.date)} · ${durationLabel(cell.minutes)}`}
                  aria-label={`Afficher le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(cell.date)}, ${durationLabel(cell.minutes)}`}
                  onClick={() => {
                    setPeriod("custom");
                    setStart(cell.key);
                    setEnd(cell.key);
                  }}
                  key={cell.key}
                />
              ))}
            </div>
          </div>
        </div>
        <footer>
          <span>Cliquez sur un jour pour l’ouvrir</span>
          <div>
            <small>0h</small>
            <i className="level-0" /><i className="level-1" />
            <i className="level-2" /><i className="level-3" />
            <i className="level-4" /><small>9h+</small>
          </div>
        </footer>
      </section>

      <section className="activity-mobile-calendar">
        <header>
          <div>
            <small>Vue mensuelle</small>
            <h2>
              {new Intl.DateTimeFormat("fr-FR", {
                month: "long",
                year: "numeric",
              }).format(mobileMonthStart)}
            </h2>
          </div>
          <span>
            {mobileMonthDays.filter((day) => day.hasEvents).length} jours
            pointés
          </span>
        </header>
        <div className="activity-mobile-weekdays">
          {["L", "M", "M", "J", "V", "S", "D"].map((day, index) => (
            <span key={`${day}-${index}`}>{day}</span>
          ))}
        </div>
        <div className="activity-mobile-month-grid">
          {Array.from({ length: mobileMonthOffset }, (_, index) => (
            <i key={`blank-${index}`} />
          ))}
          {mobileMonthDays.map((day) => (
            <button
              className={`${day.hasEvents ? "has-events" : ""} ${day.issue ? "has-issue" : ""} ${start === day.key && end === day.key ? "selected" : ""}`}
              type="button"
              aria-label={`${day.day} ${new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(mobileMonthStart)}, ${durationLabel(day.minutes)}`}
              onClick={() => {
                setPeriod("custom");
                setStart(day.key);
                setEnd(day.key);
              }}
              key={day.key}
            >
              <span>{day.day}</span>
              {day.hasEvents && <small>{durationLabel(day.minutes)}</small>}
            </button>
          ))}
        </div>
      </section>

      <section className="activity-days-table">
        <header>
          <div>
            <small>Détail</small>
            <h2>
              {start === end && period === "custom"
                ? new Intl.DateTimeFormat("fr-FR", {
                    dateStyle: "long",
                  }).format(new Date(`${start}T12:00:00`))
                : "Mes journées"}
            </h2>
          </div>
          <div className="activity-table-actions">
            <span>
              {days.length} résultat{days.length > 1 ? "s" : ""}
              {issueCount ? ` · ${issueCount} à vérifier` : ""}
            </span>
            <details className="activity-column-picker">
              <summary><Columns3 size={15} /> Colonnes</summary>
              <div>
                {columnOrder.map((column) => (
                  <label key={column}>
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(column)}
                      disabled={column === "day"}
                      onChange={() => toggleColumn(column)}
                    />
                    <span>{columnLabels[column]}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>
        </header>

        {days.length ? (
          <>
            <div className="activity-configurable-table personal-days-desktop">
              <table>
                <thead>
                  <tr>
                    {visibleColumns.map((column) => (
                      <th
                        className={column === "day" ? "sticky-column" : ""}
                        key={column}
                      >
                        {columnLabels[column]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr
                      tabIndex={0}
                      role="button"
                      aria-label={`Voir le détail du ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(`${day.key}T12:00:00`))}`}
                      onClick={() => setSelectedDayKey(day.key)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          setSelectedDayKey(day.key);
                        }
                      }}
                      key={day.key}
                    >
                      {visibleColumns.map((column) => (
                        <td
                          className={`${column === "day" ? "sticky-column activity-day-date" : ""} ${column === "balance" ? "activity-balance-cell" : ""}`}
                          key={column}
                        >
                          {column === "day" ? (
                            <>
                              <strong>{cellValue(day, column)}</strong>
                              <small>
                                {day.isPotentialAbsence
                                  ? "Absence potentielle"
                                  : `${day.valid.length} pointage${day.valid.length > 1 ? "s" : ""}`}
                              </small>
                            </>
                          ) : (
                            cellValue(day, column)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="personal-day-cards">
              {days.map((day) => (
                <button
                  className={day.isPotentialAbsence ? "is-absence" : ""}
                  type="button"
                  onClick={() => setSelectedDayKey(day.key)}
                  key={`mobile-${day.key}`}
                >
                  <header>
                    <span>
                      <strong>{cellValue(day, "day")}</strong>
                      <small>
                        {day.isPotentialAbsence
                          ? "Absence potentielle"
                          : `${day.valid.length} pointage${day.valid.length > 1 ? "s" : ""}`}
                      </small>
                    </span>
                    <b>{durationLabel(day.minutes)}</b>
                  </header>
                  <div>
                    <span><small>Début</small><strong>{timeOf(day.first)}</strong></span>
                    <span><small>Fin</small><strong>{timeOf(day.end)}</strong></span>
                    <span><small>Pauses</small><strong>{day.pauses} · {durationLabel(day.pauseMinutes)}</strong></span>
                    <span><small>Solde</small><strong>{balanceLabel(day.evaluation?.differenceMinutes)}</strong></span>
                  </div>
                  <footer>
                    <span>
                      {day.evaluation?.lateMinutes
                        ? `${durationLabel(day.evaluation.lateMinutes)} de retard`
                        : day.issue
                          ? "À vérifier"
                          : "Voir la chronologie"}
                    </span>
                    <ChevronRight size={17} />
                  </footer>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="activity-table-empty">
            <CalendarDays size={24} />
            <strong>Aucune journée</strong>
            <p>Aucun pointage n’est enregistré sur cette date.</p>
            {period === "custom" && start === end && (
              <button
                type="button"
                onClick={() =>
                  setRequestIntent({
                    key: `missing-${start}`,
                    kind: "missing_event",
                    requestedAt: new Date(`${start}T09:00:00`).toISOString(),
                  })
                }
              >
                <Plus size={15} /> Ajouter un pointage
              </button>
            )}
          </div>
        )}
      </section>

      {selectedDay && (
        <div
          className="activity-detail-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedDayKey(null);
            }
          }}
        >
          <aside
            className="activity-day-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="activity-detail-title"
          >
            <button
              className="activity-detail-close"
              type="button"
              aria-label="Fermer"
              onClick={() => setSelectedDayKey(null)}
            >
              <X size={19} />
            </button>
            <header>
              <span>Détail de la journée</span>
              <h2 id="activity-detail-title">
                {new Intl.DateTimeFormat("fr-FR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }).format(new Date(`${selectedDay.key}T12:00:00`))}
              </h2>
              <div>
                <strong>{durationLabel(selectedDay.minutes)}</strong>
                <small>travaillées</small><i />
                <strong>{durationLabel(selectedDay.pauseMinutes)}</strong>
                <small>de pause</small>
              </div>
            </header>
            {selectedDay.evaluation && (
              <div className="personal-policy-comparison">
                <span>
                  <small>Horaire prévu</small>
                  <strong>
                    {selectedDay.evaluation.schedule
                      ? `${selectedDay.evaluation.schedule.startTime}–${selectedDay.evaluation.schedule.endTime}`
                      : "Libre"}
                  </strong>
                </span>
                <span>
                  <small>Temps attendu</small>
                  <strong>
                    {durationLabel(selectedDay.evaluation.expectedMinutes)}
                  </strong>
                </span>
                <span>
                  <small>Écart</small>
                  <strong>
                    {balanceLabel(
                      selectedDay.evaluation.differenceMinutes,
                    )}
                  </strong>
                </span>
                <span>
                  <small>Retard cumulé</small>
                  <strong>
                    {durationLabel(selectedDay.evaluation.lateMinutes)}
                  </strong>
                  <em>
                    {durationLabel(selectedDay.evaluation.arrivalLateMinutes)} arrivée ·{" "}
                    {durationLabel(selectedDay.evaluation.breakOverrunMinutes)} pause
                  </em>
                </span>
              </div>
            )}
            <div className="activity-detail-events">
              {selectedDay.events.length ? (
                selectedDay.events.map((event) => {
                  const Icon = typeIcons[event.type];
                  const editable =
                    event.event_status === "accepted" ||
                    event.event_status === "pending";
                  return (
                    <article
                      className={`detail-event event-${event.type} status-${event.event_status}`}
                      key={event.id}
                    >
                      <span><Icon size={17} /></span>
                      <div>
                        <small>{typeLabels[event.type]}</small>
                        <strong>{timeOf(event)}</strong>
                      </div>
                      <em>
                        {event.event_status === "cancelled"
                          ? "Annulé"
                          : event.event_status === "rejected"
                            ? "Refusé"
                            : event.event_status === "pending"
                              ? "À vérifier"
                              : "Validé"}
                      </em>
                      {editable && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDayKey(null);
                            setRequestIntent({
                              key: event.id,
                              kind: "correction",
                              eventId: event.id,
                            });
                          }}
                        >
                          <PenLine size={14} /> Modifier
                        </button>
                      )}
                    </article>
                  );
                })
              ) : (
                <div className="personal-day-detail-empty">
                  <CalendarX2 size={22} />
                  <strong>Aucun pointage</strong>
                  <p>Cette journée était planifiée, mais aucun pointage n’a été enregistré.</p>
                </div>
              )}
            </div>
            <footer>
              <button
                type="button"
                onClick={() => {
                  setSelectedDayKey(null);
                  setRequestIntent({
                    key: `missing-detail-${selectedDay.key}`,
                    kind: "missing_event",
                    requestedAt: new Date(
                      `${selectedDay.key}T09:00:00`,
                    ).toISOString(),
                  });
                }}
              >
                <Plus size={15} /> Ajouter un pointage oublié
              </button>
            </footer>
          </aside>
        </div>
      )}

      <EventRequestPanel
        key={requestIntent?.key ?? "activity-request"}
        profileId={profileId}
        timeZone={timeZone}
        events={events
          .filter(
            (event) =>
              event.event_status === "accepted" ||
              event.event_status === "pending",
          )
          .map(({ id, type, pointed_at }) => ({ id, type, pointed_at }))}
        initialIntent={requestIntent}
        onClose={() => setRequestIntent(null)}
        showLauncher={false}
      />
    </div>
  );
}

function evaluateRawWorkedMinutes(
  events: ActivityEvent[],
  day: string,
  timeZone: string,
  now: number,
) {
  const chronological = activeEvents(events);
  let openedAt: number | null = null;
  let total = 0;
  for (const event of chronological) {
    const timestamp = +new Date(event.pointed_at);
    if (event.type === "start" || event.type === "resume") {
      openedAt = timestamp;
    }
    if (
      (event.type === "break" || event.type === "end") &&
      openedAt !== null
    ) {
      total += Math.max(0, timestamp - openedAt);
      openedAt = null;
    }
  }
  if (
    openedAt !== null &&
    day === dateKey(new Date(now), timeZone)
  ) {
    total += Math.max(0, now - openedAt);
  }
  return Math.floor(total / 60_000);
}

function evaluateRawPauseMinutes(
  events: ActivityEvent[],
  day: string,
  timeZone: string,
  now: number,
) {
  const chronological = activeEvents(events);
  let pausedAt: number | null = null;
  let total = 0;
  for (const event of chronological) {
    const timestamp = +new Date(event.pointed_at);
    if (event.type === "break") pausedAt = timestamp;
    if (
      (event.type === "resume" || event.type === "end") &&
      pausedAt !== null
    ) {
      total += Math.max(0, timestamp - pausedAt);
      pausedAt = null;
    }
  }
  if (pausedAt !== null && day === dateKey(new Date(now), timeZone)) {
    total += Math.max(0, now - pausedAt);
  }
  return Math.floor(total / 60_000);
}

function buildEventOnlyDay(
  key: string,
  allEvents: ActivityEvent[],
  timeZone: string,
  now: number,
) {
  const events = allEvents
    .filter(
      (event) => dateKey(new Date(event.pointed_at), timeZone) === key,
    )
    .sort(
      (first, second) =>
        +new Date(first.pointed_at) - +new Date(second.pointed_at),
    );
  if (!events.length) return null;
  const valid = activeEvents(events);
  return {
    key,
    events,
    valid,
    first: valid.find((event) => event.type === "start"),
    firstBreak: valid.find((event) => event.type === "break"),
    firstResume: valid.find((event) => event.type === "resume"),
    end: [...valid].reverse().find((event) => event.type === "end"),
    minutes: evaluateRawWorkedMinutes(events, key, timeZone, now),
    pauseMinutes: evaluateRawPauseMinutes(events, key, timeZone, now),
    pauses: valid.filter((event) => event.type === "break").length,
    completed: valid.at(-1)?.type === "end",
    issue: events.some(
      (event) =>
        event.event_status === "pending" ||
        event.event_status === "rejected",
    ),
    isPotentialAbsence: false,
    evaluation: null as WorkdayEvaluation | null,
  };
}
