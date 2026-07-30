"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  Building2,
  CalendarDays,
  CalendarX2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coffee,
  Columns3,
  Filter,
  LoaderCircle,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Timer,
  UserCheck,
  UsersRound,
  X,
} from "lucide-react";
import { AdminMissingEventPanel } from "@/components/clocking/admin-missing-event-panel";
import { createClient } from "@/lib/supabase/client";
import { LiveDayToolbar } from "./live-day-toolbar";
import { ReportPeriodToolbar } from "./report-period-toolbar";
import { exportCsv, exportExcel, exportPdf } from "@/lib/reports/export";
import { dateKey, defaultPeriodDates, periodLabel, zonedDateTime, zonedDayBoundary, type ReportPeriod } from "@/lib/reports/period";
import { scheduleForDay } from "@/lib/work-policy";
import { evaluateWorkday, weekdayForDate } from "@/lib/work-policy-evaluation";
import {
  resolveReportWorkPolicy,
  type ReportTeamMember,
  type ReportWorkPolicy,
  type ReportWorkPolicyAssignment,
  type ReportWorkPolicyVersion,
} from "@/lib/reports/work-policy-resolution";

type EventType = "start" | "break" | "resume" | "end";
type EventStatus = "pending" | "accepted" | "rejected" | "cancelled";
type LiveStatus = "connecting" | "live" | "unavailable";
type RowStatus = "working" | "paused" | "completed" | "absent";
type StatusFilter = "all" | RowStatus | "late";
type ArrivalOrder = "oldest" | "newest";

type ReportEvent = {
  id: string;
  type: EventType;
  event_status: EventStatus;
  pointed_at: string;
  profile_id: string;
  organisation_id: string;
};

type ReportProfile = {
  id: string;
  role: "owner" | "admin" | "agent";
  is_active: boolean;
  activated_at?: string;
  poste: string | null;
  service: string | null;
  fullname: string;
  identifiant: string;
};

type ReportColumn =
  | "collaborator"
  | "poste"
  | "service"
  | "days"
  | "start"
  | "firstBreak"
  | "firstResume"
  | "end"
  | "breakCount"
  | "pauseDuration"
  | "late"
  | "balance";

const PAGE_SIZE = 50;
const typeLabels: Record<EventType, string> = {
  start: "Début de service",
  break: "Début de pause",
  resume: "Reprise",
  end: "Fin de service",
};
const typeIcons = { start: LogIn, break: Coffee, resume: RotateCcw, end: LogOut };
const statusLabels: Record<RowStatus, string> = {
  working: "En service",
  paused: "En pause",
  completed: "Terminé",
  absent: "Absent",
};
const columnOrder: ReportColumn[] = [
  "collaborator",
  "poste",
  "service",
  "days",
  "start",
  "firstBreak",
  "firstResume",
  "end",
  "breakCount",
  "pauseDuration",
  "late",
  "balance",
];
const columnLabels: Record<ReportColumn, string> = {
  collaborator: "Nom complet",
  poste: "Poste",
  service: "Service",
  days: "Journées",
  start: "Début de service",
  firstBreak: "Première pause",
  firstResume: "Première reprise",
  end: "Fin de service",
  breakCount: "Nombre de pauses",
  pauseDuration: "Temps de pause",
  late: "Retard",
  balance: "Solde",
};
const reportDefaultColumns = [...columnOrder];

function durationLabel(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}`;
}

function activeEvents(events: ReportEvent[]) {
  return [...events]
    .filter((event) => event.event_status === "accepted" || event.event_status === "pending")
    .sort((a, b) => +new Date(a.pointed_at) - +new Date(b.pointed_at));
}

function acceptedEvents(events: ReportEvent[]) {
  return [...events]
    .filter((event) => event.event_status === "accepted")
    .sort((a, b) => +new Date(a.pointed_at) - +new Date(b.pointed_at));
}

function workedMinutes(events: ReportEvent[], now: number, timeZone: string) {
  const chronological = activeEvents(events);
  let openedAt: number | null = null;
  let total = 0;
  for (const event of chronological) {
    const time = +new Date(event.pointed_at);
    if (event.type === "start" || event.type === "resume") openedAt = time;
    if ((event.type === "break" || event.type === "end") && openedAt !== null) {
      total += Math.max(0, time - openedAt);
      openedAt = null;
    }
  }
  if (openedAt !== null && dateKey(new Date(openedAt), timeZone) === dateKey(new Date(), timeZone)) {
    total += Math.max(0, now - openedAt);
  }
  return Math.floor(total / 60_000);
}

function pauseMinutes(events: ReportEvent[], now: number, timeZone: string) {
  const chronological = activeEvents(events);
  let pausedAt: number | null = null;
  let total = 0;
  for (const event of chronological) {
    const time = +new Date(event.pointed_at);
    if (event.type === "break") pausedAt = time;
    if ((event.type === "resume" || event.type === "end") && pausedAt !== null) {
      total += Math.max(0, time - pausedAt);
      pausedAt = null;
    }
  }
  if (pausedAt !== null && dateKey(new Date(pausedAt), timeZone) === dateKey(new Date(), timeZone)) {
    total += Math.max(0, now - pausedAt);
  }
  return Math.floor(total / 60_000);
}

function breakCount(events: ReportEvent[]) {
  return activeEvents(events).filter((event) => event.type === "break").length;
}

function average(values: number[]) {
  return values.length
    ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
    : null;
}

function eventMinuteOfDay(event: ReportEvent | undefined, timeZone: string) {
  if (!event) return null;
  const parts = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(event.pointed_at));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
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
  const angle = Math.atan2(vectors.y / times.length, vectors.x / times.length);
  return Math.round((((angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2)) * 24 * 60)) % (24 * 60);
}

function minuteOfDayLabel(value: number | null) {
  if (value === null) return "—";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function decimalLabel(value: number | null) {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

function timeLabel(event: ReportEvent | undefined, timeZone: string) {
  return event
    ? new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(event.pointed_at))
    : "—";
}

function rowStatus(events: ReportEvent[]): RowStatus {
  const last = events.at(-1);
  if (!last) return "absent";
  if (last.type === "break") return "paused";
  if (last.type === "end") return "completed";
  return "working";
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

export function OrganisationReports({
  organisationId,
  organisationName,
  timeZone,
  view = "reports",
}: {
  organisationId: string;
  organisationName: string;
  timeZone: string;
  view?: "live" | "reports";
}) {
  const supabase = useMemo(() => createClient(), []);
  const initialPeriod: ReportPeriod = view === "live" ? "day" : "month";
  const initialDates = useMemo(() => defaultPeriodDates(initialPeriod, new Date(), timeZone), [initialPeriod, timeZone]);
  const [events, setEvents] = useState<ReportEvent[]>([]);
  const [profiles, setProfiles] = useState<ReportProfile[]>([]);
  const [workPolicies, setWorkPolicies] = useState<ReportWorkPolicy[]>([]);
  const [workPolicyVersions, setWorkPolicyVersions] = useState<ReportWorkPolicyVersion[]>([]);
  const [workPolicyAssignments, setWorkPolicyAssignments] = useState<ReportWorkPolicyAssignment[]>([]);
  const [workTeamMembers, setWorkTeamMembers] = useState<ReportTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [service, setService] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [arrivalOrder, setArrivalOrder] =
    useState<ArrivalOrder>("oldest");
  const [period, setPeriod] = useState<ReportPeriod>(initialPeriod);
  const [start, setStart] = useState(initialDates.start);
  const [end, setEnd] = useState(initialDates.end);
  const [reloadToken, setReloadToken] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [visibleColumns, setVisibleColumns] = useState<ReportColumn[]>(reportDefaultColumns);
  const [page, setPage] = useState(1);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [expandedProfileIds, setExpandedProfileIds] = useState<string[]>([]);
  const [adminMissingIntent, setAdminMissingIntent] = useState<{
    profileId?: string;
    requestedAt?: string;
  } | null>(null);

  useEffect(() => {
    let active = true;

    async function loadProfiles() {
      const profileResult = await supabase
        .schema("zecontrol")
        .rpc("list_report_profiles", {
          target_organisation_id: organisationId,
        });
      if (!active) return;
      if (profileResult.error) {
        setError("Les collaborateurs ZeControl ne sont pas accessibles.");
        setLoading(false);
        setRefreshing(false);
        return;
      }
      setProfiles(
        ((profileResult.data ?? []) as ReportProfile[]).filter(
          (profile) => profile.role !== "owner",
        ),
      );
    }

    async function loadEvents() {
      const collected: ReportEvent[] = [];
      for (let eventPage = 0; eventPage < 20; eventPage += 1) {
        const from = eventPage * 1000;
        let request = supabase
          .schema("zecontrol")
          .from("events")
          .select("id, type, event_status, pointed_at, profile_id, organisation_id")
          .eq("organisation_id", organisationId)
          .order("pointed_at", { ascending: false });
        if (period !== "all" && start) request = request.gte("pointed_at", zonedDayBoundary(start, timeZone).toISOString());
        if (period !== "all" && end) request = request.lt("pointed_at", zonedDayBoundary(nextDateKey(end), timeZone).toISOString());
        const result = await request.range(from, from + 999);
        if (!active) return;
        if (result.error) {
          setError("Les rapports ne sont pas accessibles.");
          setLoading(false);
          setRefreshing(false);
          return;
        }
        const batch = (result.data ?? []) as ReportEvent[];
        collected.push(...batch);
        if (batch.length < 1000) break;
      }
      if (!active) return;
      setEvents(collected);
      setLastUpdatedAt(new Date());
      setLoading(false);
      setRefreshing(false);
    }

    async function loadWorkPolicies() {
      const [policiesResult, versionsResult, assignmentsResult, membersResult] =
        await Promise.all([
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
            .select("policy_id, target_type, service_name, team_id, profile_id, valid_from, valid_until, priority")
            .eq("organisation_id", organisationId),
          supabase
            .schema("zecontrol")
            .from("work_team_members")
            .select("team_id, profile_id, is_active"),
        ]);
      if (!active) return;
      if (policiesResult.error || versionsResult.error) {
        setWorkPolicies([]);
        setWorkPolicyVersions([]);
        setWorkPolicyAssignments([]);
        setWorkTeamMembers([]);
        return;
      }

      let resolvedAssignments: ReportWorkPolicyAssignment[] = [];
      if (!assignmentsResult.error) {
        resolvedAssignments =
          (assignmentsResult.data ?? []) as ReportWorkPolicyAssignment[];
      } else {
        const legacyAssignments = await supabase
          .schema("zecontrol")
          .from("work_policy_assignments")
          .select(
            "policy_id, target_type, service_name, profile_id, valid_from, valid_until",
          )
          .eq("organisation_id", organisationId);
        if (!active) return;
        if (!legacyAssignments.error) {
          resolvedAssignments = (legacyAssignments.data ?? []).map(
            (assignment) => ({
              ...assignment,
              team_id: null,
              priority: 0,
            }),
          ) as ReportWorkPolicyAssignment[];
        }
      }

      setWorkPolicies((policiesResult.data ?? []) as ReportWorkPolicy[]);
      setWorkPolicyVersions((versionsResult.data ?? []) as ReportWorkPolicyVersion[]);
      setWorkPolicyAssignments(resolvedAssignments);
      setWorkTeamMembers(
        membersResult.error
          ? []
          : ((membersResult.data ?? []) as ReportTeamMember[]),
      );
    }

    void Promise.all([loadProfiles(), loadEvents(), loadWorkPolicies()]);
    return () => {
      active = false;
    };
  }, [end, organisationId, period, reloadToken, start, supabase, timeZone]);

  useEffect(() => {
    const channel = supabase
      .channel(`zecontrol-organisation-reports-${organisationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "zecontrol",
          table: "events",
          filter: `organisation_id=eq.${organisationId}`,
        },
        (payload) => {
          const incoming = payload.new as Partial<ReportEvent>;
          const removed = payload.old as Partial<ReportEvent>;
          setEvents((current) => {
            if (payload.eventType === "DELETE" && removed.id) {
              return current.filter((event) => event.id !== removed.id);
            }
            if (!incoming.id || !incoming.profile_id || !incoming.pointed_at || !incoming.type || !incoming.event_status) {
              return current;
            }
            const event = incoming as ReportEvent;
            return [event, ...current.filter((item) => item.id !== event.id)]
              .sort((a, b) => +new Date(b.pointed_at) - +new Date(a.pointed_at));
          });
          setLastUpdatedAt(new Date());
        },
      )
      .subscribe((state) => {
        if (state === "SUBSCRIBED") setLiveStatus("live");
        if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
          setLiveStatus("unavailable");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organisationId, supabase]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function changePeriod(next: ReportPeriod) {
    setPeriod(next);
    setPage(1);
    setRefreshing(true);
    if (next !== "custom") {
      const dates = defaultPeriodDates(next, new Date(), timeZone);
      setStart(dates.start);
      setEnd(dates.end);
    }
  }

  function refresh() {
    setError(null);
    setRefreshing(true);
    setReloadToken((value) => value + 1);
  }

  function toggleColumn(column: ReportColumn) {
    if (column === "collaborator") return;
    setVisibleColumns((columns) => columns.includes(column)
      ? columns.filter((item) => item !== column)
      : columnOrder.filter((item) => item === column || columns.includes(item)));
  }

  function focusCollaborator(profileId: string) {
    setSelectedProfileId(profileId);
    setQuery("");
    setPage(1);
    setExpandedProfileIds([profileId]);
  }

  function toggleCollaborator(profileId: string) {
    setExpandedProfileIds((current) =>
      current.includes(profileId)
        ? current.filter((id) => id !== profileId)
        : [...current, profileId],
    );
  }

  const rows = useMemo(() => {
    const groups = new Map<string, ReportEvent[]>();

    function resolveDefinition(profile: ReportProfile, day: string) {
      return resolveReportWorkPolicy({
        profileId: profile.id,
        service: profile.service,
        day,
        policies: workPolicies,
        versions: workPolicyVersions,
        assignments: workPolicyAssignments,
        teamMembers: workTeamMembers,
      });
    }

    const scopedEvents = events.filter((event) => period === "all" ||
      ((!start || dateKey(new Date(event.pointed_at), timeZone) >= start) &&
        (!end || dateKey(new Date(event.pointed_at), timeZone) <= end)));
    for (const event of scopedEvents) {
      const key = `${event.profile_id}:${dateKey(new Date(event.pointed_at), timeZone)}`;
      const current = groups.get(key) ?? [];
      current.push(event);
      groups.set(key, current);
    }

    if (view === "live") {
      const selectedDay = start || dateKey(new Date(clockTick), timeZone);
      for (const profile of profiles) {
        const activationDay = profile.activated_at
          ? dateKey(new Date(profile.activated_at), timeZone)
          : null;
        if (activationDay && selectedDay < activationDay) continue;
        const key = `${profile.id}:${selectedDay}`;
        if (!groups.has(key)) groups.set(key, []);
      }
    }

    if (view === "reports" && start && end) {
      const today = dateKey(new Date(clockTick), timeZone);
      const lastRelevantDay = end < today ? end : today;
      for (const day of dateKeysBetween(start, lastRelevantDay)) {
        for (const profile of profiles) {
          const activationDay = profile.activated_at
            ? dateKey(new Date(profile.activated_at), timeZone)
            : null;
          if (activationDay && day < activationDay) continue;
          const definition = resolveDefinition(profile, day);
          const scheduled = definition
            ? scheduleForDay(definition, weekdayForDate(day))
            : null;
          if (start !== end && !scheduled) continue;
          const key = `${profile.id}:${day}`;
          if (!groups.has(key)) groups.set(key, []);
        }
      }
    }

    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const result = Array.from(groups, ([key, dayEvents]) => {
      const [profileId, day] = key.split(":");
      const profile = profileById.get(profileId);
      return profile ? { key, day, profile, events: dayEvents } : null;
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));

    return result
      .map((row) => {
        const metricEvents =
          view === "live" ? acceptedEvents(row.events) : activeEvents(row.events);
        const valid = metricEvents;
        const definition = resolveDefinition(row.profile, row.day);
        const evaluation = definition
          ? evaluateWorkday({
              definition,
              events: metricEvents,
              date: row.day,
              now: new Date(clockTick),
              timeZone,
            })
          : null;
        const first = valid.find((event) => event.type === "start");
        const firstBreak = valid.find((event) => event.type === "break");
        const firstResume = valid.find((event) => event.type === "resume");
        const endEvent = [...valid].reverse().find((event) => event.type === "end");
        return {
          ...row,
          valid,
          first,
          firstBreak,
          firstResume,
          end: endEvent,
          worked: workedMinutes(metricEvents, clockTick, timeZone),
          pause: pauseMinutes(metricEvents, clockTick, timeZone),
          breaks: breakCount(metricEvents),
          isPotentialAbsence:
            row.day < dateKey(new Date(clockTick), timeZone) &&
            Boolean((evaluation?.expectedMinutes ?? 0) > 0) &&
            !first,
          status: rowStatus(valid),
          definition,
          evaluation,
        };
      })
      .sort((a, b) => b.day.localeCompare(a.day) || a.profile.fullname.localeCompare(b.profile.fullname, "fr"));
  }, [clockTick, end, events, period, profiles, start, timeZone, view, workPolicies, workPolicyAssignments, workPolicyVersions, workTeamMembers]);

  const services = [...new Set(profiles.map((profile) => profile.service).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "fr"));
  const normalizedQuery = query.trim().toLocaleLowerCase("fr");
  const filteredDayRows = rows.filter((row) => {
    const searchable = `${row.profile.fullname} ${row.profile.identifiant} ${row.profile.poste ?? ""} ${row.profile.service ?? ""}`.toLocaleLowerCase("fr");
    return (!selectedProfileId || row.profile.id === selectedProfileId) &&
      (!normalizedQuery || searchable.includes(normalizedQuery)) &&
      (service === "all" || row.profile.service === service) &&
      (
        status === "all" ||
        (status === "late"
          ? Boolean(row.first && (row.evaluation?.lateMinutes ?? 0) > 0)
          : row.status === status)
      );
  });

  const rangeLabel = periodLabel(period, start, end);
  const isSingleDay = Boolean(start && start === end);
  const today = dateKey(new Date(clockTick), timeZone);
  const liveDay = start || today;
  const isLiveToday = liveDay === today;
  const liveDayLabel = isLiveToday
    ? "Aujourd’hui"
    : new Intl.DateTimeFormat("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(`${liveDay}T12:00:00`));
  const collaboratorSummaries = useMemo(() => {
    const daysByProfile = new Map<string, typeof rows>();
    for (const row of filteredDayRows) {
      const current = daysByProfile.get(row.profile.id) ?? [];
      current.push(row);
      daysByProfile.set(row.profile.id, current);
    }
    return profiles
      .filter((profile) => {
        const searchable = `${profile.fullname} ${profile.identifiant} ${profile.poste ?? ""} ${profile.service ?? ""}`.toLocaleLowerCase("fr");
        return (!selectedProfileId || profile.id === selectedProfileId) &&
          (!normalizedQuery || searchable.includes(normalizedQuery)) &&
          (service === "all" || profile.service === service) &&
          (status === "all" || daysByProfile.has(profile.id));
      })
      .map((profile) => {
        const days = [...(daysByProfile.get(profile.id) ?? [])].sort((a, b) => a.day.localeCompare(b.day));
        const workedDays = days.filter((day) => Boolean(day.first));
        const expectedDays = days.filter((day) => (day.evaluation?.expectedMinutes ?? 0) > 0);
        const lateDays = days.filter((day) => (day.evaluation?.lateMinutes ?? 0) > 0);
        const balanceDays = days.filter((day) => day.evaluation && day.end);
        return {
          profile,
          days,
          workedDays: workedDays.length,
          expectedDays: expectedDays.length,
          totalWorked: days.reduce((total, day) => total + day.worked, 0),
          totalExpected: days.reduce((total, day) => total + (day.evaluation?.expectedMinutes ?? 0), 0),
          totalLate: days.reduce((total, day) => total + (day.evaluation?.lateMinutes ?? 0), 0),
          totalPause: days.reduce((total, day) => total + day.pause, 0),
          totalBreaks: days.reduce((total, day) => total + day.breaks, 0),
          totalOvertime: days.reduce((total, day) => total + (day.evaluation?.overtimeMinutes ?? 0), 0),
          absences: days.filter((day) => day.isPotentialAbsence).length,
          averageWorked: average(workedDays.map((day) => day.worked)),
          averageLate: average(lateDays.map((day) => day.evaluation?.lateMinutes ?? 0)),
          averagePause: average(workedDays.map((day) => day.pause)),
          averageBreaks: average(workedDays.map((day) => day.breaks)),
          averageBalance: average(balanceDays.map((day) => day.evaluation?.differenceMinutes ?? 0)),
          averageStart: averageTime(workedDays.map((day) => eventMinuteOfDay(day.first, timeZone))),
          averageFirstBreak: averageTime(workedDays.map((day) => eventMinuteOfDay(day.firstBreak, timeZone))),
          averageFirstResume: averageTime(workedDays.map((day) => eventMinuteOfDay(day.firstResume, timeZone))),
          averageEnd: averageTime(workedDays.map((day) => eventMinuteOfDay(day.end, timeZone))),
        };
      })
      .filter((summary) => status === "all" || summary.days.length > 0)
      .sort((a, b) => a.profile.fullname.localeCompare(b.profile.fullname, "fr"));
  }, [filteredDayRows, normalizedQuery, profiles, selectedProfileId, service, status, timeZone]);

  const reportTotalPages = Math.max(1, Math.ceil(collaboratorSummaries.length / PAGE_SIZE));
  const reportCurrentPage = Math.min(page, reportTotalPages);
  const displayedSummaries = collaboratorSummaries.slice((reportCurrentPage - 1) * PAGE_SIZE, reportCurrentPage * PAGE_SIZE);
  const liveTotalPages = Math.max(1, Math.ceil(filteredDayRows.length / PAGE_SIZE));
  const liveCurrentPage = Math.min(page, liveTotalPages);
  const orderedDayRows = [...filteredDayRows].sort((left, right) => {
    const leftArrival = left.first
      ? new Date(left.first.pointed_at).getTime()
      : null;
    const rightArrival = right.first
      ? new Date(right.first.pointed_at).getTime()
      : null;
    if (leftArrival === null && rightArrival !== null) return 1;
    if (leftArrival !== null && rightArrival === null) return -1;
    if (leftArrival !== null && rightArrival !== null) {
      const difference =
        arrivalOrder === "oldest"
          ? leftArrival - rightArrival
          : rightArrival - leftArrival;
      if (difference) return difference;
    }
    return left.profile.fullname.localeCompare(
      right.profile.fullname,
      "fr",
    );
  });
  const displayedDayRows = orderedDayRows.slice((liveCurrentPage - 1) * PAGE_SIZE, liveCurrentPage * PAGE_SIZE);
  const selectedRow = selectedRowKey ? rows.find((row) => row.key === selectedRowKey) ?? null : null;
  const selectedProfile = selectedProfileId
    ? profiles.find((profile) => profile.id === selectedProfileId) ?? null
    : null;
  const completedDays = rows.filter((row) => row.status === "completed").length;
  const workingCount = rows.filter((row) => row.status === "working").length;
  const pausedCount = rows.filter((row) => row.status === "paused").length;
  const absentCount = rows.filter((row) => row.status === "absent").length;
  const lateCount = rows.filter(
    (row) => row.first && (row.evaluation?.lateMinutes ?? 0) > 0,
  ).length;
  const aggregateDays = filteredDayRows;
  const aggregateWorkedDays = aggregateDays.filter((day) => Boolean(day.first));
  const aggregateLateDays = aggregateDays.filter((day) => (day.evaluation?.lateMinutes ?? 0) > 0);
  const aggregateOvertimeDays = aggregateDays.filter((day) => (day.evaluation?.overtimeMinutes ?? 0) > 0);
  const aggregateTotalWorked = aggregateDays.reduce((total, day) => total + day.worked, 0);
  const aggregateTotalExpected = aggregateDays.reduce((total, day) => total + (day.evaluation?.expectedMinutes ?? 0), 0);
  const aggregateTotalLate = aggregateDays.reduce((total, day) => total + (day.evaluation?.lateMinutes ?? 0), 0);
  const aggregateTotalOvertime = aggregateDays.reduce((total, day) => total + (day.evaluation?.overtimeMinutes ?? 0), 0);
  const aggregateBreaks = aggregateDays.reduce((total, day) => total + day.breaks, 0);
  const aggregateAbsences = aggregateDays.filter((day) => day.isPotentialAbsence).length;
  const aggregateAverageWorked = average(aggregateWorkedDays.map((day) => day.worked));
  const aggregateAverageLate = average(aggregateLateDays.map((day) => day.evaluation?.lateMinutes ?? 0));
  const aggregateAveragePause = average(aggregateWorkedDays.map((day) => day.pause));
  const aggregateAverageOvertime = average(aggregateOvertimeDays.map((day) => day.evaluation?.overtimeMinutes ?? 0));
  const aggregateAverageStart = averageTime(aggregateWorkedDays.map((day) => eventMinuteOfDay(day.first, timeZone)));
  const aggregateAverageFirstBreak = averageTime(aggregateWorkedDays.map((day) => eventMinuteOfDay(day.firstBreak, timeZone)));
  const aggregateAverageFirstResume = averageTime(aggregateWorkedDays.map((day) => eventMinuteOfDay(day.firstResume, timeZone)));
  const aggregateAverageEnd = averageTime(aggregateWorkedDays.map((day) => eventMinuteOfDay(day.end, timeZone)));

  function balanceLabel(value: number | null | undefined) {
    if (value === null || value === undefined) return "—";
    return `${value > 0 ? "+" : value < 0 ? "−" : ""}${durationLabel(Math.abs(value))}`;
  }

  function summaryCellValue(summary: (typeof collaboratorSummaries)[number], column: ReportColumn) {
    const day = summary.days[0];
    if (column === "collaborator") return summary.profile.fullname;
    if (column === "poste") return summary.profile.poste || "—";
    if (column === "service") return summary.profile.service || "—";
    if (column === "days") return isSingleDay ? (day?.first ? "1" : "0") : `${summary.workedDays}/${summary.expectedDays || summary.days.length}`;
    if (column === "start") return isSingleDay ? timeLabel(day?.first, timeZone) : minuteOfDayLabel(summary.averageStart);
    if (column === "firstBreak") return isSingleDay ? timeLabel(day?.firstBreak, timeZone) : minuteOfDayLabel(summary.averageFirstBreak);
    if (column === "firstResume") return isSingleDay ? timeLabel(day?.firstResume, timeZone) : minuteOfDayLabel(summary.averageFirstResume);
    if (column === "end") return isSingleDay ? timeLabel(day?.end, timeZone) : minuteOfDayLabel(summary.averageEnd);
    if (column === "breakCount") return isSingleDay ? String(day?.breaks ?? 0) : decimalLabel(summary.averageBreaks);
    if (column === "pauseDuration") return isSingleDay ? durationLabel(day?.pause ?? 0) : summary.averagePause === null ? "—" : durationLabel(summary.averagePause);
    if (column === "late") return isSingleDay ? balanceLabel(day?.evaluation?.lateMinutes || null) : summary.averageLate === null ? "—" : durationLabel(summary.averageLate);
    return isSingleDay ? balanceLabel(day?.evaluation?.differenceMinutes) : balanceLabel(summary.averageBalance);
  }

  function dayCellValue(row: (typeof rows)[number], column: Exclude<ReportColumn, "collaborator" | "poste" | "service" | "days">) {
    if (column === "start") return timeLabel(row.first, timeZone);
    if (column === "firstBreak") return timeLabel(row.firstBreak, timeZone);
    if (column === "firstResume") return timeLabel(row.firstResume, timeZone);
    if (column === "end") return timeLabel(row.end, timeZone);
    if (column === "breakCount") return String(row.breaks);
    if (column === "pauseDuration") return durationLabel(row.pause);
    if (column === "late") return row.evaluation?.lateMinutes ? durationLabel(row.evaluation.lateMinutes) : "—";
    return balanceLabel(row.evaluation?.differenceMinutes);
  }

  function summaryColumnLabel(column: ReportColumn) {
    if (isSingleDay) return columnLabels[column];
    return ({
      ...columnLabels,
      start: "Début moyen",
      firstBreak: "Première pause moyenne",
      firstResume: "Première reprise moyenne",
      end: "Fin moyenne",
      breakCount: "Nombre moyen de pauses",
      pauseDuration: "Temps de pause moyen",
      late: "Retard moyen",
      balance: "Solde moyen",
    })[column];
  }

  async function handleExport(format: "pdf" | "excel" | "csv", scope: "summary" | "detail" = "summary") {
    const filename = `zecontrol-${scope === "summary" ? "resume" : "detail"}-${start || "tout"}-${end || "tout"}`;
    const reportSummaryHeaders = visibleColumns.map(summaryColumnLabel);
    const reportSummaryRows = collaboratorSummaries.map((summary) => visibleColumns.map((column) => summaryCellValue(summary, column)));
    const liveSummaryHeaders = ["Collaborateur", "Identifiant", "Poste", "Service", "État", "Arrivée", "Première pause", "Première reprise", "Fin", "Nombre de pauses", "Temps de pause", "Temps travaillé", "Retard"];
    const liveSummaryRows = orderedDayRows.map((row) => [
      row.profile.fullname,
      row.profile.identifiant,
      row.profile.poste || "—",
      row.profile.service || "—",
      (row.evaluation?.lateMinutes ?? 0) > 0 ? "En retard" : statusLabels[row.status],
      dayCellValue(row, "start"),
      dayCellValue(row, "firstBreak"),
      dayCellValue(row, "firstResume"),
      dayCellValue(row, "end"),
      dayCellValue(row, "breakCount"),
      dayCellValue(row, "pauseDuration"),
      durationLabel(row.worked),
      dayCellValue(row, "late"),
    ]);
    const summaryHeaders = view === "live" ? liveSummaryHeaders : reportSummaryHeaders;
    const summaryRows = view === "live" ? liveSummaryRows : reportSummaryRows;
    const detailHeaders = ["Collaborateur", "Journée", "Début", "Première pause", "Première reprise", "Fin", "Nombre de pauses", "Temps de pause", "Retard", "Solde", "Chronologie"];
    const detailRows = orderedDayRows.map((row) => [
      row.profile.fullname,
      new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${row.day}T12:00:00`)),
      dayCellValue(row, "start"),
      dayCellValue(row, "firstBreak"),
      dayCellValue(row, "firstResume"),
      dayCellValue(row, "end"),
      dayCellValue(row, "breakCount"),
      dayCellValue(row, "pauseDuration"),
      dayCellValue(row, "late"),
      dayCellValue(row, "balance"),
      row.valid.map((event) => `${timeLabel(event, timeZone)} ${typeLabels[event.type]}`).join(" · ") || "Aucun pointage",
    ]);
    const headers = scope === "summary" ? summaryHeaders : detailHeaders;
    const exportRows = scope === "summary" ? summaryRows : detailRows;
    if (format === "csv") exportCsv(filename, headers, exportRows);
    if (format === "excel") await exportExcel(filename, `${scope === "summary" ? "Résumé" : "Détail"} · ${organisationName}`, headers, exportRows);
    if (format === "pdf") await exportPdf(filename, `${scope === "summary" ? "Résumé" : "Détail"} · ${organisationName}`, `${rangeLabel} · ${timeZone}`, headers, exportRows);
  }

  if (loading) return <div className="settings-loading"><LoaderCircle className="spin" size={22} /> Chargement des rapports...</div>;
  if (error) return <div className="settings-error-state" role="alert"><AlertTriangle size={24} /><strong>{error}</strong><p>Les données déjà enregistrées ne sont pas perdues.</p><button className="button button-ghost" type="button" onClick={refresh}><RefreshCw size={16} /> Réessayer</button></div>;

  return (
    <div className={`organisation-reporting-workspace organisation-reporting-${view}`}>
      {view === "reports" && <div className="admin-report-period-row">
        <ReportPeriodToolbar
          period={period}
          start={start}
          end={end}
          onPeriodChange={changePeriod}
          onStartChange={(value) => { setStart(value); setPage(1); setRefreshing(true); }}
          onEndChange={(value) => { setEnd(value); setPage(1); setRefreshing(true); }}
          onExport={handleExport}
          exportScopes
        />
      </div>}
      {view === "live" && (
        <LiveDayToolbar
          day={liveDay}
          today={today}
          onDayChange={(value) => {
            setPeriod("day");
            setStart(value);
            setEnd(value);
            setPage(1);
            setSelectedRowKey(null);
            setRefreshing(true);
          }}
          onExport={handleExport}
        />
      )}
      <div className="admin-report-freshness">
        <span>{view === "live" ? liveDayLabel : rangeLabel}</span>
        {view === "live" && (isLiveToday
          ? <span className={`admin-live-state ${liveStatus}`}><i /> {liveStatus === "live" ? "Temps réel" : liveStatus === "connecting" ? "Connexion au direct" : "Direct indisponible"}</span>
          : <span className="admin-live-state historical"><i /> Journée archivée</span>)}
        {lastUpdatedAt && <small>Mis à jour à {new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }).format(lastUpdatedAt)} · {timeZone}</small>}
        <button className="admin-report-add-missing" type="button" onClick={() => setAdminMissingIntent({ profileId: selectedProfile?.id, requestedAt: zonedDateTime(`${liveDay}T09:00`, timeZone).toISOString() })}><Plus size={15} /> Ajouter un oubli</button>
        <button type="button" onClick={refresh} disabled={refreshing} aria-label="Actualiser"><RefreshCw className={refreshing ? "spin" : ""} size={14} /> Actualiser</button>
      </div>

      {view === "live" ? (
        <section className="report-kpis live-report-kpis">
          <article><span><UserCheck size={20} /></span><div><small>En service</small><strong>{workingCount}</strong></div></article>
          <article><span><Coffee size={20} /></span><div><small>En pause</small><strong>{pausedCount}</strong></div></article>
          <article className={lateCount ? "attention" : ""}><span><Clock3 size={20} /></span><div><small>En retard</small><strong>{lateCount}</strong></div></article>
          <article><span><Check size={20} /></span><div><small>Journée terminée</small><strong>{completedDays}</strong></div></article>
          <article className={absentCount ? "attention" : ""}><span><CalendarX2 size={20} /></span><div><small>Absents</small><strong>{absentCount}</strong></div></article>
        </section>
      ) : (
        <section className="report-summary-grid" aria-label="Synthèse des données filtrées">
          <article className="primary"><span><Timer size={21} /></span><div><small>Temps réalisé</small><strong>{durationLabel(aggregateTotalWorked)} <em>/ {durationLabel(aggregateTotalExpected)}</em></strong><p>{aggregateTotalWorked >= aggregateTotalExpected ? "+" : "−"}{durationLabel(Math.abs(aggregateTotalWorked - aggregateTotalExpected))} sur le temps attendu</p></div></article>
          <article><span><Clock3 size={20} /></span><div><small>Moyenne quotidienne</small><strong>{aggregateAverageWorked === null ? "—" : durationLabel(aggregateAverageWorked)}</strong><p>{aggregateWorkedDays.length} journée{aggregateWorkedDays.length > 1 ? "s" : ""} travaillée{aggregateWorkedDays.length > 1 ? "s" : ""}</p></div></article>
          <article className={aggregateTotalLate ? "attention" : ""}><span><Clock3 size={20} /></span><div><small>Retards</small><strong>{durationLabel(aggregateTotalLate)}</strong><p>{aggregateAverageLate === null ? "Aucun retard" : `${durationLabel(aggregateAverageLate)} en moyenne · ${aggregateLateDays.length}`}</p></div></article>
          <article><span><Coffee size={20} /></span><div><small>Pauses prises</small><strong>{aggregateBreaks}</strong><p>{aggregateAveragePause === null ? "Aucune pause mesurée" : `${durationLabel(aggregateAveragePause)} en moyenne`}</p></div></article>
          <article className={aggregateAbsences ? "attention" : ""}><span><CalendarX2 size={20} /></span><div><small>Absences potentielles</small><strong>{aggregateAbsences}</strong><p>Journées planifiées sans pointage</p></div></article>
          <article><span><CalendarDays size={20} /></span><div><small>Au-delà du prévu</small><strong>{durationLabel(aggregateTotalOvertime)}</strong><p>{aggregateAverageOvertime === null ? "Aucun dépassement" : `${durationLabel(aggregateAverageOvertime)} en moyenne`}</p></div></article>
          <div className="report-average-strip">
            <span><small>Début moyen</small><strong>{minuteOfDayLabel(aggregateAverageStart)}</strong></span>
            <span><small>Première pause</small><strong>{minuteOfDayLabel(aggregateAverageFirstBreak)}</strong></span>
            <span><small>Première reprise</small><strong>{minuteOfDayLabel(aggregateAverageFirstResume)}</strong></span>
            <span><small>Fin moyenne</small><strong>{minuteOfDayLabel(aggregateAverageEnd)}</strong></span>
            <p>Calculé sur {collaboratorSummaries.length} collaborateur{collaboratorSummaries.length > 1 ? "s" : ""} et {aggregateDays.length} journée{aggregateDays.length > 1 ? "s" : ""}.</p>
          </div>
        </section>
      )}

      {view === "live" && <section className="live-team-board">
        <header className="live-team-heading">
          <div>
            <span>{isLiveToday ? "Équipe aujourd’hui" : `Équipe · ${liveDayLabel}`}</span>
            <h2>{isLiveToday ? "Qui est là maintenant\u00a0?" : "Présences de cette journée"}</h2>
            <p>{isLiveToday ? "Sélectionnez une personne pour voir sa journée en cours." : "Sélectionnez une personne pour voir la chronologie de sa journée."}</p>
          </div>
          <div className="live-team-count"><strong>{filteredDayRows.length}</strong><span>personne{filteredDayRows.length > 1 ? "s" : ""}</span></div>
        </header>

        <div className="live-state-tabs" aria-label="Filtrer par état">
          {([
            ["all", "Toute l’équipe", rows.length],
            ["working", "En service", workingCount],
            ["paused", "En pause", pausedCount],
            ["late", "En retard", lateCount],
            ["completed", "Terminé", completedDays],
            ["absent", "Absents", absentCount],
          ] as const).map(([value, label, count]) => <button className={`${value} ${status === value ? "active" : ""}`} type="button" aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); }} key={value}><i /><span>{label}</span><strong>{count}</strong></button>)}
        </div>

        <div className="live-team-filters">
          <label><Search size={18} /><span className="sr-only">Rechercher un collaborateur</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Rechercher une personne" /></label>
          <label><Building2 size={17} /><span className="sr-only">Filtrer par service</span><select value={service} onChange={(event) => { setService(event.target.value); setPage(1); }}><option value="all">Tous les services</option>{services.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
          <label><ArrowDownUp size={17} /><span className="sr-only">Trier par heure d’arrivée</span><select value={arrivalOrder} onChange={(event) => { setArrivalOrder(event.target.value as ArrivalOrder); setPage(1); }}><option value="oldest">Premières arrivées</option><option value="newest">Dernières arrivées</option></select></label>
        </div>

        {displayedDayRows.length === 0 ? <div className="live-team-empty"><UsersRound size={27} /><strong>Aucune personne dans cette vue</strong><p>Modifiez le filtre ou la recherche pour retrouver un collaborateur.</p><button type="button" onClick={() => { setStatus("all"); setService("all"); setQuery(""); }}>Effacer les filtres</button></div> : <div className="live-team-list">{displayedDayRows.map((row) => {
          const lastEvent = row.valid.at(-1);
          const LastIcon = lastEvent ? typeIcons[lastEvent.type] : Clock3;
          return <button className={`live-person-row state-${row.status}`} type="button" onClick={() => setSelectedRowKey(row.key)} key={row.key}>
            <span className="live-person-avatar">{row.profile.fullname.slice(0, 2).toUpperCase()}<i /></span>
            <span className="live-person-identity"><strong>{row.profile.fullname}</strong><small>{[row.profile.poste, row.profile.service].filter(Boolean).join(" · ") || row.profile.identifiant}</small></span>
            <span className={`live-person-status ${(row.evaluation?.lateMinutes ?? 0) > 0 ? "late" : row.status}`}><i />{(row.evaluation?.lateMinutes ?? 0) > 0 ? `Retard · ${durationLabel(row.evaluation!.lateMinutes)}` : statusLabels[row.status]}</span>
            <span className="live-person-last"><LastIcon size={16} /><small>{lastEvent ? typeLabels[lastEvent.type] : "Aucun pointage"}</small><strong>{lastEvent ? timeLabel(lastEvent, timeZone) : "—"}</strong></span>
            <span className="live-person-worked"><small>Temps travaillé</small><strong>{durationLabel(row.worked)}</strong></span>
            <ChevronRight size={19} />
          </button>;
        })}</div>}

        {liveTotalPages > 1 && <footer className="live-team-pagination"><span>{filteredDayRows.length} personnes</span><div><button type="button" disabled={liveCurrentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={17} /> Précédent</button><strong>{liveCurrentPage} / {liveTotalPages}</strong><button type="button" disabled={liveCurrentPage === liveTotalPages} onClick={() => setPage((value) => Math.min(liveTotalPages, value + 1))}>Suivant <ChevronRight size={17} /></button></div></footer>}
      </section>}

      {view === "reports" && <section className="admin-attendance-card">
        <header className="admin-attendance-heading">
          <div><span>Présences et temps</span><h2>{selectedProfile ? `Rapport de ${selectedProfile.fullname}` : "Activité de l’équipe"}</h2><p>{collaboratorSummaries.length} collaborateur{collaboratorSummaries.length > 1 ? "s" : ""} dans le périmètre filtré.</p></div>
          <details className="activity-column-picker admin-column-picker">
            <summary><Columns3 size={15} /> Colonnes</summary>
            <div>{columnOrder.map((column) => <label key={column}><input type="checkbox" checked={visibleColumns.includes(column)} disabled={column === "collaborator"} onChange={() => toggleColumn(column)} /><span>{summaryColumnLabel(column)}</span></label>)}</div>
          </details>
        </header>

        {selectedProfile && <div className="report-profile-focus"><span>{selectedProfile.fullname.slice(0, 2).toUpperCase()}</span><div><small>Rapport individuel</small><strong>{selectedProfile.fullname}</strong></div><button type="button" onClick={() => { setSelectedProfileId(null); setExpandedProfileIds([]); setPage(1); }}><X size={15} /> Revenir à toute l’équipe</button></div>}

        <div className="admin-report-filters">
          <label className="admin-search-filter"><Search size={16} /><span className="sr-only">Rechercher</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Nom, identifiant, poste ou service" /></label>
          <label><Building2 size={16} /><span className="sr-only">Service</span><select value={service} onChange={(event) => { setService(event.target.value); setPage(1); }}><option value="all">Tous les services</option>{services.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
          <label><Filter size={16} /><span className="sr-only">État</span><select value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}><option value="all">Tous les états</option><option value="working">En service</option><option value="paused">En pause</option><option value="completed">Terminé</option><option value="absent">Absent</option><option value="late">En retard</option></select></label>
        </div>

        {displayedSummaries.length === 0 ? (
          <div className="report-empty"><Clock3 size={25} /><p>Aucun collaborateur ne correspond à ces filtres.</p></div>
        ) : (
          <div className="admin-attendance-table report-collaborator-table">
            <table>
              <thead><tr>{visibleColumns.map((column) => <th className={column === "collaborator" ? "sticky-column" : ""} key={column}>{summaryColumnLabel(column)}</th>)}<th><span className="sr-only">Détails</span></th></tr></thead>
              <tbody>{displayedSummaries.map((summary) => {
                const expanded = expandedProfileIds.includes(summary.profile.id);
                const singleDay = summary.days[0];
                return [
                  <tr className={expanded ? "is-expanded" : ""} key={summary.profile.id}>
                    {visibleColumns.map((column) => <td className={column === "collaborator" ? "sticky-column admin-person-cell" : ""} data-label={summaryColumnLabel(column)} key={column}>{column === "collaborator" ? <><span>{summary.profile.fullname.slice(0, 2).toUpperCase()}</span><div><button className="report-person-focus" type="button" onClick={() => focusCollaborator(summary.profile.id)}>{summary.profile.fullname}</button><small>{summary.profile.identifiant}</small></div></> : summaryCellValue(summary, column)}</td>)}
                    <td className="report-row-action">{isSingleDay ? <button type="button" disabled={!singleDay} onClick={() => singleDay && setSelectedRowKey(singleDay.key)}><Clock3 size={15} /><span>Pointages</span></button> : <button type="button" aria-expanded={expanded} aria-controls={`report-days-${summary.profile.id}`} onClick={() => toggleCollaborator(summary.profile.id)}><ChevronDown size={17} /><span>{expanded ? "Masquer" : "Journées"}</span></button>}</td>
                  </tr>,
                  !isSingleDay && expanded ? <tr className="report-days-row" key={`${summary.profile.id}-days`}><td colSpan={visibleColumns.length + 1}><div className="report-days-accordion" id={`report-days-${summary.profile.id}`}><header><div><small>Détail de la période</small><strong>{summary.profile.fullname}</strong></div><span>{summary.days.length} journée{summary.days.length > 1 ? "s" : ""}</span></header>{summary.days.length ? <div className="report-day-list"><div className="report-day-line heading"><span>Journée</span><span>Début</span><span>1re pause</span><span>1re reprise</span><span>Fin</span><span>Pauses</span><span>Temps de pause</span><span>Retard</span><span>Solde</span><span /></div>{summary.days.map((day) => <button className={day.isPotentialAbsence ? "report-day-line is-absence" : "report-day-line"} type="button" onClick={() => setSelectedRowKey(day.key)} key={day.key}><span data-label="Journée"><strong>{new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${day.day}T12:00:00`))}</strong>{day.isPotentialAbsence && <small>Absence potentielle</small>}</span><span data-label="Début">{dayCellValue(day, "start")}</span><span data-label="1re pause">{dayCellValue(day, "firstBreak")}</span><span data-label="1re reprise">{dayCellValue(day, "firstResume")}</span><span data-label="Fin">{dayCellValue(day, "end")}</span><span data-label="Pauses">{dayCellValue(day, "breakCount")}</span><span data-label="Temps de pause">{dayCellValue(day, "pauseDuration")}</span><span data-label="Retard">{dayCellValue(day, "late")}</span><span data-label="Solde">{dayCellValue(day, "balance")}</span><ChevronRight size={16} /></button>)}</div> : <div className="report-days-empty"><CalendarDays size={21} /> Aucune journée disponible sur cette période.</div>}</div></td></tr> : null,
                ];
              })}</tbody>
            </table>
          </div>
        )}

        <footer className="admin-table-pagination">
          <span>{collaboratorSummaries.length ? `${(reportCurrentPage - 1) * PAGE_SIZE + 1}–${Math.min(reportCurrentPage * PAGE_SIZE, collaboratorSummaries.length)} sur ${collaboratorSummaries.length}` : "0 résultat"}</span>
          <div><button type="button" disabled={reportCurrentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /> Précédent</button><strong>{reportCurrentPage} / {reportTotalPages}</strong><button type="button" disabled={reportCurrentPage === reportTotalPages} onClick={() => setPage((value) => Math.min(reportTotalPages, value + 1))}>Suivant <ChevronRight size={16} /></button></div>
        </footer>
      </section>}

      {selectedRow && (
        <div className="activity-detail-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRowKey(null); }}>
          <aside className="activity-day-detail admin-day-detail" role="dialog" aria-modal="true" aria-labelledby="admin-day-detail-title">
            <button className="activity-detail-close" type="button" aria-label="Fermer" onClick={() => setSelectedRowKey(null)}><X size={19} /></button>
            <header>
              <span>Détail du collaborateur</span>
              <h2 id="admin-day-detail-title">{selectedRow.profile.fullname}</h2>
              <p>{selectedRow.profile.poste || "Poste non renseigné"} · {selectedRow.profile.service || "Service non renseigné"}</p>
              <div><strong>{durationLabel(selectedRow.worked)}</strong><small>travaillées</small><i /><strong>{durationLabel(selectedRow.pause)}</strong><small>de pause</small></div>
            </header>
            <div className="admin-detail-date"><Clock3 size={16} /><span>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "full" }).format(new Date(`${selectedRow.day}T12:00:00`))}</span><strong className={`admin-detail-state ${selectedRow.status}`}>{statusLabels[selectedRow.status]}</strong></div>
            {selectedRow.evaluation && <div className="admin-policy-comparison"><article><small>Horaire prévu</small><strong>{selectedRow.evaluation.schedule ? `${selectedRow.evaluation.schedule.startTime}–${selectedRow.evaluation.schedule.endTime}` : "Libre"}</strong></article><article><small>Temps attendu</small><strong>{durationLabel(selectedRow.evaluation.expectedMinutes)}</strong></article><article><small>Écart</small><strong>{selectedRow.evaluation.differenceMinutes > 0 ? "+" : selectedRow.evaluation.differenceMinutes < 0 ? "−" : ""}{durationLabel(Math.abs(selectedRow.evaluation.differenceMinutes))}</strong></article><article className={selectedRow.evaluation.label === "Conforme" ? "ok" : "issue"}><small>Lecture</small><strong>{selectedRow.evaluation.label}</strong></article></div>}
            <div className="activity-detail-events">
              {selectedRow.events.length ? [...selectedRow.events].sort((a, b) => +new Date(a.pointed_at) - +new Date(b.pointed_at)).map((event) => {
                const Icon = typeIcons[event.type];
                return <article className={`detail-event event-${event.type} status-${event.event_status}`} key={event.id}><span><Icon size={17} /></span><div><small>{typeLabels[event.type]}</small><strong>{timeLabel(event, timeZone)}</strong></div><em>{event.event_status === "accepted" ? "Validé" : event.event_status === "pending" ? "À vérifier" : event.event_status === "rejected" ? "Refusé" : "Annulé"}</em></article>;
              }) : <div className="admin-detail-empty"><Clock3 size={22} /><strong>Aucun pointage</strong><p>Ce collaborateur n’a pas encore commencé cette journée.</p></div>}
            </div>
            <footer className="admin-detail-actions"><button type="button" onClick={() => { setAdminMissingIntent({ profileId: selectedRow.profile.id, requestedAt: zonedDateTime(`${selectedRow.day}T09:00`, timeZone).toISOString() }); setSelectedRowKey(null); }}><Plus size={15} /> Ajouter un pointage</button><Link href={`/dashboard/equipe/${selectedRow.profile.id}`}><Settings2 size={15} /> Gérer le profil</Link></footer>
          </aside>
        </div>
      )}

      {adminMissingIntent && <AdminMissingEventPanel profiles={profiles} timeZone={timeZone} initialProfileId={adminMissingIntent.profileId} initialRequestedAt={adminMissingIntent.requestedAt} onClose={() => setAdminMissingIntent(null)} onCreated={() => { setRefreshing(true); setReloadToken((value) => value + 1); }} />}
    </div>
  );
}
