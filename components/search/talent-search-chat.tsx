"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Gauge,
  LoaderCircle,
  MapPin,
  MessageCircleMore,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { BulkCollectionPicker } from "@/components/collections/bulk-collection-picker";
import { CollectionPicker } from "@/components/collections/collection-picker";
import { trackProductEvent } from "@/lib/analytics/client";
import type {
  TalentSearchIntent,
  TalentSearchMessage,
  TalentSearchProgressEvent,
  TalentSearchResult,
} from "@/lib/search/schema";
import { createClient } from "@/lib/supabase/client";

type ChatEntry = TalentSearchMessage & { id: string };
type SearchStage = "understanding" | "embedding" | "searching" | "ranking";
type RecentSearch = { id: string; understood_request: string; result_count: number; created_at: string };
type CriteriaDraft = {
  roles: string;
  requiredSkills: string;
  optionalSkills: string;
  location: string;
  availability: string;
  languages: string;
  industries: string;
  experienceYears: string;
  maxSalary: string;
  currency: string;
};

const SEARCH_SESSION_KEY = "zerecruit:talent-search:v3";

const emptyDraft: CriteriaDraft = {
  roles: "",
  requiredSkills: "",
  optionalSkills: "",
  location: "",
  availability: "",
  languages: "",
  industries: "",
  experienceYears: "",
  maxSalary: "",
  currency: "XOF",
};

const stageLabels: Record<SearchStage, string> = {
  understanding: "Compréhension",
  embedding: "Préparation",
  searching: "Recherche",
  ranking: "Classement",
};

const availabilityLabels: Record<string, string> = {
  available: "Disponible",
  employed: "En poste",
  open_to_opportunities: "À l’écoute",
  freelance: "Freelance",
  student: "En formation",
  unavailable: "Indisponible",
  unknown: "À confirmer",
};

const examples = [
  "Je cherche un développeur React disponible à Abidjan",
  "Un profil commercial B2B avec une expérience en fintech",
  "Une personne junior en comptabilité qui parle anglais",
];

async function readStream(response: Response, onEvent: (event: TalentSearchProgressEvent) => void) {
  if (!response.body) throw new Error("Le suivi de la recherche n’est pas disponible.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as TalentSearchProgressEvent);
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as TalentSearchProgressEvent);
}

function criteriaDraft(intent: TalentSearchIntent): CriteriaDraft {
  return {
    roles: intent.roles.join(", "),
    requiredSkills: intent.mustHaveSkills.join(", "),
    optionalSkills: intent.niceToHaveSkills.join(", "),
    location: intent.locations.join(", "),
    availability: intent.availability[0] || "",
    languages: intent.languages.join(", "),
    industries: intent.industries.join(", "),
    experienceYears: intent.minExperienceMonths === null ? "" : String(Math.round(intent.minExperienceMonths / 12 * 10) / 10),
    maxSalary: intent.salary.maximum === null ? "" : String(intent.salary.maximum),
    currency: intent.salary.currency || "XOF",
  };
}

function queryFromDraft(draft: CriteriaDraft) {
  const parts: string[] = [];
  if (draft.roles.trim()) parts.push(`Je cherche ${draft.roles.trim()}`);
  if (draft.requiredSkills.trim()) parts.push(`compétences indispensables : ${draft.requiredSkills.trim()}`);
  if (draft.optionalSkills.trim()) parts.push(`atouts souhaités : ${draft.optionalSkills.trim()}`);
  if (draft.location.trim()) parts.push(`localisation : ${draft.location.trim()}`);
  if (draft.availability) parts.push(`disponibilité : ${availabilityLabels[draft.availability] || draft.availability}`);
  if (draft.languages.trim()) parts.push(`langues : ${draft.languages.trim()}`);
  if (draft.industries.trim()) parts.push(`secteurs : ${draft.industries.trim()}`);
  if (draft.experienceYears.trim()) parts.push(`au moins ${draft.experienceYears.trim()} années d’expérience`);
  if (draft.maxSalary.trim()) parts.push(`budget maximum : ${draft.maxSalary.trim()} ${draft.currency.trim() || "XOF"} par mois`);
  return parts.join(". ");
}

export function TalentSearchChat({
  canManageCollections,
  initialQuery = "",
}: {
  canManageCollections: boolean;
  initialQuery?: string;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const initialQueryHandledRef = useRef(false);
  const [input, setInput] = useState(initialQuery);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<SearchStage | null>(null);
  const [stageMessage, setStageMessage] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [understoodRequest, setUnderstoodRequest] = useState("");
  const [intent, setIntent] = useState<TalentSearchIntent | null>(null);
  const [draft, setDraft] = useState<CriteriaDraft>(emptyDraft);
  const [results, setResults] = useState<TalentSearchResult[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [awaitingClarification, setAwaitingClarification] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let active = true;
    let initialSearchTimer: number | undefined;
    const restoreTimer = window.setTimeout(() => {
      if (!active) return;
      const requestedQuery = initialQuery.trim();
      if (requestedQuery.length >= 3 && !initialQueryHandledRef.current) {
        initialQueryHandledRef.current = true;
        sessionStorage.removeItem(SEARCH_SESSION_KEY);
        setSessionReady(true);
        initialSearchTimer = window.setTimeout(() => formRef.current?.requestSubmit(), 0);
      } else {
        try {
          const raw = sessionStorage.getItem(SEARCH_SESSION_KEY);
          if (raw) {
            const saved = JSON.parse(raw) as {
              messages?: ChatEntry[];
              understoodRequest?: string;
              intent?: TalentSearchIntent;
              results?: TalentSearchResult[];
            };
            if (Array.isArray(saved.messages)) setMessages(saved.messages.slice(-8));
            if (saved.understoodRequest) setUnderstoodRequest(saved.understoodRequest);
            if (saved.intent) {
              setIntent(saved.intent);
              setDraft(criteriaDraft(saved.intent));
            }
            if (Array.isArray(saved.results)) setResults(saved.results);
          }
        } catch {
          sessionStorage.removeItem(SEARCH_SESSION_KEY);
        }
        setSessionReady(true);
      }
    }, 0);

    const supabase = createClient();
    void supabase
      .from("talent_search_sessions")
      .select("id, understood_request, result_count, created_at")
      .order("created_at", { ascending: false })
      .limit(4)
      .then(({ data }) => { if (active) setRecentSearches((data || []) as RecentSearch[]); });
    return () => {
      active = false;
      window.clearTimeout(restoreTimer);
      if (initialSearchTimer !== undefined) window.clearTimeout(initialSearchTimer);
    };
  }, [initialQuery]);

  useEffect(() => {
    if (!sessionReady) return;
    if (!messages.length && !results && !intent) {
      sessionStorage.removeItem(SEARCH_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify({ messages, understoodRequest, intent, results }));
  }, [intent, messages, results, sessionReady, understoodRequest]);

  const selectedCandidates = useMemo(() => [...selectedIds], [selectedIds]);

  async function saveRecentSearch(criteria: TalentSearchIntent, resultCount: number, clarificationCount: number) {
    const supabase = createClient();
    const { data } = await supabase
      .from("talent_search_sessions")
      .insert({
        understood_request: criteria.understoodRequest,
        criteria,
        result_count: resultCount,
        clarification_count: clarificationCount,
      })
      .select("id, understood_request, result_count, created_at")
      .single();
    if (data) setRecentSearches((current) => [data as RecentSearch, ...current].slice(0, 4));
  }

  async function searchTalents(text: string, restart = false) {
    const query = text.trim();
    if (query.length < 3 || submitting) return;
    const userEntry: ChatEntry = { id: crypto.randomUUID(), role: "user", content: query };
    const baseMessages = restart ? [] : messages;
    const nextMessages = [...baseMessages, userEntry].slice(-8);
    const clarificationCount = nextMessages.filter((message) => message.role === "assistant").length;
    setMessages(nextMessages);
    setInput("");
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    setAwaitingClarification(false);
    setStage("understanding");
    setStageMessage("Compréhension de votre besoin…");
    setElapsedSeconds(0);
    setAnnouncement("Compréhension de votre besoin.");

    try {
      const response = await fetch("/api/search/talents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.map(({ role, content }) => ({ role, content })) }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || "La recherche n’a pas pu démarrer.");
      }

      let completed = false;
      let streamError = "";
      await readStream(response, (event) => {
        if (event.type === "stage") {
          setStage(event.stage);
          setStageMessage(event.message);
          setAnnouncement(event.message);
        } else if (event.type === "heartbeat") {
          setElapsedSeconds(event.elapsedSeconds);
        } else if (event.type === "clarification") {
          completed = true;
          setUnderstoodRequest(event.understoodRequest);
          setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant" as const, content: event.question }].slice(-8));
          setStage(null);
          setAwaitingClarification(true);
          setAnnouncement(event.question);
          window.setTimeout(() => inputRef.current?.focus(), 0);
        } else if (event.type === "complete") {
          completed = true;
          setUnderstoodRequest(event.understoodRequest);
          setIntent(event.criteria);
          setDraft(criteriaDraft(event.criteria));
          setResults(event.results);
          setSelectedIds(new Set());
          setMessages((current) => [...current, {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: event.results.length
              ? `${event.results.length} profil${event.results.length > 1 ? "s" : ""} classé${event.results.length > 1 ? "s" : ""} selon votre besoin.`
              : "Aucun profil ne correspond suffisamment pour le moment.",
          }].slice(-8));
          setStage(null);
          setAwaitingClarification(false);
          setAnnouncement(`${event.results.length} profil${event.results.length > 1 ? "s" : ""} trouvé${event.results.length > 1 ? "s" : ""}.`);
          void trackProductEvent("talent_semantic_search_completed", {
            result_count: event.results.length,
            clarification_count: clarificationCount,
            duration_ms: event.durationMs,
          });
          void saveRecentSearch(event.criteria, event.results.length, clarificationCount);
        } else if (event.type === "error") {
          streamError = event.message;
        }
      });
      if (streamError) throw new Error(streamError);
      if (!completed) throw new Error("La recherche s’est interrompue. Votre demande est conservée, relancez-la.");
    } catch (searchError) {
      setStage(null);
      setError(searchError instanceof Error ? searchError.message : "La recherche n’a pas pu aboutir.");
      setAnnouncement("La recherche n’a pas abouti.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void searchTalents(input, false);
  }

  function applyCriteria(event: FormEvent) {
    event.preventDefault();
    const query = queryFromDraft(draft);
    if (query.length >= 3) void searchTalents(query, true);
  }

  function resetSearch() {
    setMessages([]);
    setResults(null);
    setIntent(null);
    setDraft(emptyDraft);
    setUnderstoodRequest("");
    setError(null);
    setSuccess(null);
    setInput("");
    setStage(null);
    setSelectedIds(new Set());
    setAwaitingClarification(false);
    sessionStorage.removeItem(SEARCH_SESSION_KEY);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function toggleCandidate(candidateId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
    setSuccess(null);
  }

  return (
    <div className={`talent-chat-layout talent-search-studio${results !== null ? " has-results" : ""}`}>
      <span className="sr-only" aria-live="polite">{announcement}</span>
      <section className="talent-chat-panel" aria-label="Recherche de profils">
        <div className="talent-chat-heading">
          <span className="talent-ai-avatar"><Sparkles size={22} /><i /><i /></span>
          <div><strong>ZeRecruit IA</strong><small>Je cherche uniquement dans le vivier de votre organisation.</small></div>
          <span className={`talent-ai-status${submitting ? " is-thinking" : ""}`}><i />{submitting ? "Réflexion…" : "Prêt"}</span>
          {messages.length > 0 && <button type="button" onClick={resetSearch}><RotateCcw size={16} /> Nouvelle recherche</button>}
        </div>

        <div className={`talent-chat-thread${messages.length ? " has-messages" : ""}`}>
          {messages.length === 0 ? (
            <div className="talent-chat-welcome">
              <span><Sparkles size={27} /></span>
              <h2>Parlez-moi du profil idéal.</h2>
              <p>Un poste, une mission ou quelques contraintes suffisent. Je vous demanderai une précision seulement si elle est vraiment nécessaire.</p>
              <div>{examples.map((example) => <button type="button" disabled={submitting} onClick={() => void searchTalents(example, true)} key={example}>{example}<ArrowRight size={15} /></button>)}</div>
              {recentSearches.length > 0 && <div className="talent-recent-searches"><strong><Clock3 size={15} /> Recherches récentes</strong>{recentSearches.map((recent) => <button type="button" onClick={() => void searchTalents(recent.understood_request, true)} key={recent.id}><span>{recent.understood_request}</span><small>{recent.result_count} résultat{recent.result_count > 1 ? "s" : ""}</small></button>)}</div>}
            </div>
          ) : messages.map((message) => (
            <div className={`talent-chat-message is-${message.role}`} key={message.id}>
              <span aria-hidden="true">{message.role === "assistant" ? <Bot size={17} /> : <MessageCircleMore size={17} />}</span>
              <p>{message.content}</p>
            </div>
          ))}

          {stage && (
            <div className="talent-chat-processing" role="status">
              <span className="talent-chat-ai-orbit" aria-hidden="true"><Sparkles size={20} /><i /><i /><i /></span>
              <div><strong>{stageLabels[stage]}</strong><p>{stageMessage}{elapsedSeconds > 0 ? ` · ${elapsedSeconds} s` : ""}</p></div>
              <LoaderCircle className="spin" size={19} aria-hidden="true" />
            </div>
          )}
        </div>

        <form className="talent-chat-composer" ref={formRef} onSubmit={handleSubmit}>
          <label><span className="sr-only">Votre demande</span><textarea ref={inputRef} value={input} rows={2} maxLength={2_000} disabled={submitting} placeholder={awaitingClarification ? "Précisez votre besoin…" : "Ex. Un développeur React disponible à Abidjan…"} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (input.trim().length >= 3) void searchTalents(input, false); } }} /></label>
          <button className="button button-primary" type="submit" disabled={submitting || input.trim().length < 3}>{submitting ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />} <span>{submitting ? "Je cherche…" : "Trouver des profils"}</span></button>
          <small><Sparkles size={13} /> Entrée pour envoyer · aucun critère personnel n’influence le classement</small>
        </form>

        <details className="talent-criteria-editor">
          <summary><span><SlidersHorizontal size={17} /> Ajouter des critères précis</span><small>Facultatif · disponibilité, langues, expérience, budget…</small></summary>
          <form onSubmit={applyCriteria}>
            <div className="talent-criteria-grid">
              <label className="is-wide"><span>Poste ou mission</span><input value={draft.roles} placeholder="Ex. Développeur frontend" onChange={(event) => setDraft((current) => ({ ...current, roles: event.target.value }))} /></label>
              <label><span>Compétences indispensables</span><input value={draft.requiredSkills} placeholder="React, TypeScript" onChange={(event) => setDraft((current) => ({ ...current, requiredSkills: event.target.value }))} /></label>
              <label><span>Atouts souhaités</span><input value={draft.optionalSkills} placeholder="Fintech, design system" onChange={(event) => setDraft((current) => ({ ...current, optionalSkills: event.target.value }))} /></label>
              <label><span>Localisation</span><input value={draft.location} placeholder="Abidjan, télétravail…" onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))} /></label>
              <label><span>Disponibilité</span><select value={draft.availability} onChange={(event) => setDraft((current) => ({ ...current, availability: event.target.value }))}><option value="">Indifférente</option>{Object.entries(availabilityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label><span>Langues</span><input value={draft.languages} placeholder="Français, anglais" onChange={(event) => setDraft((current) => ({ ...current, languages: event.target.value }))} /></label>
              <label><span>Secteurs</span><input value={draft.industries} placeholder="Finance, santé…" onChange={(event) => setDraft((current) => ({ ...current, industries: event.target.value }))} /></label>
              <label><span>Expérience minimale</span><div className="talent-filter-suffix"><input type="number" min="0" max="60" step="0.5" value={draft.experienceYears} placeholder="3" onChange={(event) => setDraft((current) => ({ ...current, experienceYears: event.target.value }))} /><b>ans</b></div></label>
              <label><span>Budget mensuel maximum</span><div className="talent-budget-fields"><input type="number" min="0" value={draft.maxSalary} placeholder="900000" onChange={(event) => setDraft((current) => ({ ...current, maxSalary: event.target.value }))} /><input value={draft.currency} maxLength={8} aria-label="Devise" onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} /></div></label>
            </div>
            <div className="talent-criteria-actions"><small>Séparez les éléments multiples par des virgules.</small><button className="button button-secondary" type="submit" disabled={submitting || queryFromDraft(draft).length < 3}><Search size={16} /> Rechercher avec ces critères</button></div>
          </form>
        </details>
      </section>

      <section className={`talent-chat-results${submitting && results ? " is-refreshing" : ""}`} aria-busy={submitting}>
        {error && <div className="talent-chat-error" role="alert"><AlertCircle size={22} /><div><strong>La recherche n’a pas abouti.</strong><p>{error}</p><button type="button" onClick={() => { setError(null); setInput(messages.filter((message) => message.role === "user").at(-1)?.content || ""); inputRef.current?.focus(); }}>Reprendre la demande</button></div></div>}
        {success && <div className="collection-message is-success" role="status"><Check size={18} />{success}<button type="button" aria-label="Fermer" onClick={() => setSuccess(null)}><X size={16} /></button></div>}

        {!error && results === null && !submitting && (
          <div className="talent-chat-results-empty"><Search size={28} /><h2>Les profils apparaîtront ici.</h2><p>Vous verrez les correspondances importantes, les points à vérifier et les preuves professionnelles.</p></div>
        )}

        {intent && results !== null && (
          <>
            <div className="talent-chat-results-summary">
              <div className="talent-ai-answer-heading"><span><Sparkles size={18} /></span><div><small>Voici ce que j’ai compris</small><h2>{understoodRequest}</h2><p>{results.length ? `${results.length} profil${results.length > 1 ? "s" : ""} à examiner, classé${results.length > 1 ? "s" : ""} par pertinence.` : "Je n’ai pas trouvé de correspondance assez solide."}</p></div><button type="button" onClick={() => inputRef.current?.focus()}>Ajuster</button></div>
              {(intent.roles.length > 0 || intent.mustHaveSkills.length > 0 || intent.niceToHaveSkills.length > 0) && <details className="talent-ai-criteria-review"><summary><SlidersHorizontal size={16} /> Voir les critères retenus</summary><div className="talent-chat-criteria-groups">
                {intent.roles.length > 0 && <div><strong>Mission</strong><span>{intent.roles.join(", ")}</span></div>}
                {intent.mustHaveSkills.length > 0 && <div className="is-required"><strong>Indispensable</strong><span>{intent.mustHaveSkills.join(", ")}</span></div>}
                {intent.niceToHaveSkills.length > 0 && <div><strong>Souhaité</strong><span>{intent.niceToHaveSkills.join(", ")}</span></div>}
              </div></details>}
              {intent.excludedSensitiveCriteria.length > 0 && <div className="talent-chat-sensitive-note"><CircleHelp size={17} /><p>Certains critères personnels ont été écartés. Le classement utilise uniquement les informations professionnelles.</p></div>}
              <p className="talent-score-disclaimer">La pertinence mesure la correspondance avec cette recherche. Elle ne constitue pas une décision de recrutement.</p>
            </div>

            {results.length ? <div className="talent-chat-result-list">{results.map((result, index) => {
              const selected = selectedIds.has(result.id);
              return (
                <article className={`talent-chat-result-card${selected ? " is-selected" : ""}`} key={result.id}>
                  <div className="talent-chat-result-rank"><span>#{index + 1}</span><div className="talent-relevance-score" style={{ "--score": `${result.relevanceScore * 3.6}deg` } as React.CSSProperties}><strong>{result.relevanceScore}<small>%</small></strong></div><small>Pertinence</small></div>
                  <div className="talent-chat-result-main">
                    <div className="talent-chat-result-title"><div><span>{availabilityLabels[result.availability] || "À confirmer"}</span><h3>{result.fullname}</h3><p>{result.posteType || "Expertise à compléter"}</p></div>{result.localisation && <small><MapPin size={14} />{result.localisation}</small>}</div>
                    <div className="talent-chat-match-grid">
                      {result.matches.length > 0 && <div><strong>Pourquoi ce profil ressort</strong><ul>{result.matches.slice(0, 2).map((match) => <li key={match}><Check size={14} />{match}</li>)}</ul></div>}
                      {result.gaps.length > 0 && <div className="has-gaps"><strong>À vérifier</strong><ul>{result.gaps.slice(0, 1).map((gap) => <li key={gap}><CircleHelp size={14} />{gap}</li>)}</ul></div>}
                    </div>
                    {(result.summary || result.evidence.length > 0 || result.profileScore !== null) && <details className="talent-chat-evidence"><summary>Voir l’explication complète</summary>{result.summary && <p>{result.summary}</p>}{result.evidence.length > 0 && <ul>{result.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul>}{result.profileScore !== null && <small><Gauge size={14} /> Qualité documentaire du profil : {result.profileScore}%</small>}</details>}
                    <div className="talent-chat-result-actions">
                    {canManageCollections && <CollectionPicker candidateId={result.id} source="talent_search_result" />}
                    {canManageCollections && <label className="talent-result-select"><input type="checkbox" checked={selected} onChange={() => toggleCandidate(result.id)} /><span>{selected ? "Sélectionné" : "Sélectionner"}</span></label>}
                    <Link className="button button-secondary" href={`/dashboard/talents/${result.id}?from=recherche`}>Ouvrir le profil <ChevronRight size={16} /></Link>
                    </div>
                  </div>
                </article>
              );
            })}</div> : <div className="talent-chat-no-results"><Search size={28} /><h2>Aucun profil assez proche.</h2><p>Élargissez une compétence, la localisation ou le niveau d’expérience.</p><button className="button button-secondary" type="button" onClick={() => inputRef.current?.focus()}>Préciser la recherche</button></div>}
          </>
        )}
      </section>

      {canManageCollections && selectedCandidates.length > 0 && <div className="talent-selection-bar" role="region" aria-label="Profils sélectionnés"><div><strong>{selectedCandidates.length}</strong><span>profil{selectedCandidates.length > 1 ? "s sélectionnés" : " sélectionné"}</span></div><BulkCollectionPicker candidateIds={selectedCandidates} onComplete={(message) => { setSuccess(message); setSelectedIds(new Set()); }} /><button type="button" onClick={() => setSelectedIds(new Set())}><X size={17} /> Effacer</button></div>}
    </div>
  );
}
