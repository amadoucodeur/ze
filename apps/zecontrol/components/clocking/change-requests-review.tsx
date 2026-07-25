"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  LoaderCircle,
  PenLine,
  Plus,
  RotateCcw,
  UserRound,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type EventType = "start" | "break" | "resume" | "end";
type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

type ChangeRequest = {
  id: string;
  created_at: string;
  profile_id: string;
  event_id: string | null;
  request_kind: "correction" | "missing_event";
  requested_type: EventType;
  requested_pointed_at: string;
  reason: string | null;
  original_type: EventType | null;
  original_pointed_at: string | null;
  status: RequestStatus;
  decision_reason: string | null;
};

type Profile = { id: string; fullname: string; identifiant: string };

const eventLabels: Record<EventType, string> = { start: "Arrivée", break: "Début de pause", resume: "Reprise", end: "Départ" };
const statusLabels: Record<RequestStatus, string> = { pending: "À valider", approved: "Approuvée", rejected: "Refusée", cancelled: "Annulée" };

function requestDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function ChangeRequestsReview({ organisationId }: { organisationId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [reviewing, setReviewing] = useState<{ request: ChangeRequest; decision: "approved" | "rejected" } | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadedAt] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase
        .schema("zecontrol")
        .from("event_change_requests")
        .select("id, created_at, profile_id, event_id, request_kind, requested_type, requested_pointed_at, reason, original_type, original_pointed_at, status, decision_reason")
        .eq("organisation_id", organisationId)
        .order("created_at", { ascending: false })
        .limit(150);
      if (!active) return;
      if (!error) {
        const typedRequests = (data ?? []) as ChangeRequest[];
        setRequests(typedRequests);
        const profileIds = [...new Set(typedRequests.map((request) => request.profile_id))];
        if (profileIds.length) {
          const { data: profileData } = await supabase.from("profiles").select("id, fullname, identifiant").in("id", profileIds);
          if (active) setProfiles((profileData ?? []) as Profile[]);
        }
      }
      if (active) setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [organisationId, supabase]);

  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const visibleRequests = filter === "pending" ? requests.filter((request) => request.status === "pending") : requests;
  const pendingCount = requests.filter((request) => request.status === "pending").length;

  function startReview(request: ChangeRequest, decision: "approved" | "rejected") {
    setReviewing({ request, decision });
    setNote("");
    setMessage(null);
  }

  async function confirmReview() {
    if (!reviewing || submitting) return;
    setSubmitting(true);
    setMessage(null);
    const { error } = await supabase
      .schema("zecontrol")
      .rpc("review_event_change_request", {
        target_request_id: reviewing.request.id,
        review_decision: reviewing.decision,
        review_note: note.trim() || null,
      });

    if (error) {
      setMessage(/invalid_sequence/i.test(error.message)
        ? "Cette modification rendrait la suite des pointages incohérente. Vérifiez l’action et l’heure demandées."
        : "La décision n’a pas pu être enregistrée.");
    } else {
      setRequests((current) => current.map((request) => request.id === reviewing.request.id ? { ...request, status: reviewing.decision, decision_reason: note.trim() || null } : request));
      setReviewing(null);
      setNote("");
    }
    setSubmitting(false);
  }

  if (loading) return <div className="change-requests-loading"><LoaderCircle className="spin" size={22} /> Préparation des demandes...</div>;

  return (
    <section className="change-review-workspace">
      <div className="change-review-summary">
        <article><span><Clock3 size={21} /></span><div><small>En attente</small><strong>{pendingCount}</strong></div></article>
        <div><button className={filter === "pending" ? "active" : ""} type="button" onClick={() => setFilter("pending")}>À valider</button><button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>Toutes</button></div>
      </div>

      {visibleRequests.length === 0 ? <div className="change-review-empty"><span><Check size={27} /></span><h2>Tout est à jour</h2><p>Aucune demande ne nécessite votre attention pour le moment.</p></div> : <div className="change-request-list">{visibleRequests.map((request) => {
        const profile = profileMap.get(request.profile_id);
        return <article className={`change-request-card status-${request.status}`} key={request.id}>
          <header><div className="change-request-person"><span><UserRound size={18} /></span><div><strong>{profile?.fullname ?? "Collaborateur"}</strong><small>{profile?.identifiant ?? "Compte de l’organisation"}</small></div></div><span className={`change-request-status ${request.status}`}>{statusLabels[request.status]}</span></header>
          <div className="change-request-kind"><span>{request.request_kind === "correction" ? <PenLine size={17} /> : <Plus size={17} />}</span><div><small>{request.request_kind === "correction" ? "Correction demandée" : "Pointage oublié"}</small><strong>{request.reason || "Aucun motif fourni"}</strong></div></div>
          <div className="change-request-diff">
            {request.request_kind === "correction" && request.original_type && request.original_pointed_at && <div className="change-value old"><small>Actuellement</small><strong>{eventLabels[request.original_type]}</strong><time>{requestDate(request.original_pointed_at)}</time></div>}
            {request.request_kind === "correction" && <ArrowRight size={19} />}
            <div className="change-value new"><small>{request.request_kind === "correction" ? "Demandé" : "À ajouter"}</small><strong>{eventLabels[request.requested_type]}</strong><time>{requestDate(request.requested_pointed_at)}</time></div>
          </div>
          <footer><time>Envoyée {new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" }).format(-Math.max(0, Math.round((loadedAt - new Date(request.created_at).getTime()) / 86_400_000)), "day")}</time>{request.status === "pending" && <div><button className="reject" type="button" onClick={() => startReview(request, "rejected")}><X size={16} /> Refuser</button><button className="approve" type="button" onClick={() => startReview(request, "approved")}><Check size={16} /> Approuver</button></div>}</footer>
        </article>;
      })}</div>}

      {reviewing && <div className={`change-decision-panel decision-${reviewing.decision}`}>
        <div><span>{reviewing.decision === "approved" ? <Check size={20} /> : <X size={20} />}</span><div><small>Décision</small><strong>{reviewing.decision === "approved" ? "Approuver cette demande" : "Refuser cette demande"}</strong></div></div>
        <label><span>Note facultative</span><textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ajouter une précision pour le collaborateur…" /></label>
        {message && <p>{message}</p>}
        <footer><button type="button" onClick={() => setReviewing(null)} disabled={submitting}><RotateCcw size={15} /> Retour</button><button type="button" onClick={() => void confirmReview()} disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={16} /> : reviewing.decision === "approved" ? <Check size={16} /> : <X size={16} />}{submitting ? "Validation..." : "Confirmer"}</button></footer>
      </div>}
    </section>
  );
}
