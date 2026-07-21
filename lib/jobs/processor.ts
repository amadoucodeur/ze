import "server-only";

import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { candidateEnrichmentRequestSchema, cvImportItemSchema, type CandidateEnrichmentInput, type CvImportItem } from "@/lib/cv/schema";
import { processCvImportItem, publicCvProcessingError, type CvJobProgress } from "@/lib/jobs/cv-import";
import { processCandidateEnrichment } from "@/lib/jobs/candidate-enrichment";

type ProcessingJob = {
  id: string;
  organisation_id: string;
  kind: "cv_import" | "public_application" | "candidate_enrichment";
  payload: Record<string, unknown>;
  created_by: string;
  public_application_id: string | null;
  target_candidat_id: string | null;
  attempt_count: number;
  max_attempts: number;
};

function retryDelaySeconds(attemptCount: number) {
  return attemptCount <= 1 ? 5 : 20;
}

const wait = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

async function updateProgress(jobId: string, progress: CvJobProgress) {
  const admin = createAdminClient();
  await admin.from("ai_processing_jobs").update({
    progress_step: progress.step,
    progress_message: progress.message,
    candidat_id: progress.candidateId || undefined,
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);
}

async function claimJob(jobId?: string) {
  const admin = createAdminClient();
  const workerId = `next-${randomUUID()}`;
  const { data, error } = await admin.rpc("claim_ai_processing_job", {
    p_worker_id: workerId,
    p_job_id: jobId || null,
  });
  if (error) throw error;
  return ((data || [])[0] || null) as ProcessingJob | null;
}

async function completePublicApplication(job: ProcessingJob, candidateId: string) {
  if (!job.public_application_id) return;
  const admin = createAdminClient();
  const offerId = typeof job.payload.offerId === "string" ? job.payload.offerId : null;
  if (!offerId) throw new Error("L’offre associée à cette candidature est introuvable.");

  const { error: candidatureError } = await admin.from("candidatures").insert({
    organisation_id: job.organisation_id,
    offre_id: offerId,
    candidat_id: candidateId,
    stage: "review",
    source: "career_page",
    public_application_id: job.public_application_id,
    created_by: job.created_by,
    updated_by: job.created_by,
  });
  if (candidatureError && candidatureError.code !== "23505") throw candidatureError;

  const { error: applicationError } = await admin.from("public_applications").update({
    candidat_id: candidateId,
    status: "ready",
    status_message: "Candidature reçue et profil préparé.",
    updated_at: new Date().toISOString(),
  }).eq("id", job.public_application_id);
  if (applicationError) throw applicationError;
}

async function finishJob(job: ProcessingJob, input: CvImportItem) {
  const admin = createAdminClient();
  const result = await processCvImportItem({
    item: input,
    organisationId: job.organisation_id,
    createdBy: job.created_by,
    onProgress: (progress) => updateProgress(job.id, progress),
  });

  if (job.kind === "public_application") await completePublicApplication(job, result.candidateId);

  const { error } = await admin.from("ai_processing_jobs").update({
    status: "completed",
    progress_step: "completed",
    progress_message: result.reused ? "Profil existant retrouvé et relié." : "Profil créé et prêt.",
    candidat_id: result.candidateId,
    result: {
      candidateId: result.candidateId,
      fullname: result.fullname,
      metrics: result.metrics,
      reused: Boolean(result.reused),
    },
    payload: {},
    last_error: null,
    locked_at: null,
    locked_by: null,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);
  if (error) throw error;
}

async function finishEnrichmentJob(job: ProcessingJob, enrichment: CandidateEnrichmentInput) {
  if (!job.target_candidat_id) throw new Error("Le profil à actualiser est introuvable.");
  const admin = createAdminClient();
  const result = await processCandidateEnrichment({
    candidateId: job.target_candidat_id,
    organisationId: job.organisation_id,
    enrichment,
    onProgress: (progress) => updateProgress(job.id, progress),
  });
  const { error } = await admin.from("ai_processing_jobs").update({
    status: "completed",
    progress_step: "completed",
    progress_message: "Profil actualisé et prêt.",
    candidat_id: result.candidateId,
    result,
    payload: {},
    last_error: null,
    locked_at: null,
    locked_by: null,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);
  if (error) throw error;
}

async function failOrRetryJob(job: ProcessingJob, error: unknown) {
  const admin = createAdminClient();
  const message = publicCvProcessingError(error).slice(0, 1900);
  const retry = job.attempt_count < job.max_attempts;
  const nextAttemptAt = new Date(Date.now() + retryDelaySeconds(job.attempt_count) * 1000).toISOString();
  await admin.from("ai_processing_jobs").update({
    status: retry ? "retry_wait" : "failed",
    progress_step: retry ? "retry_wait" : "failed",
    progress_message: retry ? "Une nouvelle tentative sera lancée automatiquement." : "Le traitement nécessite une vérification manuelle.",
    last_error: message,
    next_attempt_at: nextAttemptAt,
    locked_at: null,
    locked_by: null,
    completed_at: retry ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);
  if (job.public_application_id) {
    await admin.from("public_applications").update({
      status: retry ? "processing" : "failed",
      status_message: retry ? "Votre candidature est reçue et sa préparation continue." : "La candidature est reçue, mais le CV doit être vérifié par l’équipe.",
      updated_at: new Date().toISOString(),
    }).eq("id", job.public_application_id);
  }
  return { retry, nextAttemptAt };
}

async function processAiJob(jobId?: string) {
  const job = await claimJob(jobId);
  if (!job) return { processed: false as const };
  try {
    if (job.kind === "candidate_enrichment") {
      const parsed = candidateEnrichmentRequestSchema.safeParse(job.payload.enrichment);
      if (!parsed.success) throw new Error("Les informations conservées pour cette actualisation ne sont plus valides.");
      await finishEnrichmentJob(job, parsed.data);
    } else {
      const parsed = cvImportItemSchema.safeParse(job.payload.item);
      if (!parsed.success) throw new Error("Le contenu conservé pour ce travail n’est plus valide.");
      await finishJob(job, parsed.data);
    }
    return { processed: true as const, jobId: job.id, status: "completed" as const };
  } catch (error) {
    const retry = await failOrRetryJob(job, error);
    return {
      processed: true as const,
      jobId: job.id,
      status: retry.retry ? "retry_wait" as const : "failed" as const,
      nextAttemptAt: retry.nextAttemptAt,
    };
  }
}

export async function processAiJobUntilSettled(jobId: string) {
  for (;;) {
    const result = await processAiJob(jobId);
    if (!result.processed || result.status !== "retry_wait") return result;
    const retryAt = Date.parse(result.nextAttemptAt);
    const delayMs = Number.isFinite(retryAt)
      ? Math.max(0, Math.min(30_000, retryAt - Date.now()))
      : 5_000;
    await wait(delayMs);
  }
}
