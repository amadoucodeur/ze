"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  AtSign,
  BriefcaseBusiness,
  Building2,
  Check,
  FileText,
  Gauge,
  Languages,
  Link2,
  LoaderCircle,
  MapPin,
  Pencil,
  Phone,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import {
  archiveTalentAction,
  deleteTalentAction,
  restoreTalentAction,
  updateTalentAction,
  type TalentState,
} from "@/app/actions/talents";
import { CandidateEnrichmentPanel } from "@/components/talents/candidate-enrichment-panel";

export type TalentProfileData = {
  id: string;
  fullname: string;
  posteType: string | null;
  localisation: string | null;
  summary: string | null;
  statut: string | null;
  salaryValue: Record<string, unknown>;
  performanceScore: number | null;
  performance: Record<string, unknown>;
  archivedAt: string | null;
  createdBy: { id: string; fullname: string } | null;
  createdAt: string;
  source: string | null;
  processingStatus: "indexing" | "ready" | "failed";
  contacts: { email?: string; phone?: string; linkedin?: string };
  industries: string[];
  pointsAttention: string[];
  skills: Array<{
    id: string;
    name: string;
    importance: string | null;
    expertise: string | null;
    source: string | null;
    score: number | null;
    months: number | null;
    industry: string | null;
  }>;
  languages: Array<{ id: string; name: string; level: string | null }>;
  formations: Array<{
    id: string;
    name: string;
    institutionName: string | null;
    issuerDate: string | null;
    type: string | null;
    fieldOfStudy: string | null;
    address: string | null;
    description: string | null;
    startDate: string | null;
    endDate: string | null;
    confidenceScore: number | null;
  }>;
};

const initialState: TalentState = {};

export const availabilityLabels: Record<string, string> = {
  available: "Disponible",
  employed: "En poste",
  open_to_opportunities: "À l’écoute d’opportunités",
  freelance: "Freelance",
  student: "En formation",
  unavailable: "Indisponible",
  unknown: "Disponibilité à confirmer",
};

const expertiseLabels: Record<string, string> = {
  Beginner: "Débutant",
  Junior: "Junior",
  Intermediate: "Intermédiaire",
  Advanced: "Avancé",
  Expert: "Expert",
};

const scoreLabels = [
  ["completeness", "Complétude du profil"],
  ["experience", "Expérience documentée"],
  ["expertise", "Maîtrise des compétences"],
  ["education", "Formation et certifications"],
  ["marketReadiness", "Lisibilité sur le marché"],
] as const;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function scoreValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatSalary(value: Record<string, unknown>) {
  const from = typeof value.from === "number" ? value.from : Number(value.from);
  const to = typeof value.to === "number" ? value.to : Number(value.to);
  const currency = typeof value.currency === "string" ? value.currency : "";
  if (!Number.isFinite(from) || !Number.isFinite(to) || !currency) return null;
  const formatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  return `${formatter.format(from)} – ${formatter.format(to)} ${currency}`;
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="talent-score-row">
      <div><span>{label}</span><strong>{value === null ? "—" : `${value}%`}</strong></div>
      <div className="talent-score-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
        <span style={{ width: `${value ?? 0}%` }} />
      </div>
    </div>
  );
}

function ArchiveSubmitButton({ restore }: { restore: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={17} /> : restore ? <ArchiveRestore size={17} /> : <Archive size={17} />}{pending ? "Mise à jour…" : restore ? "Restaurer le profil" : "Archiver le profil"}</button>;
}

export function TalentProfile({
  candidate,
  canEdit,
  justCreated,
  justUpdated,
  justEnriched,
  justArchived,
  justRestored,
  actionError,
}: {
  candidate: TalentProfileData;
  canEdit: boolean;
  justCreated: boolean;
  justUpdated: boolean;
  justEnriched: boolean;
  justArchived: boolean;
  justRestored: boolean;
  actionError?: string;
}) {
  const router = useRouter();
  const updateAction = updateTalentAction.bind(null, candidate.id);
  const deleteAction = deleteTalentAction.bind(null, candidate.id);
  const [state, formAction, pending] = useActionState(updateAction, initialState);
  const [deleteState, deleteFormAction, deletePending] = useActionState(deleteAction, initialState);
  const [editing, setEditing] = useState(false);
  const [indexReady, setIndexReady] = useState(false);
  const [retryingIndex, setRetryingIndex] = useState(false);
  const [indexError, setIndexError] = useState("");
  const status = availabilityLabels[candidate.statut || "unknown"] || "Disponibilité à confirmer";
  const overallScore = scoreValue(candidate.performanceScore ?? candidate.performance.overall);
  const salary = formatSalary(candidate.salaryValue);
  const salaryConfidence = scoreValue(candidate.salaryValue.confidence);
  const strengths = stringArray(candidate.performance.strengths);
  const considerations = stringArray(candidate.performance.considerations);
  const evidence = stringArray(candidate.performance.evidence);
  const processingStatus = indexReady ? "ready" : candidate.processingStatus;

  useEffect(() => {
    if (processingStatus !== "indexing") return;
    const interval = window.setInterval(() => router.refresh(), 4_000);
    return () => window.clearInterval(interval);
  }, [processingStatus, router]);

  async function retryIndexing() {
    setRetryingIndex(true);
    setIndexError("");
    try {
      const response = await fetch(`/api/talents/${candidate.id}/index`, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(payload.message || "La préparation n’a pas pu être relancée.");
      setIndexReady(true);
      router.refresh();
    } catch (error) {
      setIndexError(error instanceof Error ? error.message : "La préparation n’a pas pu être relancée.");
    } finally {
      setRetryingIndex(false);
    }
  }

  if (editing) {
    return (
      <div className="talent-profile-edit-layout">
        <form action={formAction} className="talent-profile-edit settings-form">
          <div className="settings-card talent-edit-card">
          <div className="settings-card-heading"><span className="settings-icon"><Pencil size={19} /></span><div><h2>Modifier le profil</h2><p>Corrigez les informations factuelles. Les indicateurs IA restent séparés et transparents.</p></div></div>
          <div className="settings-fields-grid">
            <label className="settings-field settings-field-wide"><span>Nom complet</span><div className="settings-input"><UserRound size={18} /><input name="fullname" defaultValue={candidate.fullname} required maxLength={120} /></div>{state.errors?.fullname?.map((error) => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field"><span>Poste ou expertise</span><div className="settings-input"><BriefcaseBusiness size={18} /><input name="posteType" defaultValue={candidate.posteType || ""} maxLength={120} /></div>{state.errors?.posteType?.map((error) => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field"><span>Localisation</span><div className="settings-input"><MapPin size={18} /><input name="localisation" defaultValue={candidate.localisation || ""} maxLength={120} /></div>{state.errors?.localisation?.map((error) => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field"><span>Email</span><div className="settings-input"><AtSign size={18} /><input name="email" type="email" defaultValue={candidate.contacts.email || ""} /></div>{state.errors?.email?.map((error) => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field"><span>Téléphone</span><div className="settings-input"><Phone size={18} /><input name="phone" type="tel" defaultValue={candidate.contacts.phone || ""} maxLength={30} /></div>{state.errors?.phone?.map((error) => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field settings-field-wide"><span>Profil LinkedIn</span><div className="settings-input"><Link2 size={18} /><input name="linkedin" defaultValue={candidate.contacts.linkedin || ""} maxLength={500} placeholder="https://linkedin.com/in/…" /></div>{state.errors?.linkedin?.map((error) => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field"><span>Disponibilité professionnelle</span><div className="settings-input"><Sparkles size={18} /><select name="statut" defaultValue={candidate.statut || "unknown"}><option value="available">Disponible</option><option value="employed">En poste</option><option value="open_to_opportunities">À l’écoute d’opportunités</option><option value="freelance">Freelance</option><option value="student">En formation</option><option value="unavailable">Indisponible</option><option value="unknown">À confirmer</option></select></div>{state.errors?.statut?.map((error) => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field"><span>Secteurs</span><div className="settings-input"><Building2 size={18} /><input name="industries" defaultValue={candidate.industries.join(", ")} maxLength={1000} placeholder="Technologie, Finance…" /></div><small className="settings-hint">Séparez les secteurs par des virgules.</small>{state.errors?.industries?.map((error) => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field settings-field-wide"><span>Résumé</span><textarea className="cv-manual-textarea" name="summary" defaultValue={candidate.summary || ""} maxLength={2000} rows={7} />{state.errors?.summary?.map((error) => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field settings-field-wide"><span>Points à clarifier</span><textarea className="cv-manual-textarea" name="pointsAttention" defaultValue={candidate.pointsAttention.join("\n")} maxLength={2000} rows={4} /><small className="settings-hint">Un point professionnel à vérifier par ligne.</small>{state.errors?.pointsAttention?.map((error) => <small className="field-error" key={error}>{error}</small>)}</label>
          </div>
          </div>
          {state.message && <div className="form-message form-error" role="alert"><AlertCircle size={17} /> {state.message}</div>}
          <div className="settings-actions settings-actions-sticky talent-edit-actions"><button className="button button-secondary" type="button" disabled={pending} onClick={() => setEditing(false)}><X size={17} /> Annuler</button><button className="button button-primary" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={18} /> Enregistrement…</> : <><Save size={18} /> Enregistrer</>}</button></div>
        </form>
        {candidate.archivedAt ? (
          <div className="settings-card candidate-enrichment-unavailable">
            <span className="settings-icon settings-icon-soft"><Archive size={20} /></span>
            <div><strong>Informations additionnelles indisponibles</strong><p>Restaurez ce profil avant d’analyser de nouveaux documents.</p></div>
          </div>
        ) : (
          <CandidateEnrichmentPanel
            candidateId={candidate.id}
            candidateName={candidate.fullname}
            onComplete={() => {
              setEditing(false);
              router.replace(`/dashboard/talents/${candidate.id}?enriched=1`);
              router.refresh();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="talent-profile-view">
      {(justCreated || justUpdated || justEnriched || justArchived || justRestored) && <div className="dashboard-success-banner" role="status"><Check size={20} /><div><strong>{justCreated ? processingStatus === "ready" ? "Profil créé et analysé" : "Profil créé" : justEnriched ? "Profil actualisé" : justUpdated ? "Modifications enregistrées" : justArchived ? "Profil archivé" : "Profil restauré"}</strong><p>{justArchived ? "Il est retiré du vivier actif mais reste récupérable." : justEnriched ? "Les informations additionnelles ont été intégrées au profil." : processingStatus === "ready" ? "Les informations sont à jour pour votre équipe." : "Les informations essentielles sont déjà disponibles."}</p></div></div>}
      {processingStatus === "indexing" && <div className="talent-index-banner" role="status"><LoaderCircle className="spin" size={20} /><div><strong>Le profil est disponible</strong><p>Sa préparation pour la recherche se termine en arrière-plan. Vous pouvez déjà le consulter et le modifier.</p></div></div>}
      {processingStatus === "failed" && <div className="talent-index-banner has-error" role="alert"><AlertCircle size={20} /><div><strong>Le profil est disponible, mais pas encore dans la recherche</strong><p>{indexError || "Relancez uniquement sa préparation, sans analyser à nouveau le CV."}</p>{canEdit && <button className="button button-secondary" type="button" disabled={retryingIndex} onClick={retryIndexing}>{retryingIndex ? <><LoaderCircle className="spin" size={17} /> Préparation…</> : <><Sparkles size={17} /> Relancer la préparation</>}</button>}</div></div>}
      {actionError && <div className="form-message form-error" role="alert"><AlertCircle size={18} /> L’action n’a pas abouti. Réessayez depuis ce profil.</div>}
      {candidate.archivedAt && <div className="talent-archive-banner"><Archive size={18} /><div><strong>Profil archivé</strong><span>Conservé hors du vivier actif depuis le {new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(candidate.archivedAt))}.</span></div></div>}

      <section className="talent-profile-hero">
        <div className="talent-profile-avatar">{initials(candidate.fullname)}</div>
        <div className="talent-profile-identity"><span>{status}</span><h1>{candidate.fullname}</h1><p>{candidate.posteType || "Expertise à compléter"}{candidate.localisation ? ` · ${candidate.localisation}` : ""}</p>{candidate.createdBy && <small><UserRound size={14} /> Ajouté par {candidate.createdBy.fullname}</small>}</div>
        {canEdit && <div className="talent-hero-actions"><button className="button button-primary" type="button" onClick={() => setEditing(true)}><Pencil size={17} /> Modifier</button><details className="talent-actions-menu"><summary aria-label="Autres actions">•••</summary><div>{candidate.archivedAt ? <form action={restoreTalentAction.bind(null, candidate.id)}><ArchiveSubmitButton restore /></form> : <form action={archiveTalentAction.bind(null, candidate.id)}><ArchiveSubmitButton restore={false} /></form>}</div></details></div>}
      </section>

      <section className="talent-performance-card" aria-labelledby="performance-title">
        <div className="talent-performance-score"><span><Gauge size={20} /> Profil professionnel</span><strong>{overallScore === null ? "—" : overallScore}<small>{overallScore === null ? "" : "%"}</small></strong><p>Lecture des éléments documentés dans le CV, pas une décision de recrutement.</p></div>
        <div className="talent-performance-bars"><h2 id="performance-title">Détail de l’analyse</h2>{scoreLabels.map(([key, label]) => <ScoreBar key={key} label={label} value={scoreValue(candidate.performance[key])} />)}</div>
        <div className="talent-salary-card"><span><WalletCards size={19} /> Fourchette indicative</span>{salary ? <><strong>{salary}</strong><small>par {candidate.salaryValue.period === "year" ? "an" : "mois"}{salaryConfidence === null ? "" : ` · confiance ${salaryConfidence}%`}</small><p>{typeof candidate.salaryValue.rationale === "string" ? candidate.salaryValue.rationale : "Estimation fondée sur les éléments professionnels disponibles."}</p></> : <><strong>À estimer</strong><p>Le CV ne fournit pas encore assez de contexte marché.</p></>}</div>
      </section>

      <div className="talent-profile-layout">
        <main className="talent-profile-main">
          <section className="talent-profile-section"><div className="talent-profile-section-heading"><FileText size={19} /><h2>À propos</h2></div><p className={candidate.summary ? "" : "is-empty"}>{candidate.summary || "Aucun résumé pour le moment. Modifiez le profil pour ajouter les informations importantes."}</p></section>
          {(strengths.length > 0 || evidence.length > 0 || considerations.length > 0) && <section className="talent-profile-section talent-insights-section"><div className="talent-profile-section-heading"><TrendingUp size={19} /><h2>Lecture du profil</h2></div><div className="talent-insight-columns">{strengths.length > 0 && <div><h3>Points forts documentés</h3><ul>{strengths.map((item) => <li key={item}><Check size={15} />{item}</li>)}</ul></div>}{evidence.length > 0 && <div><h3>Éléments probants</h3><ul>{evidence.map((item) => <li key={item}><ShieldCheck size={15} />{item}</li>)}</ul></div>}{considerations.length > 0 && <div><h3>À approfondir</h3><ul>{considerations.map((item) => <li key={item}><AlertCircle size={15} />{item}</li>)}</ul></div>}</div></section>}
          <section className="talent-profile-section"><div className="talent-profile-section-heading"><Sparkles size={19} /><h2>Compétences</h2><span>{candidate.skills.length}</span></div>{candidate.skills.length ? <><div className="talent-skill-grid">{candidate.skills.slice(0, 12).map((skill) => <article key={skill.id}><div><strong>{skill.name}</strong>{scoreValue(skill.score) !== null && <b>{scoreValue(skill.score)}%</b>}</div><span>{skill.expertise ? expertiseLabels[skill.expertise] || skill.expertise : "Niveau à confirmer"}{skill.importance ? ` · ${skill.importance}` : ""}</span>{scoreValue(skill.score) !== null && <div className="talent-mini-score"><span style={{ width: `${scoreValue(skill.score)}%` }} /></div>}{skill.industry && <small>{skill.industry}</small>}</article>)}</div>{candidate.skills.length > 12 && <details className="talent-more-skills"><summary>Voir les {candidate.skills.length - 12} autres compétences</summary><div className="talent-tag-list">{candidate.skills.slice(12).map((skill) => <span key={skill.id}>{skill.name}</span>)}</div></details>}</> : <p className="is-empty">Aucune compétence renseignée.</p>}</section>
          {candidate.formations.length > 0 && <section className="talent-profile-section"><div className="talent-profile-section-heading"><BriefcaseBusiness size={19} /><h2>Formations</h2></div><div className="talent-timeline">{candidate.formations.map((formation) => <article key={formation.id}><span /><div><strong>{formation.name}</strong>{formation.institutionName && <p className="talent-institution">{formation.institutionName}</p>}<p>{formation.fieldOfStudy || formation.description || "Détail à compléter"}</p>{(formation.issuerDate || formation.startDate || formation.endDate || formation.address) && <small>{[formation.issuerDate ? `Obtenu le ${formation.issuerDate}` : null, formation.startDate, formation.endDate, formation.address].filter(Boolean).join(" · ")}</small>}</div></article>)}</div></section>}
        </main>

        <aside className="talent-profile-side">
          <section className="talent-profile-section talent-contact-section"><h2>Coordonnées</h2>{candidate.contacts.email && <a href={`mailto:${candidate.contacts.email}`}><AtSign size={17} /><span><small>Email</small><strong>{candidate.contacts.email}</strong></span></a>}{candidate.contacts.phone && <a href={`tel:${candidate.contacts.phone}`}><Phone size={17} /><span><small>Téléphone</small><strong>{candidate.contacts.phone}</strong></span></a>}{candidate.contacts.linkedin && <a href={candidate.contacts.linkedin} target="_blank" rel="noreferrer"><Link2 size={17} /><span><small>LinkedIn</small><strong>Voir le profil</strong></span></a>}{!candidate.contacts.email && !candidate.contacts.phone && !candidate.contacts.linkedin && <p className="is-empty">Aucune coordonnée disponible.</p>}</section>
          {candidate.languages.length > 0 && <section className="talent-profile-section"><div className="talent-profile-section-heading"><Languages size={19} /><h2>Langues</h2></div><div className="talent-language-list">{candidate.languages.map((language) => <div key={language.id}><strong>{language.name}</strong><span>{language.level || "Niveau à confirmer"}</span></div>)}</div></section>}
          {candidate.industries.length > 0 && <section className="talent-profile-section"><h2>Secteurs</h2><div className="talent-tag-list">{candidate.industries.map((industry) => <span key={industry}>{industry}</span>)}</div></section>}
          {candidate.pointsAttention.length > 0 && <section className="talent-profile-section talent-attention-section"><h2>À clarifier</h2><ul>{candidate.pointsAttention.map((point) => <li key={point}>{point}</li>)}</ul></section>}
          {canEdit && <details className="talent-danger-zone"><summary><Trash2 size={17} /> Supprimer le profil</summary><form action={deleteFormAction}><p>Cette action supprime définitivement le profil et toutes ses données analysées.</p><label><span>Recopiez « {candidate.fullname} »</span><input name="confirmation" autoComplete="off" required /></label>{deleteState.errors?.confirmation?.map((error) => <small className="field-error" key={error}>{error}</small>)}{deleteState.message && <div className="form-message form-error" role="alert">{deleteState.message}</div>}<button className="button button-danger" type="submit" disabled={deletePending}>{deletePending ? <><LoaderCircle className="spin" size={17} /> Suppression…</> : <><Trash2 size={17} /> Supprimer définitivement</>}</button></form></details>}
        </aside>
      </div>
    </div>
  );
}
