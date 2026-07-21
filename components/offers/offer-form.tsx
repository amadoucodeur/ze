"use client";

import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, FileCheck2, FileText, LoaderCircle, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { extractCvFile, ACCEPTED_CV_EXTENSIONS } from "@/lib/cv/client-extraction";
import type { OfferAnalysis } from "@/lib/offers/schema";
import { createClient } from "@/lib/supabase/client";
import { trackProductEvent } from "@/lib/analytics/client";

type OfferDocument = { id: string; name: string; status: "extracting" | "ready" | "error"; text?: string; error?: string };
type OfferFields = {
  title: string; department: string; contractType: string; workMode: string; location: string;
  salaryMin: string; salaryMax: string; salaryCurrency: string; salaryPeriod: string;
  headcount: string; targetStartDate: string;
};

const initialFields: OfferFields = {
  title: "", department: "", contractType: "", workMode: "", location: "",
  salaryMin: "", salaryMax: "", salaryCurrency: "XOF", salaryPeriod: "month",
  headcount: "1", targetStartDate: "",
};

function list(value: string) { return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean); }

export function OfferForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fields, setFields] = useState(initialFields);
  const [freeText, setFreeText] = useState("");
  const [documents, setDocuments] = useState<OfferDocument[]>([]);
  const [dragging, setDragging] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analysis, setAnalysis] = useState<OfferAnalysis | null>(null);
  const [publicationStatus, setPublicationStatus] = useState<"draft" | "open">("open");
  const [message, setMessage] = useState<string | null>(null);

  const updateField = (key: keyof OfferFields, value: string) => setFields((current) => ({ ...current, [key]: value }));
  const extracting = documents.some((document) => document.status === "extracting");
  const readyDocuments = documents.filter((document) => document.status === "ready" && document.text);

  async function addFiles(files: File[]) {
    const available = Math.max(0, 5 - documents.length);
    const selected = files.slice(0, available);
    if (selected.length < files.length) setMessage("Vous pouvez joindre jusqu’à 5 documents à une offre.");
    if (!selected.length) return;
    const pending = selected.map((file) => ({ id: crypto.randomUUID(), name: file.name, status: "extracting" as const }));
    setDocuments((current) => [...current, ...pending]);
    await Promise.all(selected.map(async (file, index) => {
      const id = pending[index].id;
      try {
        const extracted = await extractCvFile(file);
        setDocuments((current) => current.map((document) => document.id === id ? { ...document, status: "ready", text: extracted.text } : document));
      } catch (error) {
        setDocuments((current) => current.map((document) => document.id === id ? { ...document, status: "error", error: error instanceof Error ? error.message : "Ce document n’a pas pu être lu." } : document));
      }
    }));
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    void addFiles(Array.from(event.target.files || []));
    event.target.value = "";
  }

  async function analyse(event: FormEvent) {
    event.preventDefault();
    if (extracting) return setMessage("Attendez la fin de la lecture des documents.");
    setAnalysing(true); setMessage(null);
    try {
      const response = await fetch("/api/offres/analyse", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form: fields, freeText, documents: readyDocuments.map((document) => ({ sourceName: document.name, text: document.text })) }),
      });
      const payload = await response.json() as { analysis?: OfferAnalysis; message?: string };
      if (!response.ok || !payload.analysis) throw new Error(payload.message || "L’offre n’a pas pu être structurée.");
      setAnalysis(payload.analysis);
      setFields((current) => ({ ...current, title: payload.analysis!.title || current.title }));
      window.setTimeout(() => document.getElementById("offer-review")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    } catch (error) { setMessage(error instanceof Error ? error.message : "L’analyse n’a pas pu aboutir."); }
    finally { setAnalysing(false); }
  }

  async function saveOffer() {
    if (!analysis || saving) return;
    setSaving(true); setMessage(null);
    const supabase = createClient();
    const { data, error } = await supabase.from("offres").insert({
      title: analysis.title, department: fields.department || null, status: publicationStatus,
      contract_type: fields.contractType || null, work_mode: fields.workMode || null, location: fields.location || null,
      headcount: Math.max(1, Number(fields.headcount) || 1), target_start_date: fields.targetStartDate || null,
      salary_min: fields.salaryMin ? Number(fields.salaryMin) : null, salary_max: fields.salaryMax ? Number(fields.salaryMax) : null,
      salary_currency: fields.salaryCurrency || null, salary_period: fields.salaryPeriod || null,
      summary: analysis.summary, mission: analysis.mission, responsibilities: analysis.responsibilities,
      must_have_skills: analysis.mustHaveSkills, nice_to_have_skills: analysis.niceToHaveSkills,
      languages: analysis.languages, industries: analysis.industries, min_experience_months: analysis.minExperienceMonths,
      education: analysis.education, success_outcomes: analysis.successOutcomes, recruiter_intent: analysis.recruiterIntent,
      points_to_clarify: analysis.pointsToClarify, excluded_sensitive_criteria: analysis.excludedSensitiveCriteria,
      source_text: [freeText, ...readyDocuments.map((document) => document.text)].filter(Boolean).join("\n\n").slice(0, 120_000) || null,
      source_names: readyDocuments.map((document) => document.name), analysis,
    }).select("id").single();
    if (error || !data) {
      const planLimit = error?.message?.includes("plan_active_offer_limit_reached");
      const inactivePlan = error?.message?.includes("plan_access_inactive");
      setMessage(planLimit ? "Le plan Free permet un recrutement actif. Clôturez l’offre actuelle ou passez à Essentiel." : inactivePlan ? "La période d’accès est terminée. Renouvelez le plan avant de créer une offre." : error?.code === "PGRST205" ? "Le module Offres doit être activé pour votre organisation." : "L’offre n’a pas pu être enregistrée. Réessayez.");
      setSaving(false); return;
    }
    void trackProductEvent("offer_created", { offer_id: data.id, status: publicationStatus, document_count: readyDocuments.length, has_free_text: Boolean(freeText.trim()) });
    router.push(`/dashboard/offres/${data.id}?created=1`); router.refresh();
  }

  return <div className="offer-create-flow">
    <form className="offer-source-card" onSubmit={analyse}>
      <div className="offer-section-heading"><span><FileText size={20} /></span><div><small>Étape 1</small><h2>Décrivez le besoin sous toutes ses formes</h2><p>Remplissez les champs utiles, joignez une fiche existante ou racontez simplement le contexte.</p></div></div>
      <div className="offer-fields-grid">
        <label className="is-wide"><span>Intitulé du poste</span><input value={fields.title} onChange={(event) => updateField("title", event.target.value)} placeholder="Ex. Responsable commercial B2B" /></label>
        <label><span>Équipe ou département</span><input value={fields.department} onChange={(event) => updateField("department", event.target.value)} placeholder="Ex. Développement commercial" /></label>
        <label><span>Nombre de recrutements</span><input type="number" min="1" max="500" value={fields.headcount} onChange={(event) => updateField("headcount", event.target.value)} /></label>
      </div>
      <details className="offer-optional-fields">
        <summary><span>Ajouter les conditions du poste</span><small>Contrat, lieu, date et salaire · facultatif</small></summary>
        <div className="offer-fields-grid">
          <label><span>Type de contrat</span><select value={fields.contractType} onChange={(event) => updateField("contractType", event.target.value)}><option value="">À définir</option><option value="permanent">CDI</option><option value="fixed_term">CDD</option><option value="internship">Stage</option><option value="freelance">Freelance</option><option value="temporary">Intérim</option><option value="apprenticeship">Alternance</option><option value="other">Autre</option></select></label>
          <label><span>Mode de travail</span><select value={fields.workMode} onChange={(event) => updateField("workMode", event.target.value)}><option value="">À définir</option><option value="onsite">Sur site</option><option value="hybrid">Hybride</option><option value="remote">Télétravail</option></select></label>
          <label><span>Localisation</span><input value={fields.location} onChange={(event) => updateField("location", event.target.value)} placeholder="Ville, pays ou zone" /></label>
          <label><span>Date de prise de poste souhaitée</span><input type="date" value={fields.targetStartDate} onChange={(event) => updateField("targetStartDate", event.target.value)} /></label>
          <fieldset className="is-wide offer-salary-group"><legend>Fourchette salariale</legend><div className="offer-salary-fields"><label><span className="sr-only">Salaire minimum</span><input type="number" min="0" value={fields.salaryMin} onChange={(event) => updateField("salaryMin", event.target.value)} placeholder="Minimum" /></label><label><span className="sr-only">Salaire maximum</span><input type="number" min="0" value={fields.salaryMax} onChange={(event) => updateField("salaryMax", event.target.value)} placeholder="Maximum" /></label><label><span className="sr-only">Devise</span><input value={fields.salaryCurrency} maxLength={8} onChange={(event) => updateField("salaryCurrency", event.target.value.toUpperCase())} /></label><label><span className="sr-only">Période salariale</span><select value={fields.salaryPeriod} onChange={(event) => updateField("salaryPeriod", event.target.value)}><option value="month">par mois</option><option value="year">par an</option></select></label></div></fieldset>
        </div>
      </details>

      <div className="offer-input-sources">
        <div className={`offer-doc-drop${dragging ? " is-dragging" : ""}`} onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }}>
          <input ref={fileRef} hidden type="file" multiple accept={ACCEPTED_CV_EXTENSIONS} onChange={handleFiles} />
          <UploadCloud size={24} /><div><strong>Joindre une fiche de poste</strong><p>PDF, DOCX, TXT ou MD · jusqu’à 5 documents</p></div><button type="button" onClick={() => fileRef.current?.click()}>Choisir</button>
        </div>
        {documents.length > 0 && <div className="offer-document-list">{documents.map((document) => <div className={`is-${document.status}`} key={document.id}><span>{document.status === "extracting" ? <LoaderCircle className="spin" size={17} /> : document.status === "ready" ? <FileCheck2 size={17} /> : <AlertCircle size={17} />}</span><div><strong>{document.name}</strong><small>{document.status === "extracting" ? "Lecture…" : document.status === "ready" ? "Prêt à analyser" : document.error}</small></div><button type="button" aria-label={`Retirer ${document.name}`} onClick={() => setDocuments((current) => current.filter((item) => item.id !== document.id))}><Trash2 size={16} /></button></div>)}</div>}
        <label className="offer-free-text"><span>Contexte et intention du recrutement</span><textarea rows={8} maxLength={60_000} value={freeText} onChange={(event) => setFreeText(event.target.value)} placeholder="Pourquoi recrutez-vous maintenant ? Quel problème cette personne devra-t-elle résoudre ? Qu’attendez-vous après 3 ou 6 mois ? Qu’est-ce qui est vraiment non négociable, et qu’est-ce qui peut s’apprendre ?" /><small>{freeText.length.toLocaleString("fr-FR")} / 60 000 caractères</small></label>
      </div>
      {message && !analysis && <div className="form-message form-error" role="alert"><AlertCircle size={18} />{message}</div>}
      <div className="offer-analyse-action"><div><strong>ZeRecruit organisera votre intention</strong><span>Vous vérifierez tout avant la création de l’offre.</span></div><button className="button button-primary" disabled={analysing || extracting} type="submit">{analysing ? <><LoaderCircle className="spin" size={18} /> Analyse de l’offre…</> : <><Sparkles size={18} /> Analyser et structurer</>}</button></div>
    </form>

    {analysis && <section className="offer-review-card" id="offer-review">
      <div className="offer-section-heading"><span><Check size={20} /></span><div><small>Étape 2</small><h2>Validez l’intention avant de chercher</h2><p>Corrigez librement les critères. Le matching utilisera exactement cette version.</p></div></div>
      {analysis.excludedSensitiveCriteria.length > 0 && <div className="offer-sensitive-warning"><AlertCircle size={18} /><p>Des critères personnels ont été écartés. Seules les informations professionnelles seront utilisées.</p></div>}
      <div className="offer-review-grid">
        <label className="is-wide"><span>Intitulé</span><input value={analysis.title} onChange={(event) => setAnalysis({ ...analysis, title: event.target.value })} /></label>
        <label className="is-wide"><span>Résumé de l’offre</span><textarea rows={3} value={analysis.summary || ""} onChange={(event) => setAnalysis({ ...analysis, summary: event.target.value || null })} /></label>
        <label className="is-wide"><span>Mission principale</span><textarea rows={4} value={analysis.mission || ""} onChange={(event) => setAnalysis({ ...analysis, mission: event.target.value || null })} /></label>
        <label><span>Compétences indispensables</span><textarea rows={6} value={analysis.mustHaveSkills.join("\n")} onChange={(event) => setAnalysis({ ...analysis, mustHaveSkills: list(event.target.value) })} /></label>
        <label><span>Atouts souhaités</span><textarea rows={6} value={analysis.niceToHaveSkills.join("\n")} onChange={(event) => setAnalysis({ ...analysis, niceToHaveSkills: list(event.target.value) })} /></label>
        <label><span>Responsabilités</span><textarea rows={6} value={analysis.responsibilities.join("\n")} onChange={(event) => setAnalysis({ ...analysis, responsibilities: list(event.target.value) })} /></label>
        <label><span>Résultats attendus</span><textarea rows={6} value={analysis.successOutcomes.join("\n")} onChange={(event) => setAnalysis({ ...analysis, successOutcomes: list(event.target.value) })} /></label>
        <label className="is-wide"><span>Intention profonde du recruteur</span><textarea rows={4} value={analysis.recruiterIntent || ""} onChange={(event) => setAnalysis({ ...analysis, recruiterIntent: event.target.value || null })} /></label>
        <label><span>Langues</span><input value={analysis.languages.join(", ")} onChange={(event) => setAnalysis({ ...analysis, languages: list(event.target.value) })} /></label>
        <label><span>Secteurs</span><input value={analysis.industries.join(", ")} onChange={(event) => setAnalysis({ ...analysis, industries: list(event.target.value) })} /></label>
        <label><span>Expérience minimale</span><div className="offer-input-suffix"><input type="number" min="0" max="60" step="0.5" value={analysis.minExperienceMonths === null ? "" : analysis.minExperienceMonths / 12} onChange={(event) => setAnalysis({ ...analysis, minExperienceMonths: event.target.value ? Math.round(Number(event.target.value) * 12) : null })} /><b>ans</b></div></label>
        <label><span>Formation souhaitée</span><input value={analysis.education || ""} onChange={(event) => setAnalysis({ ...analysis, education: event.target.value || null })} /></label>
      </div>
      {analysis.pointsToClarify.length > 0 && <div className="offer-clarify"><strong>Points à préciser plus tard</strong><ul>{analysis.pointsToClarify.map((point) => <li key={point}>{point}</li>)}</ul></div>}
      {message && <div className="form-message form-error" role="alert"><AlertCircle size={18} />{message}</div>}
      <div className="offer-save-bar"><label><span>Après création</span><select value={publicationStatus} onChange={(event) => setPublicationStatus(event.target.value as "draft" | "open")}><option value="open">Ouvrir le recrutement</option><option value="draft">Conserver en brouillon</option></select></label><button className="button button-primary" type="button" disabled={saving || analysis.title.trim().length < 2} onClick={saveOffer}>{saving ? <><LoaderCircle className="spin" size={18} /> Création…</> : <><Check size={18} /> Créer l’offre</>}</button></div>
    </section>}
  </div>;
}
