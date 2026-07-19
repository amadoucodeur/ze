"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, BriefcaseBusiness, Check, ChevronLeft, ChevronRight, CircleHelp, ClipboardList, Gauge, LoaderCircle, MapPin, MessageSquareText, Search, Sparkles, UserPlus, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { trackProductEvent } from "@/lib/analytics/client";
import type { TalentSearchProgressEvent, TalentSearchResult } from "@/lib/search/schema";
import type { InterviewGuide } from "@/lib/offers/schema";

type Offer = {
  id: string; title: string; department: string | null; status: string; contract_type: string | null; work_mode: string | null; location: string | null;
  headcount: number; target_start_date: string | null; salary_min: number | null; salary_max: number | null; salary_currency: string | null; salary_period: string | null;
  summary: string | null; mission: string | null; responsibilities: string[]; must_have_skills: string[]; nice_to_have_skills: string[]; languages: string[];
  industries: string[]; min_experience_months: number | null; education: string | null; success_outcomes: string[]; recruiter_intent: string | null; points_to_clarify: string[];
};
type Candidate = { id: string; fullname: string; poste_type: string | null; localisation: string | null; statut: string; performance_score: number | null };
type Application = { id: string; offre_id: string; candidat_id: string; stage: string; match_score: number | null; match_summary: string | null; match_details: Record<string, unknown>; team_note: string | null; updated_at: string; candidat: Candidate | null };
type InterviewQuestion = { id: string; candidature_id: string; question: string; purpose: string | null; expected_signals: string[]; category: string; position: number; candidate_answer: string | null; interviewer_note: string | null; score: number | null };
type Tab = "overview" | "matching" | "pipeline";

const stages = [
  { value: "review", label: "À examiner" }, { value: "shortlisted", label: "Présélectionné" }, { value: "interview", label: "Entretien" },
  { value: "offer", label: "Proposition" }, { value: "hired", label: "Retenu" }, { value: "rejected", label: "Refusé" },
];
const statusLabels: Record<string, string> = { draft: "Brouillon", open: "Ouverte", paused: "En pause", closed: "Clôturée" };
const ManageOfferContext = createContext(false);

async function readStream(response: Response, onEvent: (event: TalentSearchProgressEvent) => void) {
  if (!response.body) throw new Error("Le suivi de la recherche n’est pas disponible.");
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  while (true) {
    const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n"); buffer = lines.pop() || "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as TalentSearchProgressEvent);
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as TalentSearchProgressEvent);
}

async function fetchOfferWorkspace(offerId: string) {
  const supabase = createClient();
  const [offerResult, appResult, questionResult] = await Promise.all([
    supabase.from("offres").select("id, title, department, status, contract_type, work_mode, location, headcount, target_start_date, salary_min, salary_max, salary_currency, salary_period, summary, mission, responsibilities, must_have_skills, nice_to_have_skills, languages, industries, min_experience_months, education, success_outcomes, recruiter_intent, points_to_clarify").eq("id", offerId).maybeSingle(),
    supabase.from("candidatures").select("id, offre_id, candidat_id, stage, match_score, match_summary, match_details, team_note, updated_at, candidat:candidats(id, fullname, poste_type, localisation, statut, performance_score)").eq("offre_id", offerId).order("updated_at", { ascending: false }),
    supabase.from("interview_questions").select("id, candidature_id, question, purpose, expected_signals, category, position, candidate_answer, interviewer_note, score").order("position"),
  ]);
  return { offerResult, appResult, questionResult };
}

function InterviewPanel({ application, questions, onQuestionsChange }: { application: Application; questions: InterviewQuestion[]; onQuestionsChange: (questions: InterviewQuestion[]) => void }) {
  const [generating, setGenerating] = useState(false); const [saving, setSaving] = useState(false); const [message, setMessage] = useState<string | null>(null); const [currentIndex, setCurrentIndex] = useState(0); const [open, setOpen] = useState(false);
  const canManage = useContext(ManageOfferContext);
  const candidateName = application.candidat?.fullname || "Candidat";
  const answeredCount = questions.filter((question) => question.candidate_answer?.trim()).length;
  const activeQuestion = questions[Math.min(currentIndex, Math.max(0, questions.length - 1))];
  const categoryLabels: Record<string, string> = { motivation: "Motivation", experience: "Expérience", skill: "Compétence", situation: "Mise en situation", availability: "Disponibilité", role: "Rôle", closing: "Conclusion" };
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", closeOnEscape); };
  }, [open]);

  async function generate() {
    setGenerating(true); setMessage(null);
    try {
      const response = await fetch("/api/offres/interview-guide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidatureId: application.id }) });
      const payload = await response.json() as { guide?: InterviewGuide; message?: string };
      if (!response.ok || !payload.guide) throw new Error(payload.message || "Le guide n’a pas pu être préparé.");
      const supabase = createClient();
      const { data, error } = await supabase.from("interview_questions").insert(payload.guide.questions.map((question, index) => ({ candidature_id: application.id, question: question.question, purpose: question.purpose, expected_signals: question.expectedSignals, category: question.category, position: index + 1 }))).select("id, candidature_id, question, purpose, expected_signals, category, position, candidate_answer, interviewer_note, score").order("position");
      if (error) throw new Error("Les questions n’ont pas pu être enregistrées.");
      onQuestionsChange((data || []) as InterviewQuestion[]); setMessage("Guide prêt. Notez fidèlement les réponses données par le candidat.");
      void trackProductEvent("interview_guide_created", { candidature_id: application.id, question_count: payload.guide.questions.length });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Le guide n’a pas pu être préparé."); }
    finally { setGenerating(false); }
  }

  async function saveAnswers() {
    setSaving(true); setMessage(null); const supabase = createClient();
    const results = await Promise.all(questions.map((question) => supabase.from("interview_questions").update({ candidate_answer: question.candidate_answer?.trim() || null, interviewer_note: question.interviewer_note?.trim() || null, score: question.score }).eq("id", question.id)));
    if (results.some((result) => result.error)) setMessage("Certaines réponses n’ont pas été enregistrées. Réessayez.");
    else { setMessage("Réponses d’entretien enregistrées."); void trackProductEvent("interview_response_saved", { candidature_id: application.id, answered_count: questions.filter((question) => question.candidate_answer?.trim()).length }); }
    setSaving(false);
  }

  if (!open) return <button className="pipeline-interview-launch" type="button" onClick={() => setOpen(true)}><MessageSquareText size={17} /><span><strong>{questions.length ? "Conduire l’entretien" : "Préparer l’entretien"}</strong><small>{questions.length ? `${answeredCount}/${questions.length} réponses saisies` : "Créer les questions adaptées"}</small></span><ChevronRight size={17} /></button>;

  return <section className="interview-workspace" role="dialog" aria-modal="true" aria-labelledby="interview-title">
    <header className="interview-workspace-head">
      <button type="button" onClick={() => setOpen(false)}><ArrowLeft size={17} /> Retour au processus</button>
      <div><span>Entretien structuré</span><h2 id="interview-title">{candidateName}</h2><p>Avancez question par question. Les réponses restent séparées de vos observations.</p></div>
      {questions.length > 0 && <div className="interview-progress-summary"><strong>{answeredCount}/{questions.length}</strong><span>réponses saisies</span></div>}
    </header>

    {!questions.length ? <div className="interview-empty"><Sparkles size={28} /><h3>Préparer un guide adapté à ce profil</h3><p>ZeRecruit utilisera l’offre, les expériences documentées et les points à vérifier. Vous garderez la maîtrise de l’entretien.</p>{canManage ? <button className="button button-primary" type="button" disabled={generating} onClick={generate}>{generating ? <><LoaderCircle className="spin" size={17} /> Préparation du guide…</> : <><Sparkles size={17} /> Proposer les questions</>}</button> : <p>Votre rôle permet uniquement de consulter cet entretien.</p>}</div> : activeQuestion && <>
      <div className="interview-progress" aria-label={`Question ${currentIndex + 1} sur ${questions.length}`}><span style={{ width: `${(currentIndex + 1) / questions.length * 100}%` }} /></div>
      <article className="interview-focus-card">
        <div className="interview-question-copy"><div><span>Question {currentIndex + 1} sur {questions.length}</span><small>{categoryLabels[activeQuestion.category] || activeQuestion.category}</small></div><h3>{activeQuestion.question}</h3>{activeQuestion.purpose && <p>{activeQuestion.purpose}</p>}{activeQuestion.expected_signals.length > 0 && <details><summary><CircleHelp size={16} /> Ce qu’il est utile d’écouter</summary><ul>{activeQuestion.expected_signals.map((signal) => <li key={signal}>{signal}</li>)}</ul></details>}</div>
        <div className="interview-answer-fields"><label><span>Réponse du candidat</span><small>Notez fidèlement ses mots, exemples et résultats.</small><textarea readOnly={!canManage} rows={8} value={activeQuestion.candidate_answer || ""} onChange={(event) => onQuestionsChange(questions.map((item) => item.id === activeQuestion.id ? { ...item, candidate_answer: event.target.value } : item))} placeholder="Saisissez la réponse donnée par le candidat…" /></label><div><label><span>Votre observation</span><textarea readOnly={!canManage} rows={4} value={activeQuestion.interviewer_note || ""} onChange={(event) => onQuestionsChange(questions.map((item) => item.id === activeQuestion.id ? { ...item, interviewer_note: event.target.value } : item))} placeholder="Note professionnelle facultative" /></label><label><span>Solidité de la réponse</span><select disabled={!canManage} value={activeQuestion.score ?? ""} onChange={(event) => onQuestionsChange(questions.map((item) => item.id === activeQuestion.id ? { ...item, score: event.target.value ? Number(event.target.value) : null } : item))}><option value="">Non évaluée</option><option value="25">À approfondir</option><option value="50">Partielle</option><option value="75">Solide</option><option value="100">Très convaincante</option></select></label></div></div>
      </article>
      {message && <div className="interview-message" role="status">{message}</div>}
      <footer className="interview-actions"><button className="button button-secondary" type="button" disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}><ChevronLeft size={17} /> Précédente</button><span>{currentIndex + 1} / {questions.length}</span>{currentIndex < questions.length - 1 ? <button className="button button-primary" type="button" onClick={() => setCurrentIndex((index) => Math.min(questions.length - 1, index + 1))}>Question suivante <ChevronRight size={17} /></button> : canManage ? <button className="button button-primary" type="button" disabled={saving} onClick={saveAnswers}>{saving ? <><LoaderCircle className="spin" size={17} /> Enregistrement…</> : <><Check size={17} /> Enregistrer l’entretien</>}</button> : <button className="button button-secondary" type="button" onClick={() => setOpen(false)}>Terminer la lecture</button>}</footer>
    </>}
  </section>;
}

export function OfferWorkspace({ offerId, canManage, justCreated }: { offerId: string; canManage: boolean; justCreated: boolean }) {
  const [offer, setOffer] = useState<Offer | null>(null); const [applications, setApplications] = useState<Application[]>([]); const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [loading, setLoading] = useState(true); const [tab, setTab] = useState<Tab>(justCreated ? "matching" : "overview"); const [results, setResults] = useState<TalentSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false); const [searchStage, setSearchStage] = useState(""); const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(justCreated ? { type: "success", text: "Offre créée. Lancez le matching pour découvrir les profils les plus proches." } : null);

  async function load() {
    const { offerResult, appResult, questionResult } = await fetchOfferWorkspace(offerId);
    if (offerResult.error || !offerResult.data) setMessage({ type: "error", text: "Cette offre n’a pas pu être chargée." }); else setOffer(offerResult.data as Offer);
    setApplications((appResult.data || []) as unknown as Application[]); setQuestions((questionResult.data || []) as InterviewQuestion[]); setLoading(false);
  }
  useEffect(() => {
    let active = true;
    void fetchOfferWorkspace(offerId).then(({ offerResult, appResult, questionResult }) => {
      if (!active) return;
      if (offerResult.error || !offerResult.data) setMessage({ type: "error", text: "Cette offre n’a pas pu être chargée." }); else setOffer(offerResult.data as Offer);
      setApplications((appResult.data || []) as unknown as Application[]); setQuestions((questionResult.data || []) as InterviewQuestion[]); setLoading(false);
    });
    return () => { active = false; };
  }, [offerId]);

  const applicationByCandidate = useMemo(() => new Map(applications.map((application) => [application.candidat_id, application])), [applications]);

  async function findMatches() {
    if (!offer || searching) return; setSearching(true); setMessage(null); setSearchStage("Compréhension du besoin…");
    try {
      const response = await fetch("/api/search/talents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offerId }) });
      if (!response.ok) throw new Error("La recherche n’a pas pu démarrer."); let streamError = ""; let completed = false;
      await readStream(response, (event) => { if (event.type === "stage") setSearchStage(event.message); else if (event.type === "complete") { completed = true; setResults(event.results); } else if (event.type === "clarification") streamError = event.question; else if (event.type === "error") streamError = event.message; });
      if (streamError) throw new Error(streamError);
      if (!completed) throw new Error("Le classement n’a pas été reçu. Relancez le matching.");
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Le matching n’a pas pu aboutir." }); }
    finally { setSearching(false); setSearchStage(""); }
  }

  async function addCandidate(result: TalentSearchResult) {
    const supabase = createClient();
    const { error } = await supabase.from("candidatures").insert({ offre_id: offerId, candidat_id: result.id, stage: "review", match_score: result.relevanceScore, match_summary: result.matches.slice(0, 2).join(" · ") || null, match_details: { matches: result.matches, gaps: result.gaps, evidence: result.evidence } });
    if (error && error.code !== "23505") return setMessage({ type: "error", text: "Le profil n’a pas pu être ajouté au processus." });
    setMessage({ type: "success", text: error?.code === "23505" ? "Ce profil est déjà dans le processus." : `${result.fullname} a été ajouté à l’offre.` });
    void trackProductEvent("candidate_added_to_offer", { offer_id: offerId, candidate_id: result.id, source: "offer_matching" }); await load();
  }

  async function updateStage(application: Application, stage: string) {
    const supabase = createClient(); const { error } = await supabase.from("candidatures").update({ stage }).eq("id", application.id);
    if (error) setMessage({ type: "error", text: "L’étape n’a pas été modifiée." });
    else { setApplications((current) => current.map((item) => item.id === application.id ? { ...item, stage } : item)); setMessage({ type: "success", text: stage === "interview" ? "Profil déplacé en entretien. Vous pouvez maintenant préparer les questions." : "Étape mise à jour." }); }
  }

  if (loading) return <div className="offer-workspace-loading"><LoaderCircle className="spin" size={25} /> Chargement de l’offre…</div>;
  if (!offer) return <div className="offer-list-error"><AlertCircle size={22} /><div><strong>Offre introuvable</strong><p>Retournez à la liste puis réessayez.</p></div></div>;

  return <ManageOfferContext.Provider value={canManage}><div className="offer-workspace">
    <header className="offer-hero"><div className="offer-hero-icon"><BriefcaseBusiness size={26} /></div><div><span className={`is-${offer.status}`}>{statusLabels[offer.status]}</span><h1>{offer.title}</h1><p>{offer.department || "Équipe à préciser"}{offer.location ? ` · ${offer.location}` : ""}</p></div><div className="offer-hero-metrics"><span><UsersRound size={17} /><strong>{applications.length}</strong> profils</span><span><MessageSquareText size={17} /><strong>{applications.filter((application) => application.stage === "interview").length}</strong> entretiens</span></div></header>
    {message && <div className={`offer-message is-${message.type}`} role={message.type === "error" ? "alert" : "status"}>{message.type === "error" ? <AlertCircle size={18} /> : <Check size={18} />}{message.text}</div>}
    <nav className="offer-tabs" aria-label="Sections de l’offre"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><ClipboardList size={17} /> Vue d’ensemble</button><button className={tab === "matching" ? "active" : ""} onClick={() => setTab("matching")}><Sparkles size={17} /> Profils recommandés</button><button className={tab === "pipeline" ? "active" : ""} onClick={() => setTab("pipeline")}><UsersRound size={17} /> Processus <span>{applications.length}</span></button></nav>

    {tab === "overview" && <div className="offer-overview-grid"><section className="offer-overview-main"><span>Intention validée</span><h2>Mission</h2><p>{offer.mission || offer.summary || "Mission à préciser."}</p>{offer.recruiter_intent && <div className="offer-intent"><Sparkles size={18} /><div><strong>Ce que le recruteur cherche vraiment</strong><p>{offer.recruiter_intent}</p></div></div>}<h3>Responsabilités</h3>{offer.responsibilities.length ? <ul>{offer.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="is-muted">À compléter.</p>}<h3>Résultats attendus</h3>{offer.success_outcomes.length ? <ul>{offer.success_outcomes.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="is-muted">À compléter.</p>}</section><aside className="offer-criteria-card"><h2>Critères de matching</h2><div className="is-required"><strong>Indispensable</strong>{offer.must_have_skills.length ? offer.must_have_skills.map((skill) => <span key={skill}>{skill}</span>) : <p>Aucun critère bloquant défini.</p>}</div><div><strong>Souhaité</strong>{offer.nice_to_have_skills.map((skill) => <span key={skill}>{skill}</span>)}</div>{offer.points_to_clarify.length > 0 && <div className="offer-points"><strong><CircleHelp size={15} /> À clarifier</strong><ul>{offer.points_to_clarify.map((point) => <li key={point}>{point}</li>)}</ul></div>}<button className="button button-primary" type="button" onClick={() => setTab("matching")}><Sparkles size={17} /> Trouver les profils <ArrowRight size={17} /></button></aside></div>}

    {tab === "matching" && <section className="offer-matching"><div className="offer-matching-head"><div><span>Matching contextuel</span><h2>Les profils pertinents pour cette offre</h2><p>Le pourcentage mesure uniquement la correspondance avec l’intention validée ci-dessus.</p></div><button className="button button-primary" type="button" disabled={searching} onClick={findMatches}>{searching ? <><LoaderCircle className="spin" size={18} /> {searchStage || "Recherche…"}</> : <><Search size={18} /> {results ? "Actualiser le matching" : "Lancer le matching"}</>}</button></div>{results === null && !searching ? <div className="offer-match-empty"><Sparkles size={28} /><h3>Votre vivier est prêt à être comparé.</h3><p>Lancez le matching pour obtenir un classement explicable et des points à vérifier.</p></div> : results?.length ? <div className="offer-match-list">{results.map((result, index) => { const existing = applicationByCandidate.get(result.id); return <article key={result.id}><div className="offer-match-rank"><span>#{index + 1}</span><strong>{result.relevanceScore}%</strong><small>Pertinence</small></div><div className="offer-match-copy"><span>{result.posteType || "Profil professionnel"}</span><h3>{result.fullname}</h3>{result.localisation && <p><MapPin size={14} />{result.localisation}</p>}<div className="offer-match-evidence">{result.matches.slice(0, 2).map((match) => <span key={match}><Check size={14} />{match}</span>)}{result.gaps.slice(0, 1).map((gap) => <span className="is-gap" key={gap}><CircleHelp size={14} />{gap}</span>)}</div></div><div className="offer-match-actions">{existing ? <span className="is-added"><Check size={16} /> Dans le processus</span> : canManage && <button type="button" onClick={() => void addCandidate(result)}><UserPlus size={17} /> Ajouter à l’offre</button>}<Link href={`/dashboard/talents/${result.id}`}>Voir le profil <ChevronRight size={16} /></Link></div></article>; })}</div> : results && <div className="offer-match-empty"><Search size={28} /><h3>Aucun profil suffisamment proche.</h3><p>Élargissez un critère souhaité ou importez de nouveaux CV pour cette offre.</p><Link className="button button-secondary" href={`/dashboard/talents/nouveau?offre=${offer.id}`}>Importer des CV</Link></div>}</section>}

    {tab === "pipeline" && <section className="offer-pipeline"><div className="offer-pipeline-head"><div><span>Processus de recrutement</span><h2>Une prochaine action claire pour chaque profil</h2></div><Link className="button button-secondary" href="#" onClick={(event) => { event.preventDefault(); setTab("matching"); }}><UserPlus size={17} /> Ajouter des profils</Link></div>{applications.length ? <div className="pipeline-board">{stages.map((stage) => { const stageApplications = applications.filter((application) => application.stage === stage.value); return <section className={`pipeline-column is-${stage.value}`} key={stage.value}><header><strong>{stage.label}</strong><span>{stageApplications.length}</span></header><div>{stageApplications.map((application) => application.candidat && <article className="pipeline-card" key={application.id}><div className="pipeline-card-head"><span>{application.candidat.fullname.slice(0, 2).toUpperCase()}</span><div><h3>{application.candidat.fullname}</h3><p>{application.candidat.poste_type || "Expertise à compléter"}</p></div>{application.match_score !== null && <strong><Gauge size={13} />{application.match_score}%</strong>}</div><label><span>Étape</span><select disabled={!canManage} value={application.stage} onChange={(event) => void updateStage(application, event.target.value)}>{stages.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><Link href={`/dashboard/talents/${application.candidat.id}`}>Ouvrir le profil <ChevronRight size={15} /></Link>{application.stage === "interview" && <InterviewPanel application={application} questions={questions.filter((question) => question.candidature_id === application.id)} onQuestionsChange={(next) => setQuestions((current) => [...current.filter((question) => question.candidature_id !== application.id), ...next])} />}</article>)}</div></section>; })}</div> : <div className="offer-match-empty"><UsersRound size={28} /><h3>Le processus est encore vide.</h3><p>Commencez par lancer le matching, puis ajoutez les profils que votre équipe souhaite examiner.</p><button className="button button-primary" type="button" onClick={() => setTab("matching")}><Sparkles size={17} /> Trouver des profils</button></div>}</section>}
  </div></ManageOfferContext.Provider>;
}
