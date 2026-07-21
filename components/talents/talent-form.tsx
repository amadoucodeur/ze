"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  FileCheck2,
  FileText,
  Files,
  LoaderCircle,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { trackProductEvent } from "@/lib/analytics/client";
import { ACCEPTED_CV_EXTENSIONS, extractCvFile } from "@/lib/cv/client-extraction";
import {
  CV_IMPORT_LIMIT,
  CV_TEXT_MAX_LENGTH,
  CV_TEXT_MIN_LENGTH,
  type CvImportItem,
  type CvProcessingMetrics,
} from "@/lib/cv/schema";

type StagedCv = Partial<CvImportItem> & {
  clientId: string;
  sourceName: string;
  status: "extracting" | "ready" | "error";
  error?: string;
  analysisError?: string;
  extractionDurationMs?: number;
  extractionMessage?: string;
  extractionProgress?: number;
  ocrUsed?: boolean;
  ocrPageCount?: number;
};

type ApiResult =
  | { clientId: string; status: "success"; candidateId: string; fullname: string; metrics: CvProcessingMetrics; reused?: boolean }
  | { clientId: string; status: "error"; message: string };

type ProcessItem = {
  clientId: string;
  sourceName: string;
  stage: "queued" | "parsing" | "embedding" | "saving" | "complete" | "error";
  message: string;
  candidateId?: string;
};

type ProcessState = {
  total: number;
  completed: number;
  elapsedSeconds: number;
  announcement: string;
  items: Record<string, ProcessItem>;
};

type JobRecord = {
  id: string;
  client_reference: string;
  source_name: string;
  status: "queued" | "processing" | "retry_wait" | "completed" | "failed" | "cancelled";
  progress_step: "queued" | "parsing" | "embedding" | "saving" | "completed" | "retry_wait" | "failed";
  progress_message: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  candidat_id: string | null;
  result: Record<string, unknown>;
  created_at?: string;
};

const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

function jobStage(job: JobRecord): ProcessItem["stage"] {
  if (job.status === "completed") return "complete";
  if (job.status === "failed" || job.status === "cancelled") return "error";
  if (job.progress_step === "parsing" || job.progress_step === "embedding" || job.progress_step === "saving") return job.progress_step;
  return "queued";
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes} min${remainder ? ` ${remainder} s` : ""}`;
}

const processStageLabel: Record<ProcessItem["stage"], string> = {
  queued: "En attente",
  parsing: "Lecture",
  embedding: "Organisation",
  saving: "Finalisation",
  complete: "Terminé",
  error: "À reprendre",
};

export function TalentForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submissionStartedRef = useRef(false);
  const [items, setItems] = useState<StagedCv[]>([]);
  const [manualText, setManualText] = useState("");
  const [manualTitle, setManualTitle] = useState("CV saisi manuellement");
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [processState, setProcessState] = useState<ProcessState | null>(null);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    let timeout: number | undefined;
    async function recoverPendingJobs() {
      if (submissionStartedRef.current) return;
      try {
        const response = await fetch("/api/talents/import/jobs?active=1", { cache: "no-store" });
        if (!response.ok || !active) return;
        const payload = await response.json() as { jobs: JobRecord[] };
        if (!payload.jobs.length) return;
        const oldest = payload.jobs.reduce((value, job) => Math.min(value, new Date(job.created_at || Date.now()).getTime()), Date.now());
        setProcessState({
          total: payload.jobs.length,
          completed: 0,
          elapsedSeconds: Math.max(0, Math.floor((Date.now() - oldest) / 1_000)),
          announcement: "Reprise du suivi des analyses déjà en cours.",
          items: Object.fromEntries(payload.jobs.map((job) => [job.client_reference, {
            clientId: job.client_reference,
            sourceName: job.source_name,
            stage: jobStage(job),
            message: job.status === "retry_wait" ? `${job.progress_message} Tentative ${job.attempt_count + 1} sur ${job.max_attempts}.` : job.progress_message,
            candidateId: job.candidat_id || undefined,
          }])),
        });
        timeout = window.setTimeout(recoverPendingJobs, 3_000);
      } catch {
        timeout = window.setTimeout(recoverPendingJobs, 8_000);
      }
    }
    void recoverPendingJobs();
    return () => { active = false; if (timeout) window.clearTimeout(timeout); };
  }, []);

  const extracting = items.some((item) => item.status === "extracting");
  const readyItems = items.filter(
    (item): item is StagedCv & CvImportItem =>
      item.status === "ready" && Boolean(item.text && item.sourceType),
  );
  const hasManualText = manualText.trim().length >= CV_TEXT_MIN_LENGTH;
  const importCount = readyItems.length + (hasManualText ? 1 : 0);
  const remainingSlots = Math.max(0, CV_IMPORT_LIMIT - items.length - (hasManualText ? 1 : 0));

  async function stageFiles(files: File[]) {
    if (submitting) return;
    setMessage(null);
    const availableSlots = CV_IMPORT_LIMIT - items.length - (hasManualText ? 1 : 0);
    const selected = files.slice(0, Math.max(0, availableSlots));
    if (selected.length < files.length) {
      setMessage({ type: "error", text: `Vous pouvez analyser jusqu’à ${CV_IMPORT_LIMIT} CV à la fois.` });
    }
    if (!selected.length) return;

    const pending = selected.map((file) => ({
      clientId: crypto.randomUUID(),
      sourceName: file.name,
      status: "extracting" as const,
    }));
    setItems((current) => [...current, ...pending]);

    await Promise.all(
      selected.map(async (file, index) => {
        const clientId = pending[index].clientId;
        const extractionStartedAt = performance.now();
        try {
          const extracted = await extractCvFile(file, (progress) => {
            setItems((current) => current.map((item) => item.clientId === clientId ? {
              ...item,
              extractionMessage: progress.message,
              extractionProgress: progress.progress,
            } : item));
          });
          setItems((current) =>
            current.map((item) =>
              item.clientId === clientId
                ? { ...item, ...extracted, status: "ready", extractionDurationMs: Math.round(performance.now() - extractionStartedAt) }
                : item,
            ),
          );
        } catch (error) {
          setItems((current) =>
            current.map((item) =>
              item.clientId === clientId
                ? {
                    ...item,
                    status: "error",
                    error: error instanceof Error ? error.message : "Ce fichier n’a pas pu être lu.",
                  }
                : item,
            ),
          );
        }
      }),
    );
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

  function updateExtractedText(clientId: string, text: string) {
    setItems((current) =>
      current.map((item) =>
        item.clientId === clientId
          ? {
              ...item,
              text,
              status: text.trim().length >= CV_TEXT_MIN_LENGTH ? "ready" : "error",
              analysisError: undefined,
              error:
                text.trim().length >= CV_TEXT_MIN_LENGTH
                  ? undefined
                  : "Conservez au moins 40 caractères pour pouvoir analyser ce CV.",
            }
          : item,
      ),
    );
  }

  async function submitImport() {
    setMessage(null);
    if (extracting) {
      setMessage({ type: "error", text: "Attendez la fin de l’extraction locale avant de continuer." });
      return;
    }
    if (manualText.trim().length > 0 && !hasManualText) {
      setMessage({ type: "error", text: "Ajoutez au moins 40 caractères au texte saisi, ou effacez-le." });
      return;
    }

    const payloadItems: CvImportItem[] = readyItems.map((item) => ({
      clientId: item.clientId,
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      text: item.text,
    }));
    let manualId: string | null = null;
    if (hasManualText) {
      manualId = crypto.randomUUID();
      payloadItems.push({
        clientId: manualId,
        sourceName: manualTitle.trim() || "CV saisi manuellement",
        sourceType: "manual",
        text: manualText.trim(),
      });
    }
    if (!payloadItems.length) {
      setMessage({ type: "error", text: "Ajoutez au moins un CV ou collez son contenu pour continuer." });
      return;
    }

    setItems((current) => current.map((item) => ({ ...item, analysisError: undefined })));

    setProcessState({
      total: payloadItems.length,
      completed: 0,
      elapsedSeconds: 0,
      announcement: `${payloadItems.length} CV placés dans la file d’analyse.`,
      items: Object.fromEntries(
        payloadItems.map((item) => [
          item.clientId,
          {
            clientId: item.clientId,
            sourceName: item.sourceName,
            stage: "queued" as const,
            message: "Préparation de l’analyse…",
          },
        ]),
      ),
    });
    setSubmitting(true);
    submissionStartedRef.current = true;
    const requestStartedAt = Date.now();
    let jobsAccepted = false;
    try {
      const response = await fetch("/api/talents/import/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payloadItems }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || "L’import n’a pas pu démarrer.");
      }
      const queued = (await response.json()) as { jobs: JobRecord[] };
      if (!queued.jobs?.length) throw new Error("La file d’analyse est vide. Réessayez.");
      jobsAccepted = true;
      const jobIds = queued.jobs.map((job) => job.id);
      const expectedClients = new Set(payloadItems.map((item) => item.clientId));
      let latestJobs = queued.jobs;
      let consecutiveTrackingErrors = 0;
      while (true) {
        const elapsedSeconds = Math.floor((Date.now() - requestStartedAt) / 1000);
        const completedJobs = latestJobs.filter((job) => job.status === "completed");
        const failedJobs = latestJobs.filter((job) => job.status === "failed" || job.status === "cancelled");
        setProcessState((current) => current ? {
          ...current,
          completed: completedJobs.length + failedJobs.length,
          elapsedSeconds,
          announcement: failedJobs.length
            ? `${failedJobs.length} document${failedJobs.length > 1 ? "s demandent" : " demande"} une vérification.`
            : completedJobs.length === payloadItems.length
              ? "Tous les profils sont prêts."
              : "Le traitement continue en arrière-plan. Vous pouvez quitter cette page.",
          items: Object.fromEntries(latestJobs.map((job) => [job.client_reference, {
            clientId: job.client_reference,
            sourceName: job.source_name,
            stage: jobStage(job),
            message: job.status === "retry_wait"
              ? `${job.progress_message} Tentative ${job.attempt_count + 1} sur ${job.max_attempts}.`
              : job.last_error && job.status === "failed" ? job.last_error : job.progress_message,
            candidateId: job.candidat_id || undefined,
          }])),
        } : current);

        if (completedJobs.length + failedJobs.length >= expectedClients.size) break;
        await wait(2_500);
        try {
          const trackingResponse = await fetch(`/api/talents/import/jobs?ids=${jobIds.join(",")}`, { cache: "no-store" });
          if (!trackingResponse.ok) throw new Error("Suivi temporairement indisponible");
          const tracking = (await trackingResponse.json()) as { jobs: JobRecord[] };
          if (tracking.jobs?.length) latestJobs = tracking.jobs;
          consecutiveTrackingErrors = 0;
        } catch {
          consecutiveTrackingErrors += 1;
          if (consecutiveTrackingErrors >= 5) {
            throw new Error("Les analyses continuent en arrière-plan. Revenez au vivier dans quelques instants pour voir les profils terminés.");
          }
          await wait(2_500 * consecutiveTrackingErrors);
        }
      }

      const results: ApiResult[] = latestJobs.map((job) => {
        if (job.status !== "completed") return { clientId: job.client_reference, status: "error", message: job.last_error || "Le document doit être vérifié." };
        const metrics = (job.result.metrics || {}) as CvProcessingMetrics;
        return {
          clientId: job.client_reference,
          status: "success",
          candidateId: String(job.result.candidateId || job.candidat_id),
          fullname: String(job.result.fullname || "Candidat à identifier"),
          metrics,
          reused: Boolean(job.result.reused),
        };
      });

      const successfulIds = new Set(
        results.filter((result) => result.status === "success").map((result) => result.clientId),
      );
      const failures = new Map(
        results
          .filter((result): result is Extract<ApiResult, { status: "error" }> => result.status === "error")
          .map((result) => [result.clientId, result.message]),
      );

      setProcessState((current) => current ? {
        ...current,
        completed: results.length,
        items: Object.fromEntries(
          Object.entries(current.items).map(([clientId, item]) => {
            const failure = failures.get(clientId);
            return [clientId, failure ? { ...item, stage: "error" as const, message: failure } : item];
          }),
        ),
      } : current);

      setItems((current) =>
        current
          .filter((item) => !successfulIds.has(item.clientId))
          .map((item) =>
            failures.has(item.clientId)
              ? { ...item, analysisError: failures.get(item.clientId) }
              : item,
          ),
      );
      if (manualId && successfulIds.has(manualId)) setManualText("");

      const imported = results.filter((result) => result.status === "success").length;
      const failed = results.length - imported;
      const successfulResults = results.filter(
        (result): result is Extract<ApiResult, { status: "success" }> => result.status === "success",
      );
      if (imported > 0) {
        void trackProductEvent("cv_import_completed", {
          imported_count: imported,
          failed_count: failed,
          source_types: [...new Set(payloadItems.map((item) => item.sourceType))].join(","),
          duration_ms: Date.now() - requestStartedAt,
          parser_ms_total: successfulResults.reduce((total, result) => total + (result.metrics.parserDurationMs || 0), 0),
          embedding_ms_total: successfulResults.reduce((total, result) => total + (result.metrics.embeddingDurationMs || 0), 0),
          saving_ms_total: successfulResults.reduce((total, result) => total + (result.metrics.savingDurationMs || 0), 0),
          parser_retry_count: successfulResults.reduce((total, result) => total + Math.max(0, (result.metrics.parserAttempts || 0) - 1), 0),
          input_characters: successfulResults.reduce((total, result) => total + (result.metrics.inputCharacters || 0), 0),
          chunk_count: successfulResults.reduce((total, result) => total + (result.metrics.chunkCount || 0), 0),
          reused_count: successfulResults.filter((result) => result.reused).length,
          extraction_ms_total: successfulResults.reduce(
            (total, result) => total + (items.find((item) => item.clientId === result.clientId)?.extractionDurationMs || 0),
            0,
          ),
        });
      }
      if (imported > 0 && failed === 0) {
        const onlyResult = results.find(
          (result): result is Extract<ApiResult, { status: "success" }> => result.status === "success",
        );
        router.push(imported === 1 && onlyResult ? `/dashboard/talents/${onlyResult.candidateId}?created=1` : `/dashboard/talents?imported=${imported}`);
        router.refresh();
        return;
      }
      if (imported > 0) {
        setMessage({
          type: "success",
          text: `${imported} profil${imported > 1 ? "s ont" : " a"} été ajouté${imported > 1 ? "s" : ""}. Corrigez les éléments signalés puis relancez l’analyse.`,
        });
        router.refresh();
      } else {
        setMessage({
          type: "error",
          text: "Le document reste prêt. Vérifiez son texte ou relancez simplement l’analyse.",
        });
      }
    } catch (error) {
      setProcessState((current) => current ? {
        ...current,
        announcement: jobsAccepted
          ? "Le suivi s’est interrompu, mais les travaux déjà placés continuent en arrière-plan."
          : "L’import n’a pas été placé dans la file.",
      } : current);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "L’import a échoué. Réessayez.",
      });
    } finally {
      setSubmitting(false);
      submissionStartedRef.current = false;
    }
  }

  const processHasErrors = processState
    ? Object.values(processState.items).some((item) => item.stage === "error")
    : false;

  return (
    <div className="cv-import-flow" aria-busy={submitting}>
      <section className="settings-card cv-import-card">
        <div className="settings-card-heading">
          <span className="settings-icon"><UploadCloud size={20} /></span>
          <div><h2>Sélectionnez les documents</h2><p>Chaque fichier correspond à une personne et créera son propre profil.</p></div>
        </div>

        <div
          className={`cv-dropzone${dragging ? " is-dragging" : ""}`}
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
            hidden
            disabled={submitting}
            onChange={handleFiles}
            aria-label="Sélectionner plusieurs CV"
          />
          <span className="cv-dropzone-visual" aria-hidden="true">
            <span className="cv-dropzone-icon"><Files size={27} /></span>
            <i /><i /><i />
          </span>
          <div><strong>{items.length ? "Ajoutez d’autres CV au lot" : "Déposez tout votre lot de CV ici"}</strong><p>Jusqu’à {CV_IMPORT_LIMIT} fichiers · PDF, images, DOCX, TXT ou MD · 10 Mo maximum chacun</p></div>
          <button className="button button-secondary" type="button" disabled={submitting} onClick={() => fileInputRef.current?.click()}>
            {items.length ? "Ajouter des fichiers" : "Sélectionner plusieurs fichiers"}
          </button>
        </div>

        {items.length > 0 && (
          <>
            <div className="cv-batch-toolbar" role="status">
              <div><strong>{items.length} document{items.length > 1 ? "s sélectionnés" : " sélectionné"}</strong><span>{readyItems.length} prêt{readyItems.length > 1 ? "s" : ""} · {remainingSlots} place{remainingSlots > 1 ? "s" : ""} restante{remainingSlots > 1 ? "s" : ""}</span></div>
              <button type="button" disabled={submitting} onClick={() => { setItems([]); setProcessState(null); setMessage(null); }}><Trash2 size={16} /> Vider la sélection</button>
            </div>
            <div className="cv-file-list" aria-live="polite">
            {items.map((item, index) => (
              <article className={`cv-file-item is-${item.status}${item.analysisError ? " has-analysis-error" : ""}`} key={item.clientId}>
                <span className="cv-file-status" aria-hidden="true">
                  {item.status === "extracting" ? <LoaderCircle className="spin" size={20} /> : item.status === "ready" && !item.analysisError ? <FileCheck2 size={20} /> : <AlertCircle size={20} />}
                </span>
                <div className="cv-file-copy">
                  <small>Profil {index + 1}</small>
                  <strong>{item.sourceName}</strong>
                  {item.status === "extracting" && <p>{item.extractionMessage || "Extraction du texte sur cet appareil…"}</p>}
                  {item.status === "ready" && item.text && (
                    <>
                      <p>{item.text.length.toLocaleString("fr-FR")} caractères prêts à analyser{item.ocrUsed ? ` · ${item.ocrPageCount || 1} page${(item.ocrPageCount || 1) > 1 ? "s" : ""} reconnue${(item.ocrPageCount || 1) > 1 ? "s" : ""} localement` : ""}</p>
                      {item.analysisError && <div className="cv-analysis-recovery"><p>{item.analysisError}</p><button type="button" disabled={submitting} onClick={submitImport}>Relancer l’analyse</button></div>}
                      <details className="cv-text-preview">
                        <summary>Vérifier ou corriger le texte extrait</summary>
                        <label>
                          <span>Contenu extrait</span>
                          <textarea
                            value={item.text}
                            maxLength={CV_TEXT_MAX_LENGTH}
                            rows={10}
                            disabled={submitting}
                            onChange={(event) => updateExtractedText(item.clientId, event.target.value)}
                          />
                        </label>
                      </details>
                    </>
                  )}
                  {item.status === "error" && <p className="cv-file-error">{item.error}</p>}
                </div>
                <button
                  className="cv-remove-button"
                  type="button"
                  disabled={submitting}
                  aria-label={`Retirer ${item.sourceName}`}
                  onClick={() => setItems((current) => current.filter((currentItem) => currentItem.clientId !== item.clientId))}
                >
                  <Trash2 size={18} />
                </button>
              </article>
            ))}
            </div>
          </>
        )}
      </section>

      <details className="settings-card cv-manual-card">
        <summary>
          <span className="settings-icon settings-icon-soft"><FileText size={20} /></span>
          <span><strong>Vous n’avez pas de fichier ?</strong><small>Collez le contenu d’un CV manuellement.</small></span>
          <span className="cv-manual-action">Ajouter du texte</span>
        </summary>
        <div className="cv-manual-fields">
          <label className="settings-field">
            <span>Nom de la source</span>
            <div className="settings-input"><FileText size={18} /><input value={manualTitle} maxLength={240} disabled={submitting} onChange={(event) => setManualTitle(event.target.value)} /></div>
          </label>
          <label className="settings-field">
            <span>Contenu du CV</span>
            <textarea
              className="cv-manual-textarea"
              value={manualText}
              maxLength={CV_TEXT_MAX_LENGTH}
              rows={12}
              disabled={submitting}
              placeholder="Collez ici l’expérience, les compétences, les formations et les coordonnées du candidat…"
              onChange={(event) => setManualText(event.target.value)}
            />
            <small className="cv-character-count">{manualText.length.toLocaleString("fr-FR")} / {CV_TEXT_MAX_LENGTH.toLocaleString("fr-FR")}</small>
          </label>
        </div>
      </details>

      {processState && (
        <section className="settings-card cv-process-card" aria-label="Progression de l’analyse des CV">
          <span className="sr-only" aria-live="polite">{processState.announcement}</span>
          <div className="cv-process-heading">
            <span className="settings-icon"><Sparkles size={20} /></span>
            <div>
              <h2>{processState.completed === processState.total ? processHasErrors ? "Une vérification est nécessaire" : "Traitement terminé" : "Analyse du lot en cours"}</h2>
              <p>{processState.completed} sur {processState.total} document{processState.total > 1 ? "s" : ""} traité{processState.completed > 1 ? "s" : ""} · {formatDuration(processState.elapsedSeconds)}</p>
            </div>
            {submitting && <LoaderCircle className="spin cv-process-spinner" size={21} aria-hidden="true" />}
          </div>
          <div
            className={`cv-process-progress${processHasErrors ? " has-error" : ""}`}
            role="progressbar"
            aria-label="CV traités"
            aria-valuemin={0}
            aria-valuemax={processState.total}
            aria-valuenow={processState.completed}
          >
            <span style={{ width: `${processState.total ? (processState.completed / processState.total) * 100 : 0}%` }} />
          </div>
          <div className="cv-process-list">
            {Object.values(processState.items).map((item) => (
              <article className={`cv-process-item is-${item.stage}`} key={item.clientId}>
                <span className="cv-process-item-icon" aria-hidden="true">
                  {item.stage === "complete" ? <CheckCircle2 size={19} /> : item.stage === "error" ? <AlertCircle size={19} /> : item.stage === "queued" ? <FileText size={19} /> : <LoaderCircle className="spin" size={19} />}
                </span>
                <div><strong>{item.sourceName}</strong><p>{item.message}</p>{item.candidateId && item.stage !== "complete" && <Link className="cv-process-open-link" href={`/dashboard/talents/${item.candidateId}?created=1`}>Ouvrir le profil</Link>}</div>
                <span className="cv-process-stage">{processStageLabel[item.stage]}</span>
              </article>
            ))}
          </div>
          {submitting && <p className="cv-process-help">Les profils terminés sont conservés immédiatement. Vous pouvez les ouvrir pendant que le reste du lot continue.</p>}
        </section>
      )}

      {message && (
        <div className={`form-message ${message.type === "error" ? "form-error" : "form-success"}`} role={message.type === "error" ? "alert" : "status"}>
          {message.type === "error" ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          {message.text}
        </div>
      )}

      <div className="settings-actions settings-actions-sticky cv-import-actions">
        <div><strong>{importCount ? `${importCount} profil${importCount > 1 ? "s" : ""} prêt${importCount > 1 ? "s" : ""} à créer` : "Ajoutez un ou plusieurs CV"}</strong><span>Chaque document est traité séparément et les résultats réussis sont toujours conservés.</span></div>
        <button className="button button-primary" type="button" disabled={submitting || extracting || importCount === 0} onClick={submitImport}>
          {submitting ? <><LoaderCircle className="spin" size={18} /> Analyse en cours…</> : <><Sparkles size={18} /> Analyser et ajouter {importCount > 1 ? `les ${importCount} CV` : "au vivier"}</>}
        </button>
      </div>
    </div>
  );
}
