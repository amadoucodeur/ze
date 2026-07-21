import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCandidateChunks, createEmbeddings, parseCvWithMammouth } from "@/lib/cv/mammouth";
import {
  finalizeCandidateIndexing,
  markCandidateIndexingFailed,
  persistParsedCv,
  persistParsedCvCore,
} from "@/lib/cv/persistence";
import {
  CV_ANALYSIS_VERSION,
  type CvEmbeddingChunk,
  type CvImportItem,
  type CvProcessingMetrics,
} from "@/lib/cv/schema";

export type CvJobStep = "queued" | "parsing" | "embedding" | "saving";

export type CvJobProgress = {
  step: CvJobStep;
  message: string;
  candidateId?: string;
  fullname?: string;
};

export type CvJobResult = {
  candidateId: string;
  fullname: string;
  metrics: CvProcessingMetrics;
  reused?: boolean;
};

let fingerprintLookupAvailable: boolean | null = null;

function sourceFingerprint(text: string) {
  return createHash("sha256")
    .update(text.replace(/\s+/g, " ").trim())
    .update(`:${CV_ANALYSIS_VERSION}`)
    .digest("hex");
}

async function findExistingCandidate(organisationId: string, fingerprint: string) {
  if (fingerprintLookupAvailable === false) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("candidats")
    .select("id, fullname, processing_status")
    .eq("organisation_id", organisationId)
    .eq("source_fingerprint", fingerprint)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") fingerprintLookupAvailable = false;
    return null;
  }
  fingerprintLookupAvailable = true;
  return data;
}

export function publicCvProcessingError(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes("plan_candidate_limit_reached")) return "La capacité de profils du plan est atteinte. Archivez un profil ou choisissez un plan supérieur.";
    if (error.message.includes("plan_access_inactive")) return "La période d’accès de l’organisation est terminée.";
    if (error.name === "ZodError" || error instanceof SyntaxError || error.message.includes("profil structuré exploitable")) {
      return "Le profil n’a pas pu être finalisé. Le texte reste conservé pour une nouvelle tentative.";
    }
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "Le traitement a dépassé le délai prévu. Une nouvelle tentative sera lancée automatiquement.";
    }
    return error.message;
  }
  return "Ce document n’a pas pu être traité. Une nouvelle tentative sera lancée automatiquement.";
}

export async function processCvImportItem(input: {
  item: CvImportItem;
  organisationId: string;
  createdBy: string;
  onProgress?: (progress: CvJobProgress) => Promise<void> | void;
}): Promise<CvJobResult> {
  const { item, organisationId, createdBy, onProgress } = input;
  const startedAt = Date.now();
  const fingerprint = sourceFingerprint(item.text);
  const existing = await findExistingCandidate(organisationId, fingerprint);
  if (existing?.processing_status === "ready") {
    return {
      candidateId: existing.id,
      fullname: existing.fullname,
      reused: true,
      metrics: {
        inputCharacters: item.text.length,
        parserDurationMs: 0,
        parserAttempts: 0,
        embeddingDurationMs: 0,
        savingDurationMs: 0,
        totalDurationMs: Date.now() - startedAt,
        chunkCount: 0,
      },
    };
  }

  let coreCandidateId: string | null = null;
  try {
    let parserDurationMs = 0;
    let parserAttempts = 1;
    if (existing && existing.processing_status !== "ready") {
      await onProgress?.({ step: "embedding", message: "Reprise de la préparation pour la recherche…", candidateId: existing.id, fullname: existing.fullname });
      const admin = createAdminClient();
      const { data: storedChunks, error } = await admin
        .from("section_chunks")
        .select("content, type")
        .eq("candidat_id", existing.id)
        .eq("organisation_id", organisationId);
      if (error || !storedChunks?.length) throw new Error("Les informations structurées doivent être relues avant la reprise.");
      const chunks = storedChunks as CvEmbeddingChunk[];
      const embeddingStartedAt = Date.now();
      const embeddings = await createEmbeddings(chunks.map((chunk) => chunk.content));
      const embeddingDurationMs = Date.now() - embeddingStartedAt;
      await onProgress?.({ step: "saving", message: "Finalisation de la recherche…", candidateId: existing.id, fullname: existing.fullname });
      const savingStartedAt = Date.now();
      await finalizeCandidateIndexing({ candidateId: existing.id, organisationId, chunks, chunkEmbeddings: embeddings, analysisMetrics: { embeddingDurationMs, chunkCount: chunks.length } });
      return {
        candidateId: existing.id,
        fullname: existing.fullname,
        reused: true,
        metrics: {
          inputCharacters: item.text.length,
          parserDurationMs: 0,
          parserAttempts: 0,
          embeddingDurationMs,
          savingDurationMs: Date.now() - savingStartedAt,
          totalDurationMs: Date.now() - startedAt,
          chunkCount: chunks.length,
        },
      };
    }

    await onProgress?.({ step: "parsing", message: "Lecture du CV et repérage des informations utiles…" });
    const parsed = await parseCvWithMammouth(item, {
      onRetry() {
        void onProgress?.({ step: "parsing", message: "La mise en page demande une seconde lecture…" });
      },
      onComplete(metrics) {
        parserDurationMs = metrics.durationMs;
        parserAttempts = metrics.attempts;
      },
    });
    const chunks = buildCandidateChunks(parsed, item.text);
    const coreSavingStartedAt = Date.now();
    await onProgress?.({ step: "saving", message: "Création du profil essentiel…" });
    const persistedCoreCandidateId = await persistParsedCvCore({
      organisationId,
      createdBy,
      item,
      parsed,
      chunks,
      chunkEmbeddings: [],
      sourceFingerprint: fingerprint,
      analysisMetrics: { inputCharacters: item.text.length, parserDurationMs, parserAttempts, chunkCount: chunks.length },
    });
    coreCandidateId = persistedCoreCandidateId;
    const coreSavingDurationMs = Date.now() - coreSavingStartedAt;
    const fullname = parsed.fullname || "Candidat à identifier";
    await onProgress?.({
      step: "embedding",
      message: "Profil disponible. Préparation de la recherche en cours…",
      candidateId: persistedCoreCandidateId || undefined,
      fullname,
    });
    const embeddingStartedAt = Date.now();
    const embeddings = await createEmbeddings(chunks.map((chunk) => chunk.content));
    const embeddingDurationMs = Date.now() - embeddingStartedAt;
    if (embeddings.length !== chunks.length) throw new Error("La préparation pour la recherche est incomplète.");
    await onProgress?.({ step: "saving", message: "Dernières vérifications…", candidateId: coreCandidateId || undefined, fullname });
    const finalSavingStartedAt = Date.now();
    const candidateId = persistedCoreCandidateId
      ? await finalizeCandidateIndexing({ candidateId: persistedCoreCandidateId, organisationId, chunks, chunkEmbeddings: embeddings, analysisMetrics: { embeddingDurationMs, chunkCount: chunks.length } })
      : await persistParsedCv({
          organisationId,
          createdBy,
          item,
          parsed,
          chunks,
          chunkEmbeddings: embeddings,
          sourceFingerprint: fingerprint,
          analysisMetrics: { inputCharacters: item.text.length, parserDurationMs, parserAttempts, embeddingDurationMs, chunkCount: chunks.length },
        });
    return {
      candidateId,
      fullname,
      metrics: {
        inputCharacters: item.text.length,
        parserDurationMs,
        parserAttempts,
        embeddingDurationMs,
        savingDurationMs: coreSavingDurationMs + Date.now() - finalSavingStartedAt,
        totalDurationMs: Date.now() - startedAt,
        chunkCount: chunks.length,
      },
    };
  } catch (error) {
    if (coreCandidateId) await markCandidateIndexingFailed(coreCandidateId, organisationId).catch(() => undefined);
    throw new Error(publicCvProcessingError(error));
  }
}
