"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coffee,
  Columns3,
  Filter,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  UserCheck,
  UsersRound,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ReportPeriodToolbar } from "./report-period-toolbar";
import { exportCsv, exportExcel, exportPdf } from "@/lib/reports/export";
import { dateKey, defaultPeriodDates, periodLabel, zonedDayBoundary, type ReportPeriod } from "@/lib/reports/period";
import { isWorkPolicyDefinition, type WorkPolicyDefinition } from "@/lib/work-policy";
import { currentWorkPolicyMessage, evaluateWorkday } from "@/lib/work-policy-evaluation";

type EventType = "start" | "break" | "resume" | "end";
type EventStatus = "pending" | "accepted" | "rejected" | "cancelled";
type LiveStatus = "connecting" | "live" | "unavailable";
type RowStatus = "working" | "paused" | "completed" | "not-started" | "attention";
type StatusFilter = "all" | RowStatus | "late";

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
  poste: string | null;
  service: string | null;
  fullname: string;
  identifiant: string;
};

type ReportColumn =
  | "collaborator"
  | "poste"
  | "service"
  | "day"
  | "schedule"
  | "start"
  | "late"
  | "firstBreak"
  | "firstResume"
  | "end"
  | "worked"
  | "expected"
  | "difference"
  | "overtime"
  | "pause"
  | "compliance"
  | "status"
  | "events";

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
  "not-started": "Pas commencé",
  attention: "À vérifier",
};
const columnOrder: ReportColumn[] = [
  "collaborator",
  "poste",
  "service",
  "day",
  "schedule",
  "start",
  "late",
  "firstBreak",
  "firstResume",
  "end",
  "worked",
  "expected",
  "difference",
  "overtime",
  "pause",
  "compliance",
  "status",
  "events",
];
const columnLabels: Record<ReportColumn, string> = {
  collaborator: "Nom complet",
  poste: "Poste",
  service: "Service",
  day: "Journée",
  schedule: "Horaire prévu",
  start: "Début de service",
  late: "Retard",
  firstBreak: "Première pause",
  firstResume: "Première reprise",
  end: "Fin de service",
  worked: "Temps travaillé",
  expected: "Temps attendu",
  difference: "Écart",
  overtime: "Heures sup.",
  pause: "Temps de pause",
  compliance: "Lecture horaire",
  status: "État",
  events: "Pointages",
};
const reportDefaultColumns = columnOrder.filter((column) => column !== "events");
const liveDefaultColumns: ReportColumn[] = [
  "collaborator",
  "poste",
  "service",
  "schedule",
  "start",
  "firstBreak",
  "worked",
  "compliance",
  "status",
];

type ReportWorkPolicy = { id: string; is_enabled: boolean; is_default: boolean };
type ReportWorkPolicyVersion = { policy_id: string; definition: unknown; effective_from: string; version_number: number };
type ReportWorkPolicyAssignment = {
  policy_id: string;
  target_type: "organisation" | "service" | "team" | "profile";
  service_name: string | null;
  team_id: string | null;
  profile_id: string | null;
  valid_from: string;
  valid_until: string | null;
  priority: number;
};
type ReportTeamMember = { team_id: string; profile_id: string; is_active: boolean };

function durationLabel(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}`;
}

function activeEvents(events: ReportEvent[]) {
  return [...events]
    .filter((event) => event.event_status === "accepted" || event.event_status === "pending")
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

function timeLabel(event: ReportEvent | undefined, timeZone: string) {
  return event
    ? new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(event.pointed_at))
    : "—";
}

function rowStatus(events: ReportEvent[]): RowStatus {
  if (events.some((event) => event.event_status === "pending" || event.event_status === "rejected")) {
    return "attention";
  }
  const last = activeEvents(events).at(-1);
  if (!last) return "not-started";
  if (last.type === "break") return "paused";
  if (last.type === "end") return "completed";
  return "working";
}

function nextDateKey(value: string) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return dateKey(date);
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
  const [period, setPeriod] = useState<ReportPeriod>(initialPeriod);
  const [start, setStart] = useState(initialDates.start);
  const [end, setEnd] = useState(initialDates.end);
  const [reloadToken, setReloadToken] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [visibleColumns, setVisibleColumns] = useState<ReportColumn[]>(view === "live" ? liveDefaultColumns : reportDefaultColumns);
  const [page, setPage] = useState(1);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);

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
      setProfiles((profileResult.data ?? []) as ReportProfile[]);
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
      if (
        policiesResult.error ||
        versionsResult.error ||
        assignmentsResult.error ||
        membersResult.error
      ) {
        setWorkPolicies([]);
        setWorkPolicyVersions([]);
        setWorkPolicyAssignments([]);
        setWorkTeamMembers([]);
        return;
      }
      setWorkPolicies((policiesResult.data ?? []) as ReportWorkPolicy[]);
      setWorkPolicyVersions((versionsResult.data ?? []) as ReportWorkPolicyVersion[]);
      setWorkPolicyAssignments((assignmentsResult.data ?? []) as ReportWorkPolicyAssignment[]);
      setWorkTeamMembers((membersResult.data ?? []) as ReportTeamMember[]);
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

  const rows = useMemo(() => {
    const groups = new Map<string, ReportEvent[]>();
    const policyById = new Map(workPolicies.map((policy) => [policy.id, policy]));
    const teamsByProfile = new Map<string, Set<string>>();
    for (const member of workTeamMembers) {
      if (!member.is_active) continue;
      const teamIds = teamsByProfile.get(member.profile_id) ?? new Set<string>();
      teamIds.add(member.team_id);
      teamsByProfile.set(member.profile_id, teamIds);
    }
    const defaultPolicy = workPolicies.find((policy) => policy.is_default && policy.is_enabled);

    function resolveDefinition(profile: ReportProfile, day: string): WorkPolicyDefinition | null {
      const profileTeams = teamsByProfile.get(profile.id) ?? new Set<string>();
      const matching = workPolicyAssignments
        .filter((assignment) => {
          const policy = policyById.get(assignment.policy_id);
          if (!policy?.is_enabled) return false;
          if (assignment.valid_from > day || (assignment.valid_until && assignment.valid_until < day)) return false;
          if (assignment.target_type === "profile") return assignment.profile_id === profile.id;
          if (assignment.target_type === "team") return Boolean(assignment.team_id && profileTeams.has(assignment.team_id));
          if (assignment.target_type === "service") {
            return Boolean(
              assignment.service_name &&
              profile.service &&
              assignment.service_name.trim().toLocaleLowerCase("fr") === profile.service.trim().toLocaleLowerCase("fr"),
            );
          }
          return assignment.target_type === "organisation";
        })
        .sort((a, b) => {
          const ranks = { organisation: 100, service: 200, team: 300, profile: 400 };
          return (ranks[b.target_type] + b.priority) - (ranks[a.target_type] + a.priority) ||
            b.valid_from.localeCompare(a.valid_from);
        });
      const policyId = matching[0]?.policy_id ?? defaultPolicy?.id;
      if (!policyId) return null;
      const version = workPolicyVersions
        .filter((candidate) => candidate.policy_id === policyId && candidate.effective_from <= day)
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.version_number - a.version_number)[0];
      return isWorkPolicyDefinition(version?.definition)
        ? { ...version.definition, daySchedules: version.definition.daySchedules ?? {} }
        : null;
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

    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const result = Array.from(groups, ([key, dayEvents]) => {
      const [profileId, day] = key.split(":");
      const profile = profileById.get(profileId);
      return profile ? { key, day, profile, events: dayEvents } : null;
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));

    if (start && start === end) {
      const existingProfiles = new Set(result.map((row) => row.profile.id));
      for (const profile of profiles) {
        if (!existingProfiles.has(profile.id)) {
          result.push({ key: `${profile.id}:${start}`, day: start, profile, events: [] });
        }
      }
    }

    return result
      .map((row) => {
        const valid = activeEvents(row.events);
        const definition = resolveDefinition(row.profile, row.day);
        const evaluation = definition
          ? evaluateWorkday({
              definition,
              events: row.events,
              date: row.day,
              now: new Date(clockTick),
              timeZone,
            })
          : null;
        const policyMessage =
          definition && row.day === dateKey(new Date(clockTick), timeZone)
            ? currentWorkPolicyMessage({
                definition,
                events: row.events,
                now: new Date(clockTick),
                timeZone,
              })
            : null;
        return {
          ...row,
          valid,
          first: valid.find((event) => event.type === "start"),
          firstBreak: valid.find((event) => event.type === "break"),
          firstResume: valid.find((event) => event.type === "resume"),
          end: [...valid].reverse().find((event) => event.type === "end"),
          worked: workedMinutes(row.events, clockTick, timeZone),
          pause: pauseMinutes(row.events, clockTick, timeZone),
          status: rowStatus(row.events),
          definition,
          evaluation,
          policyMessage,
        };
      })
      .sort((a, b) => b.day.localeCompare(a.day) || a.profile.fullname.localeCompare(b.profile.fullname, "fr"));
  }, [clockTick, end, events, period, profiles, start, timeZone, workPolicies, workPolicyAssignments, workPolicyVersions, workTeamMembers]);

  const services = [...new Set(profiles.map((profile) => profile.service).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "fr"));
  const normalizedQuery = query.trim().toLocaleLowerCase("fr");
  const filteredRows = rows.filter((row) => {
    const searchable = `${row.profile.fullname} ${row.profile.identifiant} ${row.profile.poste ?? ""} ${row.profile.service ?? ""}`.toLocaleLowerCase("fr");
    return (!normalizedQuery || searchable.includes(normalizedQuery)) &&
      (service === "all" || row.profile.service === service) &&
      (
        status === "all" ||
        (status === "late"
          ? Boolean((row.evaluation?.lateMinutes ?? 0) > 0 || row.policyMessage?.tone === "attention")
          : row.status === status)
      );
  });

  const rangeLabel = periodLabel(period, start, end);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const displayedRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selectedRow = selectedRowKey ? rows.find((row) => row.key === selectedRowKey) ?? null : null;
  const activeProfileCount = new Set(rows.filter((row) => row.valid.length > 0).map((row) => row.profile.id)).size;
  const completedDays = rows.filter((row) => row.status === "completed").length;
  const attentionCount = rows.filter((row) => row.status === "attention").length;
  const workingCount = rows.filter((row) => row.status === "working").length;
  const pausedCount = rows.filter((row) => row.status === "paused").length;
  const notStartedCount = rows.filter((row) => row.status === "not-started").length;
  const lateCount = rows.filter((row) => (row.evaluation?.lateMinutes ?? 0) > 0 || row.policyMessage?.tone === "attention").length;
  const scheduleIssueCount = rows.filter((row) =>
    row.evaluation &&
    !["Conforme", "À venir", "Non planifiée"].includes(row.evaluation.label),
  ).length;

  function cellValue(row: (typeof rows)[number], column: ReportColumn) {
    if (column === "collaborator") return row.profile.fullname;
    if (column === "poste") return row.profile.poste || "—";
    if (column === "service") return row.profile.service || "—";
    if (column === "day") return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${row.day}T12:00:00`));
    if (column === "schedule") return row.evaluation?.schedule ? `${row.evaluation.schedule.startTime}–${row.evaluation.schedule.endTime}` : "—";
    if (column === "start") return timeLabel(row.first, timeZone);
    if (column === "late") return row.evaluation?.lateMinutes ? durationLabel(row.evaluation.lateMinutes) : "—";
    if (column === "firstBreak") return timeLabel(row.firstBreak, timeZone);
    if (column === "firstResume") return timeLabel(row.firstResume, timeZone);
    if (column === "end") return timeLabel(row.end, timeZone);
    if (column === "worked") return durationLabel(row.worked);
    if (column === "expected") return row.evaluation ? durationLabel(row.evaluation.expectedMinutes) : "—";
    if (column === "difference") {
      if (!row.evaluation) return "—";
      const difference = row.evaluation.differenceMinutes;
      return `${difference > 0 ? "+" : difference < 0 ? "−" : ""}${durationLabel(Math.abs(difference))}`;
    }
    if (column === "overtime") return row.evaluation?.overtimeMinutes ? durationLabel(row.evaluation.overtimeMinutes) : "—";
    if (column === "pause") return durationLabel(row.pause);
    if (column === "compliance") return row.evaluation?.label ?? "Non configuré";
    if (column === "events") return String(row.events.length);
    return statusLabels[row.status];
  }

  const exportHeaders = visibleColumns.map((column) => columnLabels[column]);
  const exportRows = filteredRows.map((row) => visibleColumns.map((column) => cellValue(row, column)));

  async function handleExport(format: "pdf" | "excel" | "csv") {
    const filename = `zecontrol-organisation-${start || "tout"}-${end || "tout"}`;
    if (format === "csv") exportCsv(filename, exportHeaders, exportRows);
    if (format === "excel") await exportExcel(filename, `Rapport · ${organisationName}`, exportHeaders, exportRows);
    if (format === "pdf") await exportPdf(filename, `Rapport · ${organisationName}`, `${rangeLabel} · ${timeZone}`, exportHeaders, exportRows);
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
        />
      </div>}
      <div className="admin-report-freshness">
        <span>{view === "live" ? "Aujourd’hui" : rangeLabel}</span>
        {view === "live" && <span className={`admin-live-state ${liveStatus}`}><i /> {liveStatus === "live" ? "Temps réel" : liveStatus === "connecting" ? "Connexion au direct" : "Direct indisponible"}</span>}
        {lastUpdatedAt && <small>Mis à jour à {new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }).format(lastUpdatedAt)} · {timeZone}</small>}
        <button type="button" onClick={refresh} disabled={refreshing} aria-label="Actualiser"><RefreshCw className={refreshing ? "spin" : ""} size={14} /> Actualiser</button>
      </div>

      {view === "live" ? (
        <section className="report-kpis live-report-kpis">
          <article><span><UserCheck size={20} /></span><div><small>En service</small><strong>{workingCount}</strong></div></article>
          <article><span><Coffee size={20} /></span><div><small>En pause</small><strong>{pausedCount}</strong></div></article>
          <article><span><Check size={20} /></span><div><small>Journée terminée</small><strong>{completedDays}</strong></div></article>
          <article><span><Clock3 size={20} /></span><div><small>Pas commencé</small><strong>{notStartedCount}</strong></div></article>
          <article className={lateCount ? "attention" : ""}><span><Clock3 size={20} /></span><div><small>En retard</small><strong>{lateCount}</strong></div></article>
          <article className={attentionCount ? "attention" : ""}><span><AlertTriangle size={20} /></span><div><small>À vérifier</small><strong>{attentionCount}</strong></div></article>
        </section>
      ) : (
        <section className="report-kpis">
          <article><span><UsersRound size={20} /></span><div><small>Collaborateurs</small><strong>{profiles.length}</strong></div></article>
          <article><span><UserCheck size={20} /></span><div><small>Présents sur la période</small><strong>{activeProfileCount}</strong></div></article>
          <article><span><Check size={20} /></span><div><small>Journées terminées</small><strong>{completedDays}</strong></div></article>
          <article className={scheduleIssueCount ? "attention" : ""}><span><Clock3 size={20} /></span><div><small>Écarts horaires</small><strong>{scheduleIssueCount}</strong></div></article>
          <article className={attentionCount ? "attention" : ""}><span><AlertTriangle size={20} /></span><div><small>À vérifier</small><strong>{attentionCount}</strong></div></article>
        </section>
      )}

      {view === "live" && <section className="live-team-board">
        <header className="live-team-heading">
          <div><span>Équipe aujourd’hui</span><h2>Qui est là maintenant&nbsp;?</h2><p>Sélectionnez une personne pour voir sa journée en cours.</p></div>
          <div className="live-team-count"><strong>{filteredRows.length}</strong><span>personne{filteredRows.length > 1 ? "s" : ""}</span></div>
        </header>

        <div className="live-state-tabs" aria-label="Filtrer par état">
          {([
            ["all", "Toute l’équipe", profiles.length],
            ["working", "En service", workingCount],
            ["paused", "En pause", pausedCount],
            ["completed", "Terminé", completedDays],
            ["not-started", "Pas commencé", notStartedCount],
            ["late", "En retard", lateCount],
            ["attention", "À vérifier", attentionCount],
          ] as const).map(([value, label, count]) => <button className={`${value} ${status === value ? "active" : ""}`} type="button" aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); }} key={value}><i /><span>{label}</span><strong>{count}</strong></button>)}
        </div>

        <div className="live-team-filters">
          <label><Search size={18} /><span className="sr-only">Rechercher un collaborateur</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Rechercher une personne" /></label>
          <label><Building2 size={17} /><span className="sr-only">Filtrer par service</span><select value={service} onChange={(event) => { setService(event.target.value); setPage(1); }}><option value="all">Tous les services</option>{services.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        </div>

        {displayedRows.length === 0 ? <div className="live-team-empty"><UsersRound size={27} /><strong>Aucune personne dans cette vue</strong><p>Modifiez le filtre ou la recherche pour retrouver un collaborateur.</p><button type="button" onClick={() => { setStatus("all"); setService("all"); setQuery(""); }}>Effacer les filtres</button></div> : <div className="live-team-list">{displayedRows.map((row) => {
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

        {totalPages > 1 && <footer className="live-team-pagination"><span>{filteredRows.length} personnes</span><div><button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={17} /> Précédent</button><strong>{currentPage} / {totalPages}</strong><button type="button" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Suivant <ChevronRight size={17} /></button></div></footer>}
      </section>}

      {view === "reports" && <section className="admin-attendance-card">
        <header className="admin-attendance-heading">
          <div><span>Présences et temps</span><h2>Activité de l’équipe</h2><p>{filteredRows.length} ligne{filteredRows.length > 1 ? "s" : ""} correspondant aux filtres.</p></div>
          <details className="activity-column-picker admin-column-picker">
            <summary><Columns3 size={15} /> Colonnes</summary>
            <div>{columnOrder.map((column) => <label key={column}><input type="checkbox" checked={visibleColumns.includes(column)} disabled={column === "collaborator"} onChange={() => toggleColumn(column)} /><span>{columnLabels[column]}</span></label>)}</div>
          </details>
        </header>

        <div className="admin-report-filters">
          <label className="admin-search-filter"><Search size={16} /><span className="sr-only">Rechercher</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Nom, identifiant, poste ou service" /></label>
          <label><Building2 size={16} /><span className="sr-only">Service</span><select value={service} onChange={(event) => { setService(event.target.value); setPage(1); }}><option value="all">Tous les services</option>{services.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
          <label><Filter size={16} /><span className="sr-only">État</span><select value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}><option value="all">Tous les états</option><option value="working">En service</option><option value="paused">En pause</option><option value="completed">Terminé</option><option value="not-started">Pas commencé</option><option value="late">En retard</option><option value="attention">À vérifier</option></select></label>
        </div>

        {displayedRows.length === 0 ? (
          <div className="report-empty"><Clock3 size={25} /><p>Aucune journée ne correspond à ces filtres.</p></div>
        ) : (
          <div className="admin-attendance-table">
            <table>
              <thead><tr>{visibleColumns.map((column) => <th className={column === "collaborator" ? "sticky-column" : ""} key={column}>{columnLabels[column]}</th>)}</tr></thead>
              <tbody>{displayedRows.map((row) => <tr role="button" tabIndex={0} aria-label={`Voir la journée de ${row.profile.fullname}`} onClick={() => setSelectedRowKey(row.key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedRowKey(row.key); }} key={row.key}>{visibleColumns.map((column) => <td className={`${column === "collaborator" ? "sticky-column admin-person-cell" : ""} ${column === "status" ? `admin-status-cell ${row.status}` : ""}`} key={column}>{column === "collaborator" ? <><span>{row.profile.fullname.slice(0, 2).toUpperCase()}</span><div><strong>{row.profile.fullname}</strong><small>{row.profile.identifiant}</small></div></> : column === "status" ? <span>{cellValue(row, column)}</span> : cellValue(row, column)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}

        <footer className="admin-table-pagination">
          <span>{filteredRows.length ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filteredRows.length)} sur ${filteredRows.length}` : "0 résultat"}</span>
          <div><button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /> Précédent</button><strong>{currentPage} / {totalPages}</strong><button type="button" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Suivant <ChevronRight size={16} /></button></div>
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
            <footer className="admin-detail-actions"><Link href={`/dashboard/equipe/${selectedRow.profile.id}`}><Settings2 size={15} /> Gérer le profil</Link>{selectedRow.status === "attention" && <Link href="/dashboard/demandes"><AlertTriangle size={15} /> Voir les demandes</Link>}</footer>
          </aside>
        </div>
      )}
    </div>
  );
}
