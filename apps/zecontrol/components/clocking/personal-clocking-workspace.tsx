"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CalendarDays,
  Check,
  CirclePause,
  Clock3,
  Coffee,
  LoaderCircle,
  LocateFixed,
  LogIn,
  LogOut,
  PenLine,
  Plus,
  RotateCcw,
  ShieldCheck,
  TimerReset,
  Undo2,
  UserRound,
} from "lucide-react";
import { ZeControlLogo } from "@ze/ui-foundations/brands";
import { createClient } from "@/lib/supabase/client";
import { dateKey } from "@/lib/reports/period";
import { isWorkPolicyDefinition, type WorkPolicyDefinition } from "@/lib/work-policy";
import {
  currentBreakProgress,
  currentWorkPolicyMessage,
  type BreakProgress,
} from "@/lib/work-policy-evaluation";
import { EventRequestPanel, type EventRequestIntent } from "./event-request-panel";

type EventType = "start" | "break" | "resume" | "end";
type EventStatus = "pending" | "accepted" | "rejected" | "cancelled";

type ClockingEvent = {
  id: string;
  type: EventType;
  event_status: EventStatus;
  pointed_at: string;
  lat: number;
  long: number;
};

type ClockingZone = {
  lat: number;
  long: number;
  radius: number;
};

const POINTING_CLICK_COOLDOWN_MS = 5_000;

const typeLabels: Record<EventType, string> = {
  start: "Arrivée",
  break: "Début de pause",
  resume: "Reprise",
  end: "Départ",
};

function minutesForEvents(events: ClockingEvent[], now: Date, timeZone: string) {
  const chronological = [...events]
    .filter((event) => event.event_status === "accepted" || event.event_status === "pending")
    .sort((a, b) => new Date(a.pointed_at).getTime() - new Date(b.pointed_at).getTime());
  let openedAt: number | null = null;
  let total = 0;

  for (const event of chronological) {
    const timestamp = new Date(event.pointed_at).getTime();
    if (event.type === "start" || event.type === "resume") openedAt = timestamp;
    if ((event.type === "break" || event.type === "end") && openedAt !== null) {
      total += Math.max(0, timestamp - openedAt);
      openedAt = null;
    }
  }
  const lastDate = new Date(chronological.at(-1)?.pointed_at ?? now);
  if (openedAt !== null && dateKey(now, timeZone) === dateKey(lastDate, timeZone)) {
    total += Math.max(0, now.getTime() - openedAt);
  }
  return Math.floor(total / 60000);
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${String(remainder).padStart(2, "0")}`;
}

function compactDurationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

function BreakCountdown({ progress }: { progress: BreakProgress }) {
  const overdue = progress.overdueMinutes > 0;
  return (
    <div className={`agent-break-countdown ${overdue ? "is-overdue" : ""}`}>
      <span className="agent-break-countdown-icon"><Coffee size={18} /></span>
      <div className="agent-break-countdown-copy">
        <small>Pause autorisée</small>
        <strong>{compactDurationLabel(progress.allowedMinutes)}</strong>
      </div>
      <div className="agent-break-countdown-value">
        <small>{compactDurationLabel(progress.elapsedMinutes)} écoulées</small>
        <strong>
          {overdue
            ? `Dépassée de ${compactDurationLabel(progress.overdueMinutes)}`
            : `${compactDurationLabel(progress.remainingMinutes)} restantes`}
        </strong>
      </div>
      <div
        className="agent-break-countdown-track"
        role="progressbar"
        aria-label="Progression de la pause"
        aria-valuemin={0}
        aria-valuemax={progress.allowedMinutes}
        aria-valuenow={Math.min(
          progress.elapsedMinutes,
          progress.allowedMinutes,
        )}
      >
        <i style={{ width: `${progress.progressPercent}%` }} />
      </div>
    </div>
  );
}

function nextEvent(lastEvent: ClockingEvent | undefined): EventType {
  if (!lastEvent) return "start";
  if (lastEvent.type === "end") return "end";
  if (lastEvent.type === "break") return "resume";
  return "break";
}

function actionCopy(type: EventType) {
  return {
    start: { label: "Commencer ma journée", hint: "Enregistrer mon arrivée", Icon: LogIn },
    break: { label: "Prendre une pause", hint: "Suspendre le temps travaillé", Icon: Coffee },
    resume: { label: "Reprendre le travail", hint: "Terminer ma pause", Icon: RotateCcw },
    end: { label: "Terminer ma journée", hint: "Enregistrer mon départ", Icon: LogOut },
  }[type];
}

function requiredLocationAccuracy(radius: number) {
  return Math.max(50, Math.min(radius, 150));
}

export function PersonalClockingWorkspace({
  profileId,
  organisationId,
  organisationName,
  fullname,
  identifier,
  canRemote,
  timeZone,
  mode = "agent",
  showReports = true,
  showClocking = true,
  activityHref,
}: {
  profileId: string;
  organisationId: string;
  organisationName: string;
  fullname: string;
  identifier: string;
  canRemote: boolean;
  timeZone: string;
  mode?: "agent" | "manager";
  showReports?: boolean;
  showClocking?: boolean;
  activityHref?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<ClockingEvent[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<EventType | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const [clockingZone, setClockingZone] = useState<ClockingZone | null>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success" | "pending"; message: string } | null>(null);
  const [requestIntent, setRequestIntent] = useState<EventRequestIntent | null>(null);
  const [workPolicyDefinition, setWorkPolicyDefinition] = useState<WorkPolicyDefinition | null>(null);
  const actionGuardRef = useRef(false);
  const cooldownTimerRef = useRef<number | null>(null);
  const currentDayKey = dateKey(now, timeZone);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) window.clearTimeout(cooldownTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      const [eventsResult, configResult, workPolicyResult] = await Promise.all([
        supabase
          .schema("zecontrol")
          .from("events")
          .select("id, type, event_status, pointed_at, lat, long")
          .eq("profile_id", profileId)
          .order("pointed_at", { ascending: false })
          .limit(180),
        supabase
          .schema("zecontrol")
          .from("orga_configs")
          .select("lat, long, radius")
          .eq("id", organisationId)
          .single(),
        supabase
          .schema("zecontrol")
          .rpc("resolve_work_policy", {
            target_profile_id: profileId,
            target_work_date: currentDayKey,
          }),
      ]);
      if (!active) return;
      if (eventsResult.error || configResult.error) {
        setFeedback({ type: "error", message: "Votre espace de pointage n’est pas encore disponible." });
      } else {
        setEvents((eventsResult.data ?? []) as ClockingEvent[]);
        const configuredZone =
          configResult.data.lat != null &&
          configResult.data.long != null &&
          configResult.data.radius != null
            ? {
                lat: Number(configResult.data.lat),
                long: Number(configResult.data.long),
                radius: Number(configResult.data.radius),
              }
            : null;
        setClockingZone(configuredZone);
        setLocationReady(
          canRemote ||
          configuredZone !== null,
        );
        const resolved = workPolicyResult.data as { definition?: unknown } | null;
        setWorkPolicyDefinition(
          isWorkPolicyDefinition(resolved?.definition)
            ? { ...resolved.definition, daySchedules: resolved.definition.daySchedules ?? {} }
            : null,
        );
      }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [canRemote, currentDayKey, organisationId, profileId, supabase, timeZone]);

  const today = currentDayKey;
  const selectedDay = today;
  const todayEvents = events.filter((event) => dateKey(new Date(event.pointed_at), timeZone) === today);
  const todayValidEvents = todayEvents
    .filter((event) => event.event_status === "accepted" || event.event_status === "pending")
    .sort((a, b) => new Date(a.pointed_at).getTime() - new Date(b.pointed_at).getTime());
  const lastTodayEvent = todayValidEvents.at(-1);
  const currentAction = nextEvent(lastTodayEvent);
  const isWorking = lastTodayEvent?.type === "start" || lastTodayEvent?.type === "resume";
  const isPaused = lastTodayEvent?.type === "break";
  const isCompletedToday = lastTodayEvent?.type === "end";
  const currentCopy = isCompletedToday
    ? { label: "Journée terminée", hint: "Votre départ est enregistré", Icon: Check }
    : actionCopy(currentAction);
  const CurrentIcon = currentCopy.Icon;
  const cancellationSeconds = lastTodayEvent
    ? Math.max(0, 30 - Math.floor((now.getTime() - new Date(lastTodayEvent.pointed_at).getTime()) / 1000))
    : 0;
  const canCancelLastEvent = Boolean(lastTodayEvent && cancellationSeconds > 0);
  const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - now.getTime()) / 1000));
  const isPointingLocked = Boolean(submitting) || cooldownSeconds > 0;
  const todayMinutes = minutesForEvents(todayEvents, now, timeZone);
  const workPolicyMessage = workPolicyDefinition
    ? currentWorkPolicyMessage({
        definition: workPolicyDefinition,
        events: todayEvents,
        now,
        timeZone,
      })
    : null;
  const breakProgress = workPolicyDefinition
    ? currentBreakProgress({
        definition: workPolicyDefinition,
        events: todayEvents,
        now,
        timeZone,
      })
    : null;
  const editableEvents = events
    .filter((event) => event.event_status === "accepted" || event.event_status === "pending")
    .map(({ id, type, pointed_at }) => ({ id, type, pointed_at }));
  const selectedDayEvents = events
    .filter((event) => dateKey(new Date(event.pointed_at), timeZone) === selectedDay && (event.event_status === "accepted" || event.event_status === "pending"))
    .sort((a, b) => new Date(a.pointed_at).getTime() - new Date(b.pointed_at).getTime());
  const selectedDayMinutes = minutesForEvents(selectedDayEvents, now, timeZone);
  const agentState = isWorking ? "working" : isPaused ? "paused" : isCompletedToday ? "completed" : "ready";
  const agentStateCopy = {
    working: { eyebrow: "Journée en cours", title: "Vous êtes au travail", description: "Votre temps avance. Prenez une pause quand vous en avez besoin.", Icon: ShieldCheck },
    paused: { eyebrow: "Pause en cours", title: "Profitez de votre pause", description: "Reprenez simplement lorsque vous êtes prêt.", Icon: Coffee },
    completed: { eyebrow: "Journée terminée", title: "Belle journée accomplie", description: "Votre activité du jour est enregistrée.", Icon: Check },
    ready: { eyebrow: "Prêt à commencer", title: "Une pression, et c’est parti", description: "Commencez votre journée quand vous êtes prêt.", Icon: LogIn },
  }[agentState];
  const AgentStateIcon = agentStateCopy.Icon;
  const currentMonth = today.slice(0, 7);
  const monthEvents = events.filter((event) => dateKey(new Date(event.pointed_at), timeZone).startsWith(currentMonth));
  const activeDays = new Set(monthEvents.filter((event) => event.type === "start" && event.event_status !== "rejected" && event.event_status !== "cancelled").map((event) => dateKey(new Date(event.pointed_at), timeZone))).size;
  const completedDays = new Set(monthEvents.filter((event) => event.type === "end" && event.event_status !== "rejected" && event.event_status !== "cancelled").map((event) => dateKey(new Date(event.pointed_at), timeZone))).size;
  const anomalies = monthEvents.filter((event) => event.event_status === "pending" || event.event_status === "rejected").length;
  const dailyReports = Array.from(new Set(events.map((event) => dateKey(new Date(event.pointed_at), timeZone))))
    .slice(0, 7)
    .map((date) => {
      const dayEvents = events.filter((event) => dateKey(new Date(event.pointed_at), timeZone) === date);
      return {
        date,
        events: dayEvents,
        minutes: minutesForEvents(dayEvents, now, timeZone),
        issue: dayEvents.some((event) => event.event_status === "pending" || event.event_status === "rejected"),
      };
    });

  async function locate() {
    if (!navigator.onLine) throw new Error("offline");
    if (!navigator.geolocation) throw new Error("geolocation");

    const accuracyTarget =
      !canRemote && clockingZone
        ? requiredLocationAccuracy(clockingZone.radius)
        : Number.POSITIVE_INFINITY;

    return new Promise<GeolocationPosition>((resolve, reject) => {
      let bestPosition: GeolocationPosition | null = null;
      let watchId: number | null = null;
      let finished = false;

      const finish = (
        result:
          | { position: GeolocationPosition }
          | { error: Error },
      ) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeoutId);
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        if ("position" in result) resolve(result.position);
        else reject(result.error);
      };

      const timeoutId = window.setTimeout(() => {
        if (bestPosition && bestPosition.coords.accuracy <= accuracyTarget) {
          finish({ position: bestPosition });
          return;
        }
        finish({
          error: new Error(bestPosition ? "location_inaccurate" : "location_timeout"),
        });
      }, 18_000);

      watchId = navigator.geolocation.watchPosition((position) => {
        if (
          !bestPosition ||
          position.coords.accuracy < bestPosition.coords.accuracy
        ) {
          bestPosition = position;
        }
        if (position.coords.accuracy <= accuracyTarget) {
          finish({ position });
        }
      }, (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          finish({ error: new Error("location_permission_denied") });
        }
      }, {
        enableHighAccuracy: true,
        timeout: 18_000,
        maximumAge: 0,
      });
    });
  }

  async function createEvent(type: EventType) {
    if (actionGuardRef.current || submitting || !locationReady) return;
    actionGuardRef.current = true;
    setSubmitting(type);
    setFeedback(null);
    let eventCreated = false;
    try {
      const position = await locate();
      const { data, error } = await supabase
        .schema("zecontrol")
        .from("events")
        .insert({
          type,
          lat: position.coords.latitude,
          long: position.coords.longitude,
          device: {
            accuracy: Math.round(position.coords.accuracy),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            language: navigator.language,
            user_agent: navigator.userAgent.slice(0, 300),
          },
        })
        .select("id, type, event_status, pointed_at, lat, long")
        .single();
      if (error || !data) throw error ?? new Error("insert_failed");
      const created = data as ClockingEvent;
      eventCreated = true;
      setEvents((current) => [created, ...current]);
      const nextCooldownUntil = new Date().getTime() + POINTING_CLICK_COOLDOWN_MS;
      setCooldownUntil(nextCooldownUntil);
      if (cooldownTimerRef.current) window.clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = window.setTimeout(() => {
        actionGuardRef.current = false;
        setCooldownUntil(0);
        cooldownTimerRef.current = null;
      }, POINTING_CLICK_COOLDOWN_MS);
      setFeedback(created.event_status === "accepted"
        ? { type: "success", message: `${typeLabels[created.type]} enregistré à ${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(created.pointed_at))}.` }
        : created.event_status === "pending"
          ? { type: "pending", message: "Pointage enregistré et transmis à un administrateur pour vérification." }
          : { type: "error", message: "Pointage refusé : votre position ne correspond pas à la zone autorisée." });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "";
      const databaseNotReady = /reviewed_by|pointed_at|profile_id|organisation_id|row-level security|policy/i.test(message);
      const mobileDevice = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
      setFeedback({
        type: "error",
        message: /billing_access_suspended/i.test(message)
          ? "La facturation de l’organisation doit être régularisée avant un nouveau pointage. Contactez votre responsable."
          : databaseNotReady
          ? "Le service de pointage est momentanément indisponible. Contactez votre administrateur."
          : message === "offline"
          ? "Une connexion internet est requise pour pointer."
          : message === "location_permission_denied"
          ? "Autorisez ZeControl à utiliser votre position, puis réessayez."
          : message === "location_inaccurate"
            || /clocking_location_accuracy_(required|too_low)/i.test(message)
          ? mobileDevice
            ? "Votre position est trop imprécise. Activez la localisation précise, puis réessayez."
            : "Cet ordinateur ne fournit pas une position assez précise. Activez la localisation précise ou pointez depuis votre téléphone."
          : message === "location_timeout" || message === "geolocation"
          ? "Votre position n’a pas pu être obtenue. Vérifiez la localisation de l’appareil, puis réessayez."
          : /clocking_location_required/i.test(message)
          ? "La position de l’appareil est nécessaire pour pointer."
          : message.toLowerCase().includes("sequence")
            ? "Cette action ne correspond pas à l’état actuel de votre journée. Actualisez puis réessayez."
            : "Le pointage n’a pas abouti. Vérifiez la localisation et réessayez.",
      });
    } finally {
      setSubmitting(null);
      if (!eventCreated) actionGuardRef.current = false;
    }
  }

  async function cancelLastEvent() {
    if (!lastTodayEvent || !canCancelLastEvent || cancelling || submitting) return;
    setCancelling(true);
    setFeedback(null);
    try {
      const { error } = await supabase
        .schema("zecontrol")
        .rpc("cancel_own_clocking_event", { target_event_id: lastTodayEvent.id });
      if (error) throw error;
      setEvents((current) => current.map((event) => event.id === lastTodayEvent.id ? { ...event, event_status: "cancelled" } : event));
      if (cooldownTimerRef.current) window.clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
      actionGuardRef.current = false;
      setCooldownUntil(0);
      setFeedback({ type: "success", message: `${typeLabels[lastTodayEvent.type]} annulé.` });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "";
      setFeedback({
        type: "error",
        message: /window_expired/i.test(message)
          ? "Le délai d’annulation est terminé."
          : "Cette action ne peut plus être annulée.",
      });
    } finally {
      setCancelling(false);
    }
  }

  if (loading) return <div className="clocking-loading"><LoaderCircle className="spin" size={23} /> Préparation de votre espace...</div>;

  return (
    <div className={`personal-clocking personal-clocking-${mode} ${showReports ? "personal-clocking-with-reports" : "personal-clocking-clock-only"}`}>
      {showClocking && <section className={`agent-clocking-experience ${mode === "manager" ? "manager-mobile-clocking" : ""}`}>
        <header className="agent-welcome">
          <div><span>{organisationName}</span><h1>Bonjour {fullname.split(" ")[0]}</h1><p>{new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone }).format(now)}</p></div>
          <time dateTime={now.toISOString()}>{new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }).format(now)}</time>
        </header>

        <div className={`agent-command-card state-${agentState} action-${currentAction}`}>
          <div className="agent-command-glow" aria-hidden="true"><i /><i /><i /></div>
          {workPolicyMessage && !breakProgress && <div className={`agent-policy-message ${workPolicyMessage.tone}`} role="status"><span>{workPolicyMessage.tone === "success" ? <Check size={17} /> : <BellRing size={17} />}</span><div><strong>{workPolicyMessage.title}</strong><small>{workPolicyMessage.message}</small></div></div>}
          {breakProgress && <BreakCountdown progress={breakProgress} />}
          <div className="agent-mobile-clock-face">
            <div className="agent-mobile-brand"><ZeControlLogo className="agent-mobile-logo" /></div>
            <span>{new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone }).format(now)}</span>
            <time dateTime={now.toISOString()}>{new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }).format(now)}</time>
            <small className={locationReady ? "is-ready" : "is-missing"}><UserRound size={17} /> {identifier}</small>
          </div>
          <div className="agent-command-copy">
            <span className="agent-state-pill"><AgentStateIcon size={15} /> {agentStateCopy.eyebrow}</span>
            <h2>{agentStateCopy.title}</h2>
            <p>{agentStateCopy.description}</p>
            <div className="agent-today-duration"><small>Temps aujourd’hui</small><strong>{durationLabel(todayMinutes)}</strong><span>{todayValidEvents.length ? `${todayValidEvents.length} moment${todayValidEvents.length > 1 ? "s" : ""} enregistré${todayValidEvents.length > 1 ? "s" : ""}` : "Votre journée vous attend"}</span></div>
          </div>

          <div className="agent-command-action">
            <div className="agent-action-orbit">
              <i aria-hidden="true" />
              <button className="agent-action-button" type="button" onClick={() => void createEvent(currentAction)} disabled={isCompletedToday || isPointingLocked || !locationReady}>
                <span>{submitting === currentAction ? <LoaderCircle className="spin" size={34} /> : cooldownSeconds > 0 ? <Check size={34} /> : <CurrentIcon size={34} />}</span>
                <strong>{submitting === currentAction ? "Un instant..." : cooldownSeconds > 0 ? "Pointage enregistré" : currentCopy.label}</strong>
                <small>{cooldownSeconds > 0 ? `Disponible dans ${cooldownSeconds} s` : currentCopy.hint}</small>
              </button>
            </div>
            {(isWorking || isPaused) && <button className="agent-finish-button" type="button" onClick={() => void createEvent("end")} disabled={isPointingLocked}><LogOut size={16} /> Terminer ma journée</button>}
          </div>

          <div className="agent-trust-note"><ShieldCheck size={16} /><span>Heure et localisation contrôlées</span></div>
          {!locationReady && <div className="agent-location-prerequisite" role="status"><LocateFixed size={19} /><span><strong>Le pointage n’est pas encore disponible</strong><small>La zone de travail doit être configurée par un administrateur.</small></span></div>}
          {canCancelLastEvent && <button className="agent-undo-action" type="button" onClick={() => void cancelLastEvent()} disabled={cancelling || Boolean(submitting)}>
            <span className="agent-undo-countdown" style={{ "--undo-progress": `${(cancellationSeconds / 30) * 360}deg` } as React.CSSProperties}><i>{cancellationSeconds}</i></span>
            <span><strong>{cancelling ? "Annulation..." : `Annuler ${typeLabels[lastTodayEvent!.type].toLowerCase()}`}</strong><small>Vous pouvez revenir sur votre dernière action</small></span>
            <Undo2 size={18} />
          </button>}
          {feedback && <div className={`agent-feedback ${feedback.type}`} role={feedback.type === "error" ? "alert" : "status"}>{feedback.type === "success" ? <Check size={18} /> : <AlertTriangle size={18} />}<span>{feedback.message}</span></div>}
        </div>

        <section className="agent-day-atlas" aria-labelledby="agent-day-title">
          <header>
            <div><span>Votre rythme</span><h2 id="agent-day-title">Aujourd’hui</h2></div>
          </header>
          <div className="agent-day-orbit-layout">
            <div className={`agent-journey-orbit ${selectedDayEvents.length ? "has-events" : "is-empty"}`}>
              <svg viewBox="0 0 300 300" aria-hidden="true"><circle className="journey-orbit-base" cx="150" cy="150" r="112" /><circle className="journey-orbit-progress" cx="150" cy="150" r="112" /><path className="journey-orbit-wave" d="M52 172c37-58 62 53 99-4s65 53 100-11" /></svg>
              <div className="journey-orbit-center"><small>{new Intl.DateTimeFormat("fr-FR", { weekday: "long" }).format(new Date(`${selectedDay}T12:00:00`))}</small><strong>{durationLabel(selectedDayMinutes)}</strong><span>{selectedDayEvents.length ? `${selectedDayEvents.length} pointage${selectedDayEvents.length > 1 ? "s" : ""}` : "Journée vide"}</span></div>
              {selectedDayEvents.map((event, index) => {
                const EventIcon = actionCopy(event.type).Icon;
                const angle = selectedDayEvents.length === 1 ? -90 : -135 + (270 / Math.max(1, selectedDayEvents.length - 1)) * index;
                const radians = angle * Math.PI / 180;
                const x = 50 + Math.cos(radians) * 39;
                const y = 50 + Math.sin(radians) * 39;
                return <button className={`journey-orbit-point point-${event.type}`} style={{ "--point-x": `${x}%`, "--point-y": `${y}%`, "--point-index": index } as React.CSSProperties} type="button" aria-label={`Modifier ${typeLabels[event.type]} à ${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(event.pointed_at))}`} onClick={() => setRequestIntent({ key: event.id, kind: "correction", eventId: event.id })} key={event.id}><EventIcon size={17} /><span>{new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(event.pointed_at))}</span></button>;
              })}
            </div>
            <div className="agent-day-details">
              <div className="agent-day-details-heading"><div><small>Aujourd’hui</small><strong>{selectedDayEvents.length ? "Les moments de la journée" : "Aucun pointage"}</strong></div><span>{durationLabel(selectedDayMinutes)}</span></div>
              {selectedDayEvents.length ? <div className="agent-day-event-buttons">{selectedDayEvents.map((event) => { const EventIcon = actionCopy(event.type).Icon; return <button className={`day-event-button event-${event.type}`} type="button" onClick={() => setRequestIntent({ key: event.id, kind: "correction", eventId: event.id })} key={event.id}><span><EventIcon size={16} /></span><div><small>{typeLabels[event.type]}</small><strong>{new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(event.pointed_at))}</strong></div><PenLine size={15} /></button>; })}</div> : <div className="agent-selected-day-empty"><CalendarDays size={23} /><strong>Rien n’est enregistré</strong><p>Ajoutez un pointage oublié si vous avez travaillé ce jour-là.</p></div>}
              <button className="agent-add-past-event" type="button" onClick={() => setRequestIntent({ key: `missing-${selectedDay}`, kind: "missing_event", requestedAt: new Date(now.getTime() - 5 * 60_000).toISOString() })}><Plus size={16} /> Ajouter un oubli aujourd’hui</button>
            </div>
          </div>
          {selectedDay === today && (isWorking || isPaused) && <div className={`agent-live-strip ${isPaused ? "paused" : "working"}`}><span><i /> {isPaused ? "Pause en cours" : "Temps en cours"}</span><strong>{durationLabel(todayMinutes)}</strong></div>}
        </section>
        <EventRequestPanel key={requestIntent?.key ?? "agent-request-dialog"} profileId={profileId} events={editableEvents} timeZone={timeZone} initialIntent={requestIntent} onClose={() => setRequestIntent(null)} showLauncher={false} />
        {activityHref && <Link className="agent-activity-link agent-activity-link-bottom" href={activityHref}><CalendarDays size={18} /><span><strong>Voir mon activité</strong><small>Historique, repères et exports</small></span><ArrowRight size={16} /></Link>}
      </section>}

      {showClocking && mode === "manager" && <section className="clocking-hero">
        <header className="clocking-heading">
          <div><span>{organisationName}</span><h1>Mon pointage</h1><p>{new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(now)}</p></div>
          <div className="clocking-live-time"><strong>{new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }).format(now)}</strong><span><i /> {timeZone.replace("_", " ")}</span></div>
        </header>

          <div className="clocking-action-card">
          <div className="clocking-state">
            <span className={isWorking ? "working" : isPaused ? "paused" : isCompletedToday ? "completed" : "resting"}>{isWorking ? <><ShieldCheck size={16} /> Journée en cours</> : isPaused ? <><CirclePause size={16} /> En pause</> : isCompletedToday ? <><Check size={16} /> Journée terminée</> : <><Check size={16} /> Prêt à pointer</>}</span>
            <p>{lastTodayEvent ? `Dernière action : ${typeLabels[lastTodayEvent.type]} à ${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(lastTodayEvent.pointed_at))}` : "Votre journée commencera avec votre arrivée."}</p>
          </div>
          <button className={`clocking-main-action action-${currentAction}`} type="button" onClick={() => void createEvent(currentAction)} disabled={isCompletedToday || isPointingLocked || !locationReady}>
            <span>{submitting === currentAction ? <LoaderCircle className="spin" size={35} /> : cooldownSeconds > 0 ? <Check size={35} /> : <CurrentIcon size={35} />}</span>
            <strong>{submitting === currentAction ? "Pointage en cours..." : cooldownSeconds > 0 ? "Pointage enregistré" : currentCopy.label}</strong>
            <small>{cooldownSeconds > 0 ? `Disponible dans ${cooldownSeconds} s` : currentCopy.hint}</small>
          </button>
          {(isWorking || isPaused) && <button className="clocking-end-action" type="button" onClick={() => void createEvent("end")} disabled={isPointingLocked}><LogOut size={17} /> Terminer ma journée <ArrowRight size={15} /></button>}
          <div className="clocking-assurance"><span className={locationReady ? "ready" : "missing"}><LocateFixed size={16} /> {locationReady ? "Localisation prête" : "Zone non configurée"}</span><span><Clock3 size={16} /> Heure fiable</span></div>
          {workPolicyMessage && !breakProgress && <div className={`manager-policy-message ${workPolicyMessage.tone}`} role="status"><BellRing size={16} /><span><strong>{workPolicyMessage.title}</strong><small>{workPolicyMessage.message}</small></span></div>}
          {breakProgress && <BreakCountdown progress={breakProgress} />}
          {canCancelLastEvent && <button className="clocking-undo-action" type="button" onClick={() => void cancelLastEvent()} disabled={cancelling || Boolean(submitting)}><Undo2 size={16} /> {cancelling ? "Annulation..." : `Annuler (${cancellationSeconds}s)`}</button>}
          {feedback && <div className={`clocking-feedback ${feedback.type}`} role={feedback.type === "error" ? "alert" : "status"}>{feedback.type === "success" ? <Check size={18} /> : <AlertTriangle size={18} />}<span>{feedback.message}</span></div>}
        </div>
      </section>}
      {showClocking && mode === "manager" && <EventRequestPanel profileId={profileId} events={editableEvents} timeZone={timeZone} />}

      {showReports && <section className="personal-reporting" aria-labelledby="personal-reports-title">
        <div className="personal-section-heading"><div><span>Mon activité</span><h2 id="personal-reports-title">Mes repères en un coup d’œil</h2></div><CalendarDays size={22} /></div>
        <div className="personal-kpis"><article><TimerReset size={20} /><span><small>Aujourd’hui</small><strong>{durationLabel(todayMinutes)}</strong></span></article><article><CalendarDays size={20} /><span><small>Jours pointés ce mois</small><strong>{activeDays}</strong></span></article><article><Check size={20} /><span><small>Journées terminées</small><strong>{completedDays}</strong></span></article><article className={anomalies ? "has-alert" : ""}><AlertTriangle size={20} /><span><small>À vérifier</small><strong>{anomalies}</strong></span></article></div>
        <div className="personal-history-card"><div className="personal-history-heading"><h3>Mes derniers rapports</h3><p>Temps calculé à partir des événements validés ou en attente.</p></div>{dailyReports.length === 0 ? <div className="personal-history-empty"><Clock3 size={24} /><p>Votre historique apparaîtra après votre premier pointage.</p></div> : <div className="personal-history-list">{dailyReports.map((report) => <article key={report.date}><span className="history-date"><strong>{new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric" }).format(new Date(`${report.date}T12:00:00`))}</strong><small>{report.events.length} événement{report.events.length > 1 ? "s" : ""}</small></span><span className="history-duration">{durationLabel(report.minutes)}</span><span className={`history-status ${report.issue ? "issue" : "ok"}`}>{report.issue ? <AlertTriangle size={14} /> : <Check size={14} />}{report.issue ? "À vérifier" : report.events.some((event) => event.type === "end") ? "Terminée" : "En cours"}</span></article>)}</div>}</div>
      </section>}
    </div>
  );
}
