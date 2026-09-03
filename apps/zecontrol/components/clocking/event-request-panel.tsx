"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  Check,
  Clock3,
  Coffee,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  PenLine,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import {
  clockingDayState,
  isClockingCorrectionValid,
  isCompleteBreakInsertionValid,
  missingClockingOptions,
  pendingClockingRequestEvents,
  validMissingEventTypes,
  type ClockingEventType,
  type MissingClockingOption,
} from "@/lib/clocking-sequence";
import {
  dateKey,
  zonedDateTime,
  zonedDayBoundary,
} from "@/lib/reports/period";
import { createClient } from "@/lib/supabase/client";

type EventType = ClockingEventType;

export type EditableClockingEvent = {
  id: string;
  type: EventType;
  pointed_at: string;
  provisional?: boolean;
};

export type EventRequestIntent = {
  key: string;
  kind: "correction" | "missing_event";
  eventId?: string;
  requestedAt?: string;
};

export type EventRequestSubmission = {
  kind: "correction" | "missing_event" | "missing_break";
  type: EventType;
  pointedAt: string;
};

const eventLabels: Record<EventType, string> = {
  start: "Arrivée",
  break: "Début de pause",
  resume: "Reprise",
  end: "Départ",
};

const eventMeta = {
  start: { Icon: LogIn },
  break: { Icon: Coffee },
  resume: { Icon: RotateCcw },
  end: { Icon: LogOut },
} satisfies Record<EventType, { Icon: typeof LogIn }>;

const dayStateCopy = {
  empty: {
    title: "Aucun pointage",
    text: "Commencez par ajouter l’arrivée oubliée.",
  },
  working: {
    title: "Journée ouverte",
    text: "ZeControl propose uniquement la suite logique.",
  },
  paused: {
    title: "Pause ouverte",
    text: "Ajoutez une reprise ou terminez la journée.",
  },
  closed: {
    title: "Journée terminée",
    text: "Vous pouvez encore insérer une pause complète entre les pointages.",
  },
};

function zonedInputValue(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return {
    day: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

function nextDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

function eventTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function eventDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function optionIcon(option: MissingClockingOption) {
  return option.kind === "complete_break"
    ? Coffee
    : eventMeta[option.type].Icon;
}

export function EventRequestPanel({
  profileId,
  events,
  timeZone,
  initialIntent,
  onClose,
  onSubmitted,
  showLauncher = true,
}: {
  profileId: string;
  events: EditableClockingEvent[];
  timeZone: string;
  initialIntent?: EventRequestIntent | null;
  onClose?: () => void;
  onSubmitted?: (submission: EventRequestSubmission) => void;
  showLauncher?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const correctionMode = initialIntent?.kind === "correction";
  const selectedEvent = correctionMode
    ? events.find((event) => event.id === initialIntent.eventId)
    : undefined;
  const [initialZonedMoment] = useState(() => {
    const initialMoment = selectedEvent
      ? new Date(selectedEvent.pointed_at)
      : initialIntent?.requestedAt
        ? new Date(initialIntent.requestedAt)
        : new Date(Date.now() - 5 * 60_000);
    return zonedInputValue(initialMoment, timeZone);
  });
  const [open, setOpen] = useState(Boolean(initialIntent));
  const [selectedDay, setSelectedDay] = useState(initialZonedMoment.day);
  const [requestedTime, setRequestedTime] = useState(initialZonedMoment.time);
  const [pauseStart, setPauseStart] = useState(initialZonedMoment.time);
  const [pauseEnd, setPauseEnd] = useState(initialZonedMoment.time);
  const [dayEvents, setDayEvents] = useState<EditableClockingEvent[]>([]);
  const [loadingDay, setLoadingDay] = useState(!correctionMode);
  const [dayLoadFailed, setDayLoadFailed] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    async function loadCount() {
      const { count } = await supabase
        .schema("zecontrol")
        .from("event_change_requests")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profileId)
        .eq("status", "pending");
      if (active) setPendingCount(count ?? 0);
    }
    void loadCount();
    return () => {
      active = false;
    };
  }, [profileId, supabase]);

  useEffect(() => {
    if (correctionMode || !open) return;
    let active = true;
    async function loadDay() {
      setLoadingDay(true);
      setDayLoadFailed(false);
      setMessage(null);
      const rangeStart = zonedDayBoundary(selectedDay, timeZone).toISOString();
      const rangeEnd = zonedDayBoundary(nextDay(selectedDay), timeZone).toISOString();
      const [eventsResult, requestsResult] = await Promise.all([
        supabase
          .schema("zecontrol")
          .from("events")
          .select("id, type, pointed_at")
          .eq("profile_id", profileId)
          .in("event_status", ["accepted", "pending"])
          .gte("pointed_at", rangeStart)
          .lt("pointed_at", rangeEnd)
          .order("pointed_at", { ascending: true }),
        supabase
          .schema("zecontrol")
          .from("event_change_requests")
          .select("id, request_kind, requested_type, requested_pointed_at, requested_end_at")
          .eq("profile_id", profileId)
          .eq("status", "pending")
          .in("request_kind", ["missing_event", "missing_break"])
          .gte("requested_pointed_at", rangeStart)
          .lt("requested_pointed_at", rangeEnd)
          .order("requested_pointed_at", { ascending: true }),
      ]);
      if (!active) return;
      const error = eventsResult.error ?? requestsResult.error;
      const nextEvents = error
        ? []
        : [
            ...((eventsResult.data ?? []) as EditableClockingEvent[]),
            ...pendingClockingRequestEvents(
              (requestsResult.data ?? []) as Parameters<typeof pendingClockingRequestEvents>[0],
            ),
          ].sort(
            (left, right) =>
              new Date(left.pointed_at).getTime() - new Date(right.pointed_at).getTime() ||
              left.id.localeCompare(right.id),
          );
      setDayEvents(nextEvents);
      setDayLoadFailed(Boolean(error));
      if (error) {
        setMessage({
          type: "error",
          text: "Cette journée n’a pas pu être chargée. Réessayez.",
        });
      } else {
        const nextOption = missingClockingOptions(nextEvents)[0];
        setSelectedOptionId(nextOption?.id ?? "");
        if (nextOption?.kind === "complete_break") {
          setPauseStart(
            zonedInputValue(
              new Date(nextOption.suggestedStart),
              timeZone,
            ).time,
          );
          setPauseEnd(
            zonedInputValue(
              new Date(nextOption.suggestedEnd),
              timeZone,
            ).time,
          );
        } else {
          const lastEvent = nextEvents.at(-1);
          const now = new Date(Date.now() - 5 * 60_000);
          const defaultDate =
            selectedDay === dateKey(now, timeZone)
              ? now
              : lastEvent
                ? new Date(
                    new Date(lastEvent.pointed_at).getTime() + 5 * 60_000,
                  )
                : zonedDateTime(`${selectedDay}T08:00`, timeZone);
          setRequestedTime(
            zonedInputValue(defaultDate, timeZone).time,
          );
        }
      }
      setLoadingDay(false);
    }
    void loadDay();
    return () => {
      active = false;
    };
  }, [correctionMode, open, profileId, selectedDay, supabase, timeZone]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        onClose?.();
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  const dayState = clockingDayState(dayEvents);
  const options = useMemo(
    () => (dayLoadFailed ? [] : missingClockingOptions(dayEvents)),
    [dayEvents, dayLoadFailed],
  );
  const selectedOption =
    options.find((option) => option.id === selectedOptionId) ?? options[0];

  const requestedDate = useMemo(
    () => zonedDateTime(`${selectedDay}T${requestedTime}`, timeZone),
    [requestedTime, selectedDay, timeZone],
  );
  const pauseStartDate = useMemo(
    () => zonedDateTime(`${selectedDay}T${pauseStart}`, timeZone),
    [pauseStart, selectedDay, timeZone],
  );
  const pauseEndDate = useMemo(
    () => zonedDateTime(`${selectedDay}T${pauseEnd}`, timeZone),
    [pauseEnd, selectedDay, timeZone],
  );
  const correctionDate = useMemo(
    () => zonedDateTime(`${selectedDay}T${requestedTime}`, timeZone),
    [requestedTime, selectedDay, timeZone],
  );
  const correctionIsValid = Boolean(
    selectedEvent &&
      isClockingCorrectionValid(
        events,
        selectedEvent.id,
        correctionDate,
        timeZone,
      ),
  );
  const missingIsValid =
    selectedOption?.kind === "single"
      ? validMissingEventTypes(dayEvents, requestedDate, timeZone).includes(
          selectedOption.type,
        )
      : selectedOption?.kind === "complete_break"
        ? isCompleteBreakInsertionValid(
            dayEvents,
            pauseStartDate,
            pauseEndDate,
            timeZone,
          )
        : false;
  const sequenceIsValid = correctionMode
    ? correctionIsValid
    : missingIsValid;
  const SelectedEventIcon = selectedEvent
    ? eventMeta[selectedEvent.type].Icon
    : Clock3;

  function closeDialog() {
    setOpen(false);
    onClose?.();
  }

  function chooseOption(option: MissingClockingOption) {
    setSelectedOptionId(option.id);
    setMessage(null);
    if (option.kind === "complete_break") {
      setPauseStart(
        zonedInputValue(new Date(option.suggestedStart), timeZone).time,
      );
      setPauseEnd(
        zonedInputValue(new Date(option.suggestedEnd), timeZone).time,
      );
    }
  }

  async function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !sequenceIsValid) return;
    setPending(true);
    setMessage(null);

    const payload: {
      request_kind: "correction" | "missing_event" | "missing_break";
      event_id: string | null;
      requested_type: EventType;
      requested_pointed_at: string;
      requested_end_at: string | null;
      reason: string | null;
    } | null = correctionMode && selectedEvent
      ? {
          request_kind: "correction",
          event_id: selectedEvent.id,
          requested_type: selectedEvent.type,
          requested_pointed_at: correctionDate.toISOString(),
          requested_end_at: null,
          reason: reason.trim() || null,
        }
      : selectedOption?.kind === "complete_break"
        ? {
            request_kind: "missing_break",
            event_id: null,
            requested_type: "break",
            requested_pointed_at: pauseStartDate.toISOString(),
            requested_end_at: pauseEndDate.toISOString(),
            reason: reason.trim() || null,
          }
        : selectedOption?.kind === "single"
          ? {
              request_kind: "missing_event",
              event_id: null,
              requested_type: selectedOption.type,
              requested_pointed_at: requestedDate.toISOString(),
              requested_end_at: null,
              reason: reason.trim() || null,
            }
          : null;

    if (!payload) {
      setPending(false);
      return;
    }

    const { data: createdRequest, error } = await supabase
      .schema("zecontrol")
      .from("event_change_requests")
      .insert(payload)
      .select("id, request_kind, requested_type, requested_pointed_at, requested_end_at")
      .single();

    if (error) {
      setMessage({
        type: "error",
        text: /future_time/i.test(error.message)
          ? "L’heure choisie doit être dans le passé."
          : /type_change_not_allowed/i.test(error.message)
            ? "Le type d’un pointage existant ne peut pas être modifié."
            : /invalid_sequence|invalid_break/i.test(error.message)
              ? "Ces heures ne correspondent pas à la chronologie de cette journée."
              : /one_pending|duplicate/i.test(error.message)
                ? "Une demande est déjà en attente pour ce pointage."
                : "La demande n’a pas pu être envoyée. Réessayez.",
      });
    } else {
      setPendingCount((count) => count + 1);
      setReason("");
      if (!correctionMode && createdRequest) {
        const provisionalEvents = pendingClockingRequestEvents([
          createdRequest as Parameters<typeof pendingClockingRequestEvents>[0][number],
        ]);
        setDayEvents((current) =>
          [...current, ...provisionalEvents].sort(
            (left, right) =>
              new Date(left.pointed_at).getTime() - new Date(right.pointed_at).getTime() ||
              left.id.localeCompare(right.id),
          ),
        );
        const nextMoment = new Date(
          new Date(payload.requested_end_at ?? payload.requested_pointed_at).getTime() +
            5 * 60_000,
        );
        setRequestedTime(zonedInputValue(nextMoment, timeZone).time);
        setSelectedOptionId("");
      }
      setMessage({
        type: "success",
        text:
          selectedOption?.kind === "complete_break"
            ? "Pause envoyée. Vous pouvez ajouter une autre demande sans attendre."
            : "Demande envoyée. Vous pouvez en ajouter une autre sans attendre sa validation.",
      });
      setPending(false);
      onSubmitted?.({
        kind: payload.request_kind,
        type: payload.requested_type,
        pointedAt: payload.requested_pointed_at,
      });
      return;
    }
    setPending(false);
  }

  return (
    <>
      {showLauncher && (
        <button
          className="event-request-launcher"
          type="button"
          onClick={() => setOpen(true)}
        >
          <span className="request-launcher-visual" aria-hidden="true">
            <svg viewBox="0 0 120 80" role="presentation">
              <path className="request-svg-orbit" d="M19 42c7-24 35-37 60-27 24 9 31 35 18 52" />
              <circle className="request-svg-clock" cx="59" cy="40" r="22" />
              <path className="request-svg-hand request-svg-hour" d="M59 40V27" />
              <path className="request-svg-hand request-svg-minute" d="M59 40l12 7" />
              <circle cx="59" cy="40" r="3" />
              <path className="request-svg-spark" d="m94 15 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" />
            </svg>
          </span>
          <span>
            <small>Un pointage a été oublié ?</small>
            <strong>Ouvrir la journée concernée</strong>
            <em>ZeControl proposera uniquement les actions cohérentes.</em>
          </span>
          {pendingCount > 0 ? (
            <b>{pendingCount} en attente</b>
          ) : (
            <i><Plus size={18} /></i>
          )}
        </button>
      )}

      {open && (
        <div
          className="event-request-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            className="event-request-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-request-title"
          >
            <button
              className="event-request-close"
              type="button"
              aria-label="Fermer"
              onClick={closeDialog}
            >
              <X size={20} />
            </button>
            <header>
              <div className="request-dialog-symbol" aria-hidden="true">
                {correctionMode ? <PenLine size={24} /> : <CalendarClock size={24} />}
              </div>
              <div>
                <span><Sparkles size={14} /> Soumis à validation</span>
                <h2 id="event-request-title">
                  {correctionMode ? "Corriger ce point" : "Ajouter un oubli"}
                </h2>
                <p>
                  {correctionMode
                    ? "Seule l’heure de ce pointage sera corrigée. Son action restera identique."
                    : "Choisissez d’abord la journée. ZeControl lit sa chronologie avant de proposer une action."}
                </p>
              </div>
            </header>

            <form onSubmit={(event) => void submitRequest(event)}>
              {correctionMode && selectedEvent ? (
                <>
                  <div className="request-correction-flow event-correction">
                    <div className="request-original-event">
                      <span><SelectedEventIcon size={21} /></span>
                      <div>
                        <small>Point sélectionné</small>
                        <strong>{eventLabels[selectedEvent.type]}</strong>
                        <time>{eventDateTime(selectedEvent.pointed_at, timeZone)}</time>
                      </div>
                    </div>
                    <ArrowRight className="request-flow-arrow" size={22} />
                    <div className="request-day-time-fields">
                      <div className="request-fixed-day">
                        <span>Jour</span>
                        <strong>
                          {new Intl.DateTimeFormat("fr-FR", {
                            dateStyle: "medium",
                            timeZone,
                          }).format(new Date(selectedEvent.pointed_at))}
                        </strong>
                      </div>
                      <label>
                        <span>Heure</span>
                        <input
                          type="time"
                          value={requestedTime}
                          onChange={(event) => {
                            setRequestedTime(event.target.value);
                            setMessage(null);
                          }}
                          required
                        />
                      </label>
                    </div>
                  </div>
                  <div className="request-type-lock">
                    <LockKeyhole size={16} />
                    <span>
                      <strong>{eventLabels[selectedEvent.type]} restera {eventLabels[selectedEvent.type].toLowerCase()}</strong>
                      <small>Pour modifier un autre point, fermez cette fenêtre et cliquez directement dessus.</small>
                    </span>
                  </div>
                  {!correctionIsValid && (
                    <div className="request-sequence-note" role="status">
                      <Clock3 size={17} />
                      <span>
                        <strong>Cette heure ne convient pas</strong>
                        <small>Elle doit rester entre les actions voisines de la journée.</small>
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="request-step-title">
                    <b>1</b>
                    <span>
                      <strong>Quelle journée voulez-vous compléter ?</strong>
                      <small>Une journée à la fois, pour éviter toute ambiguïté.</small>
                    </span>
                  </div>
                  <label className="request-day-picker">
                    <CalendarClock size={19} />
                    <span>
                      <small>Journée concernée</small>
                      <input
                        type="date"
                        max={dateKey(new Date(), timeZone)}
                        value={selectedDay}
                        onChange={(event) => {
                          setSelectedDay(event.target.value);
                          setSelectedOptionId("");
                          setMessage(null);
                        }}
                        required
                      />
                    </span>
                  </label>

                  <div className="request-step-title">
                    <b>2</b>
                    <span>
                      <strong>Voici la journée enregistrée</strong>
                      <small>Pour corriger un point existant, ouvrez la journée puis cliquez sur ce point.</small>
                    </span>
                  </div>
                  <div className={`request-day-summary state-${dayState}`}>
                    <div className="request-day-state">
                      <span>{loadingDay ? <LoaderCircle className="spin" size={19} /> : <Clock3 size={19} />}</span>
                      <div>
                        <strong>{loadingDay ? "Lecture de la journée…" : dayStateCopy[dayState].title}</strong>
                        <small>{loadingDay ? "Vérification des pointages déjà enregistrés." : dayStateCopy[dayState].text}</small>
                      </div>
                    </div>
                    {!loadingDay && (
                      <div className="request-day-timeline">
                        {dayEvents.length === 0 ? (
                          <p>Aucun point enregistré</p>
                        ) : (
                          dayEvents.map((item) => {
                            const Icon = eventMeta[item.type].Icon;
                            return (
                              <div className={`event-${item.type} ${item.provisional ? "is-provisional" : ""}`} key={item.id}>
                                <span><Icon size={15} /></span>
                                <strong>{eventLabels[item.type]}</strong>
                                <time>{eventTime(item.pointed_at, timeZone)}{item.provisional ? " · En attente" : ""}</time>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>

                  {!loadingDay && options.length > 0 && (
                    <>
                      <div className="request-step-title">
                        <b>3</b>
                        <span>
                          <strong>Que faut-il ajouter ?</strong>
                          <small>Seules les actions valides pour cette journée sont proposées.</small>
                        </span>
                      </div>
                      <div className="request-action-cards">
                        {options.map((option) => {
                          const Icon = optionIcon(option);
                          return (
                            <button
                              className={`${option.kind === "complete_break" ? "event-complete-break" : `event-${option.type}`} ${selectedOption?.id === option.id ? "selected" : ""}`}
                              type="button"
                              onClick={() => chooseOption(option)}
                              key={option.id}
                            >
                              <span><Icon size={21} /></span>
                              <div>
                                <strong>{option.title}</strong>
                                <small>
                                  {option.kind === "complete_break"
                                    ? `${eventTime(option.intervalStart, timeZone)}–${eventTime(option.intervalEnd, timeZone)}`
                                    : option.hint}
                                </small>
                              </div>
                              <i>{selectedOption?.id === option.id ? <Check size={16} /> : <ArrowRight size={16} />}</i>
                            </button>
                          );
                        })}
                      </div>

                      {selectedOption?.kind === "complete_break" ? (
                        <div className="request-pause-time-fields">
                          <label>
                            <span>Début de pause</span>
                            <div><Coffee size={17} /><input type="time" value={pauseStart} onChange={(event) => { setPauseStart(event.target.value); setMessage(null); }} required /></div>
                          </label>
                          <ArrowRight size={18} />
                          <label>
                            <span>Reprise</span>
                            <div><RotateCcw size={17} /><input type="time" value={pauseEnd} onChange={(event) => { setPauseEnd(event.target.value); setMessage(null); }} required /></div>
                          </label>
                        </div>
                      ) : selectedOption?.kind === "single" ? (
                        <label className="request-single-time">
                          <span>Heure de {eventLabels[selectedOption.type].toLowerCase()}</span>
                          <div><Clock3 size={18} /><input type="time" value={requestedTime} onChange={(event) => { setRequestedTime(event.target.value); setMessage(null); }} required /></div>
                        </label>
                      ) : null}
                    </>
                  )}

                  {!loadingDay && options.length === 0 && !dayLoadFailed && (
                    <div className="request-sequence-note" role="status">
                      <LockKeyhole size={17} />
                      <span>
                        <strong>Aucun oubli compatible n’est disponible</strong>
                        <small>La journée ne contient pas d’intervalle dans lequel ajouter un pointage.</small>
                      </span>
                    </div>
                  )}
                  {!loadingDay && selectedOption && !missingIsValid && (
                    <div className="request-sequence-note" role="status">
                      <Clock3 size={17} />
                      <span>
                        <strong>Vérifiez les heures choisies</strong>
                        <small>Elles doivent rester dans l’intervalle proposé et respecter l’ordre de la journée.</small>
                      </span>
                    </div>
                  )}
                </>
              )}

              <label className="request-field request-field-wide">
                <span>Motif <em>facultatif</em></span>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Ex. Pause déjeuner oubliée…"
                />
                <small>{reason.length}/500</small>
              </label>

              {message && (
                <div className={`request-message ${message.type}`}>
                  {message.type === "success" ? <Check size={17} /> : <X size={17} />}
                  <span>{message.text}</span>
                </div>
              )}

              <footer>
                <p><Clock3 size={15} /> Plusieurs demandes peuvent être envoyées sans attendre leur validation.</p>
                <button type="submit" disabled={pending || loadingDay || !sequenceIsValid}>
                  {pending ? <LoaderCircle className="spin" size={18} /> : <Send size={17} />}
                  {pending
                    ? "Envoi..."
                    : correctionMode
                      ? "Demander la correction"
                      : selectedOption?.kind === "complete_break"
                        ? "Envoyer la pause"
                        : "Ajouter ce pointage"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
