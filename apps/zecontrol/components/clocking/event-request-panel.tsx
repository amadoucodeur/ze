"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Clock3,
  History,
  LoaderCircle,
  PenLine,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type EventType = "start" | "break" | "resume" | "end";

export type EditableClockingEvent = {
  id: string;
  type: EventType;
  pointed_at: string;
};

export type EventRequestIntent = {
  key: string;
  kind: "correction" | "missing_event";
  eventId?: string;
  requestedAt?: string;
};

const eventLabels: Record<EventType, string> = {
  start: "Arrivée",
  break: "Début de pause",
  resume: "Reprise",
  end: "Départ",
};

function localInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function EventRequestPanel({
  profileId,
  events,
  initialIntent,
  onClose,
  showLauncher = true,
}: {
  profileId: string;
  events: EditableClockingEvent[];
  initialIntent?: EventRequestIntent | null;
  onClose?: () => void;
  showLauncher?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const initialEventId = initialIntent?.eventId ?? events[0]?.id ?? "";
  const initialEvent = initialIntent?.kind === "missing_event" ? undefined : events.find((event) => event.id === initialEventId);
  const [open, setOpen] = useState(Boolean(initialIntent));
  const [kind, setKind] = useState<"correction" | "missing_event">(initialIntent?.kind ?? "correction");
  const [eventId, setEventId] = useState(initialEventId);
  const selectedEvent = events.find((event) => event.id === eventId);
  const [requestedType, setRequestedType] = useState<EventType>(initialEvent?.type ?? "start");
  const [requestedAt, setRequestedAt] = useState(() => localInputValue(initialIntent?.requestedAt ? new Date(initialIntent.requestedAt) : initialEvent ? new Date(initialEvent.pointed_at) : new Date(Date.now() - 5 * 60_000)));
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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
    return () => { active = false; };
  }, [profileId, supabase]);

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

  function chooseEvent(nextId: string) {
    setEventId(nextId);
    const event = events.find((candidate) => candidate.id === nextId);
    if (event) {
      setRequestedType(event.type);
      setRequestedAt(localInputValue(new Date(event.pointed_at)));
    }
  }

  function closeDialog() {
    setOpen(false);
    onClose?.();
  }

  function chooseKind(nextKind: typeof kind) {
    setKind(nextKind);
    setMessage(null);
    if (nextKind === "correction" && selectedEvent) {
      setRequestedType(selectedEvent.type);
      setRequestedAt(localInputValue(new Date(selectedEvent.pointed_at)));
    } else {
      setRequestedType("start");
      setRequestedAt(localInputValue(new Date(Date.now() - 5 * 60_000)));
    }
  }

  async function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || (kind === "correction" && !eventId)) return;
    setPending(true);
    setMessage(null);
    const { error } = await supabase
      .schema("zecontrol")
      .from("event_change_requests")
      .insert({
        request_kind: kind,
        event_id: kind === "correction" ? eventId : null,
        requested_type: requestedType,
        requested_pointed_at: new Date(requestedAt).toISOString(),
        reason: reason.trim() || null,
      });

    if (error) {
      setMessage({
        type: "error",
        text: /future_time/i.test(error.message)
          ? "L’heure choisie doit être dans le passé."
          : /one_pending|duplicate/i.test(error.message)
            ? "Une demande est déjà en attente pour ce pointage."
            : "La demande n’a pas pu être envoyée. Réessayez.",
      });
    } else {
      setPendingCount((count) => count + 1);
      setReason("");
      setMessage({ type: "success", text: "Demande envoyée. Un administrateur va la vérifier." });
    }
    setPending(false);
  }

  return (
    <>
      {showLauncher && <button className="event-request-launcher" type="button" onClick={() => setOpen(true)}>
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
        <span><small>Besoin d’un ajustement ?</small><strong>Corriger ou ajouter un pointage</strong><em>Une validation sera demandée à votre administrateur.</em></span>
        {pendingCount > 0 ? <b>{pendingCount} en attente</b> : <i><PenLine size={18} /></i>}
      </button>}

      {open && <div className="event-request-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
        <section className="event-request-dialog" role="dialog" aria-modal="true" aria-labelledby="event-request-title">
          <button className="event-request-close" type="button" aria-label="Fermer" onClick={closeDialog}><X size={20} /></button>
          <header>
            <div className="request-dialog-illustration" aria-hidden="true">
              <svg viewBox="0 0 160 130" role="presentation">
                <circle className="request-dialog-ring ring-one" cx="80" cy="65" r="47" />
                <circle className="request-dialog-ring ring-two" cx="80" cy="65" r="34" />
                <path className="request-dialog-hand hand-one" d="M80 65V39" />
                <path className="request-dialog-hand hand-two" d="m80 65 22 13" />
                <circle className="request-dialog-center" cx="80" cy="65" r="5" />
                <path className="request-dialog-wave" d="M17 100c22-19 42 18 64 0s42 18 64 0" />
                <path className="request-dialog-star star-one" d="m125 25 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" />
                <path className="request-dialog-star star-two" d="m31 34 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5Z" />
              </svg>
            </div>
            <div><span><Sparkles size={14} /> Demande d’ajustement</span><h2 id="event-request-title">Retrouvons le bon moment</h2><p>Expliquez simplement ce qui doit changer. Votre administrateur validera la demande avant qu’elle affecte votre journée.</p></div>
          </header>

          <form onSubmit={(event) => void submitRequest(event)}>
            <div className="request-kind-picker">
              <button className={kind === "correction" ? "selected" : ""} type="button" onClick={() => chooseKind("correction")} disabled={!events.length}><span><PenLine size={18} /></span><div><strong>Corriger</strong><small>Modifier une action existante</small></div></button>
              <button className={kind === "missing_event" ? "selected" : ""} type="button" onClick={() => chooseKind("missing_event")}><span><Plus size={18} /></span><div><strong>Ajouter un oubli</strong><small>Créer un pointage antérieur</small></div></button>
            </div>

            {kind === "correction" && <label className="request-field request-field-wide"><span>Pointage à corriger</span><div><History size={17} /><select value={eventId} onChange={(event) => chooseEvent(event.target.value)} required>{events.map((item) => <option value={item.id} key={item.id}>{eventLabels[item.type]} · {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.pointed_at))}</option>)}</select></div></label>}

            <div className="request-fields-row">
              <label className="request-field"><span>Action souhaitée</span><div><Sparkles size={17} /><select value={requestedType} onChange={(event) => setRequestedType(event.target.value as EventType)}>{Object.entries(eventLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div></label>
              <label className="request-field"><span>Date et heure</span><div><Clock3 size={17} /><input type="datetime-local" max={localInputValue(new Date())} value={requestedAt} onChange={(event) => setRequestedAt(event.target.value)} required /></div></label>
            </div>

            <label className="request-field request-field-wide"><span>Motif <em>facultatif</em></span><textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex. J’ai oublié de pointer mon arrivée en revenant d’un rendez-vous…" /><small>{reason.length}/500</small></label>

            {message && <div className={`request-message ${message.type}`}>{message.type === "success" ? <Check size={17} /> : <X size={17} />}<span>{message.text}</span></div>}

            <footer><p><Clock3 size={15} /> Aucun changement avant validation.</p><button type="submit" disabled={pending || (kind === "correction" && !eventId)}>{pending ? <LoaderCircle className="spin" size={18} /> : <Send size={17} />}{pending ? "Envoi..." : "Envoyer la demande"}</button></footer>
          </form>
        </section>
      </div>}
    </>
  );
}
