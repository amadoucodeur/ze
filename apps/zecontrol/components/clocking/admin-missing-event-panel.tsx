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
  Plus,
  RotateCcw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import {
  clockingDayState,
  isCompleteBreakInsertionValid,
  missingClockingOptions,
  validMissingEventTypes,
  type ClockingEventType,
  type MissingClockingOption,
  type SequencedClockingEvent,
} from "@/lib/clocking-sequence";
import {
  dateKey,
  zonedDateTime,
  zonedDayBoundary,
} from "@/lib/reports/period";
import { createClient } from "@/lib/supabase/client";

type AdminClockingProfile = {
  id: string;
  fullname: string;
  identifiant: string;
  is_active: boolean;
};

const eventLabels: Record<ClockingEventType, string> = {
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
} satisfies Record<ClockingEventType, { Icon: typeof LogIn }>;

const dayStateCopy = {
  empty: {
    title: "Aucun pointage",
    text: "L’arrivée est la première action possible.",
  },
  working: {
    title: "Journée ouverte",
    text: "Ajoutez uniquement la suite logique.",
  },
  paused: {
    title: "Pause ouverte",
    text: "Ajoutez la reprise ou le départ.",
  },
  closed: {
    title: "Journée terminée",
    text: "Une pause complète peut encore être insérée.",
  },
};

function zonedParts(date: Date, timeZone: string) {
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

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function optionIcon(option: MissingClockingOption) {
  return option.kind === "complete_break"
    ? Coffee
    : eventMeta[option.type].Icon;
}

export function AdminMissingEventPanel({
  profiles,
  timeZone,
  initialProfileId,
  initialRequestedAt,
  onClose,
  onCreated,
}: {
  profiles: AdminClockingProfile[];
  timeZone: string;
  initialProfileId?: string;
  initialRequestedAt?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const activeProfiles = useMemo(
    () =>
      profiles
        .filter((profile) => profile.is_active)
        .sort((left, right) =>
          left.fullname.localeCompare(right.fullname, "fr"),
        ),
    [profiles],
  );
  const [initialParts] = useState(() => {
    const initialMoment = initialRequestedAt
      ? new Date(initialRequestedAt)
      : new Date(Date.now() - 5 * 60_000);
    return zonedParts(initialMoment, timeZone);
  });
  const [profileId, setProfileId] = useState(
    initialProfileId ?? activeProfiles[0]?.id ?? "",
  );
  const [selectedDay, setSelectedDay] = useState(initialParts.day);
  const [requestedTime, setRequestedTime] = useState(initialParts.time);
  const [pauseStart, setPauseStart] = useState(initialParts.time);
  const [pauseEnd, setPauseEnd] = useState(initialParts.time);
  const [events, setEvents] = useState<SequencedClockingEvent[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [reason, setReason] = useState("");
  const [loadingDay, setLoadingDay] = useState(true);
  const [dayLoadFailed, setDayLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadDay() {
      if (!profileId || !selectedDay) {
        setEvents([]);
        setDayLoadFailed(false);
        setLoadingDay(false);
        return;
      }
      setLoadingDay(true);
      setDayLoadFailed(false);
      const { data, error } = await supabase
        .schema("zecontrol")
        .from("events")
        .select("id, type, pointed_at")
        .eq("profile_id", profileId)
        .in("event_status", ["accepted", "pending"])
        .gte(
          "pointed_at",
          zonedDayBoundary(selectedDay, timeZone).toISOString(),
        )
        .lt(
          "pointed_at",
          zonedDayBoundary(nextDay(selectedDay), timeZone).toISOString(),
        )
        .order("pointed_at", { ascending: true });
      if (!active) return;
      const nextEvents = error
        ? []
        : ((data ?? []) as SequencedClockingEvent[]);
      setEvents(nextEvents);
      setDayLoadFailed(Boolean(error));
      setMessage(
        error ? "La journée du collaborateur n’est pas accessible." : null,
      );
      if (!error) {
        const nextOption = missingClockingOptions(nextEvents)[0];
        setSelectedOptionId(nextOption?.id ?? "");
        if (nextOption?.kind === "complete_break") {
          setPauseStart(
            zonedParts(new Date(nextOption.suggestedStart), timeZone).time,
          );
          setPauseEnd(
            zonedParts(new Date(nextOption.suggestedEnd), timeZone).time,
          );
        } else {
          const last = nextEvents.at(-1);
          const now = new Date(Date.now() - 5 * 60_000);
          const fallback =
            selectedDay === dateKey(now, timeZone)
              ? now
              : last
                ? new Date(
                    new Date(last.pointed_at).getTime() + 5 * 60_000,
                  )
                : zonedDateTime(`${selectedDay}T08:00`, timeZone);
          setRequestedTime(zonedParts(fallback, timeZone).time);
        }
      }
      setLoadingDay(false);
    }
    void loadDay();
    return () => {
      active = false;
    };
  }, [profileId, selectedDay, supabase, timeZone]);

  const dayState = clockingDayState(events);
  const options = useMemo(
    () => (dayLoadFailed ? [] : missingClockingOptions(events)),
    [dayLoadFailed, events],
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
  const selectionIsValid =
    selectedOption?.kind === "single"
      ? validMissingEventTypes(events, requestedDate, timeZone).includes(
          selectedOption.type,
        )
      : selectedOption?.kind === "complete_break"
        ? isCompleteBreakInsertionValid(
            events,
            pauseStartDate,
            pauseEndDate,
            timeZone,
          )
        : false;
  const selectedProfile = activeProfiles.find(
    (profile) => profile.id === profileId,
  );

  function chooseOption(option: MissingClockingOption) {
    setSelectedOptionId(option.id);
    setMessage(null);
    if (option.kind === "complete_break") {
      setPauseStart(
        zonedParts(new Date(option.suggestedStart), timeZone).time,
      );
      setPauseEnd(
        zonedParts(new Date(option.suggestedEnd), timeZone).time,
      );
    }
  }

  async function createMissingEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      submitting ||
      loadingDay ||
      !profileId ||
      !selectedOption ||
      !selectionIsValid
    ) {
      return;
    }
    setSubmitting(true);
    setMessage(null);

    const result =
      selectedOption.kind === "complete_break"
        ? await supabase
            .schema("zecontrol")
            .rpc("create_admin_missing_clocking_break", {
              target_profile_id: profileId,
              requested_break_at: pauseStartDate.toISOString(),
              requested_resume_at: pauseEndDate.toISOString(),
              admin_reason: reason.trim() || null,
            })
        : await supabase
            .schema("zecontrol")
            .rpc("create_admin_missing_clocking_event", {
              target_profile_id: profileId,
              requested_event_type: selectedOption.type,
              requested_pointed_at: requestedDate.toISOString(),
              admin_reason: reason.trim() || null,
            });

    if (result.error) {
      setMessage(
        /future_time/i.test(result.error.message)
          ? "L’heure choisie doit être dans le passé."
          : /invalid_sequence|invalid_break/i.test(result.error.message)
            ? "Ces heures ne respectent pas la chronologie de la journée."
            : /access_denied/i.test(result.error.message)
              ? "Vous ne pouvez pas modifier ce collaborateur."
              : "Le pointage n’a pas pu être ajouté. Réessayez.",
      );
    } else {
      setCreated(true);
      onCreated();
    }
    setSubmitting(false);
  }

  return (
    <div
      className="admin-missing-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="admin-missing-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-missing-title"
      >
        <button
          className="admin-missing-close"
          type="button"
          aria-label="Fermer"
          onClick={onClose}
        >
          <X size={19} />
        </button>
        <header>
          <span><CalendarClock size={22} /></span>
          <div>
            <small>Ajout administrateur</small>
            <h2 id="admin-missing-title">Compléter une journée</h2>
            <p>Choisissez la journée : les seules actions possibles seront proposées.</p>
          </div>
        </header>

        {created ? (
          <div className="admin-missing-success">
            <span><Check size={28} /></span>
            <h3>Journée mise à jour</h3>
            <p>Le pointage de {selectedProfile?.fullname ?? "ce collaborateur"} a été ajouté et tracé.</p>
            <button type="button" onClick={onClose}>Terminer</button>
          </div>
        ) : (
          <form onSubmit={(event) => void createMissingEvent(event)}>
            <div className="admin-missing-selection">
              <label className="admin-missing-profile">
                <span>Collaborateur</span>
                <div>
                  <UserRound size={18} />
                  <select
                    value={profileId}
                    onChange={(event) => {
                      setProfileId(event.target.value);
                      setSelectedOptionId("");
                      setMessage(null);
                    }}
                    required
                  >
                    {activeProfiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.fullname} · {profile.identifiant}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
              <label className="admin-missing-time">
                <span>Journée concernée</span>
                <div>
                  <CalendarClock size={18} />
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
                </div>
              </label>
            </div>

            <div className={`admin-missing-state state-${dayState}`}>
              <span>
                {loadingDay ? (
                  <LoaderCircle className="spin" size={20} />
                ) : (
                  <Clock3 size={20} />
                )}
              </span>
              <div>
                <strong>{loadingDay ? "Lecture de la journée…" : dayStateCopy[dayState].title}</strong>
                <small>{loadingDay ? "Vérification des actions enregistrées." : dayStateCopy[dayState].text}</small>
              </div>
            </div>

            {!loadingDay && (
              <div className="admin-missing-timeline">
                {events.length === 0 ? (
                  <p>Aucun point enregistré</p>
                ) : (
                  events.map((item) => {
                    const Icon = eventMeta[item.type].Icon;
                    return (
                      <div className={`event-${item.type}`} key={item.id}>
                        <span><Icon size={14} /></span>
                        <strong>{eventLabels[item.type]}</strong>
                        <time>{formatTime(item.pointed_at, timeZone)}</time>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {!loadingDay && options.length > 0 && (
              <fieldset className="admin-missing-actions">
                <legend>Action logique à ajouter</legend>
                <div>
                  {options.map((option) => {
                    const Icon = optionIcon(option);
                    return (
                      <button
                        className={`${option.kind === "complete_break" ? "event-complete-break" : `event-${option.type}`} ${selectedOption?.id === option.id ? "selected" : ""}`}
                        type="button"
                        onClick={() => chooseOption(option)}
                        key={option.id}
                      >
                        <span><Icon size={20} /></span>
                        <div>
                          <strong>{option.title}</strong>
                          <small>
                            {option.kind === "complete_break"
                              ? `${formatTime(option.intervalStart, timeZone)}–${formatTime(option.intervalEnd, timeZone)}`
                              : option.hint}
                          </small>
                        </div>
                        {selectedOption?.id === option.id && <Check size={16} />}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}

            {selectedOption?.kind === "complete_break" ? (
              <div className="admin-missing-pause-times">
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
              <label className="admin-missing-time">
                <span>Heure de {eventLabels[selectedOption.type].toLowerCase()}</span>
                <div><Clock3 size={18} /><input type="time" value={requestedTime} onChange={(event) => { setRequestedTime(event.target.value); setMessage(null); }} required /></div>
              </label>
            ) : null}

            {!loadingDay && options.length === 0 && !dayLoadFailed && (
              <div className="admin-missing-error neutral">
                <LockKeyhole size={16} /> Aucun ajout compatible pour cette journée.
              </div>
            )}
            {!loadingDay && selectedOption && !selectionIsValid && (
              <div className="admin-missing-error">
                <Clock3 size={16} /> Les heures doivent rester dans l’intervalle proposé.
              </div>
            )}

            <label className="admin-missing-reason">
              <span>Note <em>facultative</em></span>
              <textarea
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ex. Pause confirmée par le responsable…"
              />
            </label>

            {message && (
              <div className="admin-missing-error" role="alert">
                <X size={16} /> {message}
              </div>
            )}

            <footer>
              <p><ShieldCheck size={15} /> Ajouté et validé par vous</p>
              <button
                type="submit"
                disabled={
                  submitting ||
                  loadingDay ||
                  !selectedOption ||
                  !selectionIsValid
                }
              >
                {submitting ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}
                {submitting
                  ? "Ajout…"
                  : selectedOption?.kind === "complete_break"
                    ? "Ajouter la pause"
                    : "Ajouter le pointage"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
