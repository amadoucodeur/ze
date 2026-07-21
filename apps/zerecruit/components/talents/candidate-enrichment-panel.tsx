"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  FilePlus2,
  FileText,
  LoaderCircle,
  Sparkles,
  Trash2,
} from "lucide-react";
import { trackProductEvent } from "@/lib/analytics/client";
import { ACCEPTED_CV_EXTENSIONS, extractCvFile } from "@/lib/cv/client-extraction";
import {
  CV_ENRICHMENT_FILE_LIMIT,
  CV_ENRICHMENT_TEXT_MIN_LENGTH,
  CV_ENRICHMENT_TEXT_MAX_LENGTH,
  type CvImportItem,
  type CvProcessingMetrics,
} from "@/lib/cv/schema";

type StagedDocument = Partial<CvImportItem> & {
  clientId: string;
  sourceName: string;
  status: "extracting" | "ready" | "error";
  error?: string;
  extractionMessage?: string;
  ocrUsed?: boolean;
};

type EnrichmentStage = "idle" | "parsing" | "embedding" | "saving" | "complete" | "error";

const stageLabels: Record<EnrichmentStage, string> = {
  idle: "Prêt",
  parsing: "Lecture",
  embedding: "Fusion",
  saving: "Actualisation",
  complete: "Terminé",
  error: "À reprendre",
};

type EnrichmentJob = {
  id: string;
  status: "queued" | "processing" | "retry_wait" | "completed" | "failed" | "cancelled";
  progress_step: "queued" | "parsing" | "embedding" | "saving" | "completed" | "retry_wait" | "failed";
  progress_message: string;
  attempt_count: number;
  max_attempts: number;
  last_error?: string | null;
  result: Record<string, unknown>;
};

const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

export function CandidateEnrichmentPanel({
  candidateId,
  candidateName,
  onComplete,
}: {
  candidateId: string;
  candidateName: string;
  onComplete: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<StagedDocument[]>([]);
  const [manualText, setManualText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<EnrichmentStage>("idle");
  const [stageMessage, setStageMessage] = useState("Ajoutez un texte ou des documents pour compléter ce profil.");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const readyDocuments = documents.filter(
    (document): document is StagedDocument & CvImportItem =>
      document.status === "ready" && Boolean(document.text && document.sourceType),
  );
  const totalLength = manualText.trim().length
    + readyDocuments.reduce((total, document) => total + document.text.length, 0);
  const extracting = documents.some((document) => document.status === "extracting");
  const canSubmit = totalLength >= CV_ENRICHMENT_TEXT_MIN_LENGTH
    && totalLength <= CV_ENRICHMENT_TEXT_MAX_LENGTH
    && !extracting
    && !submitting;

  async function stageFiles(files: File[]) {
    if (submitting) return;
    setMessage(null);
    setStage("idle");
    const slots = CV_ENRICHMENT_FILE_LIMIT - documents.length;
    const selected = files.slice(0, Math.max(0, slots));
    if (selected.length < files.length) {
      setMessage(`Vous pouvez ajouter jusqu’à ${CV_ENRICHMENT_FILE_LIMIT} documents à cette actualisation.`);
    }
    if (!selected.length) return;

    const pending = selected.map((file) => ({
      clientId: crypto.randomUUID(),
      sourceName: file.name,
      status: "extracting" as const,
    }));
    setDocuments((current) => [...current, ...pending]);

    await Promise.all(selected.map(async (file, index) => {
      const clientId = pending[index].clientId;
      try {
        const extracted = await extractCvFile(file, (progress) => setDocuments((current) => current.map((document) => document.clientId === clientId ? { ...document, extractionMessage: progress.message } : document)));
        setDocuments((current) => current.map((document) => document.clientId === clientId
          ? { ...document, ...extracted, status: "ready" }
          : document));
      } catch (error) {
        setDocuments((current) => current.map((document) => document.clientId === clientId
          ? {
              ...document,
              status: "error",
              error: error instanceof Error ? error.message : "Ce document n’a pas pu être lu.",
            }
          : document));
      }
    }));
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    void stageFiles(Array.from(event.target.files || []));
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void stageFiles(Array.from(event.dataTransfer.files));
  }

  async function submitEnrichment() {
    setMessage(null);
    if (extracting) {
      setMessage("Attendez la fin de la lecture des documents avant de continuer.");
      return;
    }
    if (totalLength < CV_ENRICHMENT_TEXT_MIN_LENGTH) {
      setMessage("Ajoutez une information plus précise ou un document exploitable.");
      return;
    }
    if (totalLength > CV_ENRICHMENT_TEXT_MAX_LENGTH) {
      setMessage("L’ensemble est trop volumineux. Retirez un document ou raccourcissez le texte.");
      return;
    }

    setSubmitting(true);
    setElapsedSeconds(0);
    setStage("parsing");
    setStageMessage("Placement dans la file d’analyse…");
    const startedAt = Date.now();
    let accepted = false;
    try {
      const response = await fetch(`/api/talents/${candidateId}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualText: manualText.trim(),
          items: readyDocuments.map((document) => ({
            clientId: document.clientId,
            sourceName: document.sourceName,
            sourceType: document.sourceType,
            text: document.text,
          })),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || "L’actualisation n’a pas pu démarrer.");
      }
      const payload = await response.json() as { job: EnrichmentJob };
      if (!payload.job?.id) throw new Error("La file d’analyse n’a pas confirmé l’actualisation.");
      accepted = true;
      let job = payload.job;
      let trackingErrors = 0;
      while (!["completed", "failed", "cancelled"].includes(job.status)) {
        const nextStage: EnrichmentStage = job.progress_step === "embedding" ? "embedding" : job.progress_step === "saving" ? "saving" : "parsing";
        setStage(nextStage);
        setStageMessage(job.status === "retry_wait" ? `${job.progress_message} Tentative ${job.attempt_count + 1} sur ${job.max_attempts}.` : job.progress_message);
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
        await wait(2_500);
        try {
          const trackingResponse = await fetch(`/api/talents/import/jobs?ids=${job.id}`, { cache: "no-store" });
          if (!trackingResponse.ok) throw new Error("Suivi indisponible");
          const tracking = await trackingResponse.json() as { jobs: EnrichmentJob[] };
          if (tracking.jobs[0]) job = tracking.jobs[0];
          trackingErrors = 0;
        } catch {
          trackingErrors += 1;
          if (trackingErrors >= 5) throw new Error("L’actualisation continue en arrière-plan. Vous pouvez fermer cette page et revenir sur le profil plus tard.");
        }
      }
      if (job.status !== "completed") throw new Error(job.last_error || "Le profil n’a pas pu être actualisé après plusieurs tentatives.");
      const metrics = (job.result.metrics || {}) as CvProcessingMetrics;
      setStage("complete");
      setStageMessage(`Le profil de ${String(job.result.fullname || candidateName)} est à jour.`);
      void trackProductEvent("candidate_enrichment_completed", {
        candidate_id: candidateId,
        document_count: readyDocuments.length,
        has_manual_text: manualText.trim().length > 0,
        duration_ms: Date.now() - startedAt,
        parser_ms: metrics.parserDurationMs || 0,
        parser_retry_count: Math.max(0, (metrics.parserAttempts || 1) - 1),
        embedding_ms: metrics.embeddingDurationMs || 0,
        saving_ms: metrics.savingDurationMs || 0,
        input_characters: metrics.inputCharacters || totalLength,
        chunk_count: metrics.chunkCount || 0,
      });
      setDocuments([]);
      setManualText("");
      onComplete();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Le profil n’a pas pu être actualisé. Réessayez.";
      setStage(accepted && text.includes("continue en arrière-plan") ? "parsing" : "error");
      setStageMessage(text);
      setMessage(text);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <details className="settings-card candidate-enrichment-card">
      <summary>
        <span className="settings-icon settings-icon-soft"><Sparkles size={20} /></span>
        <span><strong>Informations additionnelles</strong><small>Ajoutez une expérience, une certification ou un nouveau document.</small></span>
        <ChevronDown className="candidate-enrichment-chevron" size={20} aria-hidden="true" />
      </summary>

      <div className="candidate-enrichment-body" aria-busy={submitting}>
        <p className="candidate-enrichment-note">L’analyse part du profil actuellement enregistré de {candidateName}. Enregistrez d’abord les corrections saisies au-dessus si vous souhaitez les inclure.</p>

        <label className="settings-field">
          <span>Texte à ajouter</span>
          <textarea
            className="cv-manual-textarea"
            rows={7}
            value={manualText}
            disabled={submitting}
            maxLength={CV_ENRICHMENT_TEXT_MAX_LENGTH}
            placeholder="Ex. Nouvelle mission depuis janvier 2026, certification obtenue, précision sur une compétence…"
            onChange={(event) => {
              setManualText(event.target.value);
              setMessage(null);
              setStage("idle");
            }}
          />
        </label>

        <div
          className={`candidate-enrichment-dropzone${dragging ? " is-dragging" : ""}`}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_CV_EXTENSIONS}
            multiple
            disabled={submitting || documents.length >= CV_ENRICHMENT_FILE_LIMIT}
            onChange={handleFiles}
            tabIndex={-1}
            aria-hidden="true"
          />
          <span className="candidate-enrichment-file-icon" aria-hidden="true"><FilePlus2 size={22} /></span>
          <div><strong>Ajouter des documents</strong><p>PDF, image, DOCX, TXT ou MD · jusqu’à 5 fichiers</p></div>
          <button className="button button-secondary" type="button" disabled={submitting || documents.length >= CV_ENRICHMENT_FILE_LIMIT} onClick={() => fileInputRef.current?.click()}>
            Choisir
          </button>
        </div>

        {documents.length > 0 && (
          <div className="candidate-enrichment-files" aria-live="polite">
            {documents.map((document) => (
              <article className={`candidate-enrichment-file is-${document.status}`} key={document.clientId}>
                <span aria-hidden="true">{document.status === "extracting" ? <LoaderCircle className="spin" size={18} /> : document.status === "ready" ? <FileCheck2 size={18} /> : <AlertCircle size={18} />}</span>
                <div><strong>{document.sourceName}</strong><small>{document.status === "extracting" ? document.extractionMessage || "Lecture du document…" : document.status === "ready" ? document.ocrUsed ? "Texte reconnu · prêt à analyser" : "Prêt à analyser" : document.error}</small></div>
                <button type="button" disabled={submitting} aria-label={`Retirer ${document.sourceName}`} onClick={() => setDocuments((current) => current.filter((item) => item.clientId !== document.clientId))}><Trash2 size={17} /></button>
              </article>
            ))}
          </div>
        )}

        {(submitting || stage !== "idle") && (
          <div className={`candidate-enrichment-progress is-${stage}`} role="status">
            <span className="sr-only" aria-live="polite">{stageMessage}</span>
            <span className="candidate-enrichment-progress-icon" aria-hidden="true">
              {stage === "complete" ? <CheckCircle2 size={21} /> : stage === "error" ? <AlertCircle size={21} /> : <Sparkles size={21} />}
            </span>
            <div><strong>{stageLabels[stage]}</strong><p>{stageMessage}{submitting && elapsedSeconds > 0 ? ` · ${elapsedSeconds} s` : ""}</p></div>
          </div>
        )}

        {message && <div className="form-message form-error" role="alert"><AlertCircle size={17} /> {message}</div>}
        {totalLength > CV_ENRICHMENT_TEXT_MAX_LENGTH && <div className="form-message form-error" role="alert"><AlertCircle size={17} /> L’ensemble dépasse 45 000 caractères. Retirez un document ou raccourcissez le texte.</div>}

        <div className="candidate-enrichment-actions">
          <span>
            <FileText size={15} />
            {totalLength < CV_ENRICHMENT_TEXT_MIN_LENGTH
              ? `Ajoutez encore ${CV_ENRICHMENT_TEXT_MIN_LENGTH - totalLength} caractère${CV_ENRICHMENT_TEXT_MIN_LENGTH - totalLength > 1 ? "s" : ""}`
              : `${totalLength.toLocaleString("fr-FR")} / ${CV_ENRICHMENT_TEXT_MAX_LENGTH.toLocaleString("fr-FR")} caractères`}
          </span>
          <button className="button button-secondary candidate-enrichment-submit" type="button" disabled={!canSubmit} onClick={submitEnrichment}>
            {submitting ? <><LoaderCircle className="spin" size={18} /> Actualisation…</> : <><Sparkles size={18} /> Analyser et actualiser</>}
          </button>
        </div>
      </div>
    </details>
  );
}
