import { createHash } from "node:crypto";
import { getCurrentProfile } from "@/lib/supabase/current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildCandidateChunks,
  createEmbeddings,
  parseCvWithMammouth,
} from "@/lib/cv/mammouth";
import {
  finalizeCandidateIndexing,
  markCandidateIndexingFailed,
  persistParsedCv,
  persistParsedCvCore,
} from "@/lib/cv/persistence";
import {
  cvImportRequestSchema,
  CV_ANALYSIS_VERSION,
  type CvEmbeddingChunk,
  type CvImportItem,
  type CvImportProgressEvent,
  type CvProcessingMetrics,
} from "@/lib/cv/schema";

export const maxDuration = 600;

// Intentionally server-side: Mammouth uses a secret key and persistence spans
// several tenant-scoped tables that must either complete together or roll back.

type ImportResult =
  | { clientId: string; status: "success"; candidateId: string; fullname: string; metrics: CvProcessingMetrics; reused?: boolean }
  | { clientId: string; status: "error"; message: string };

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

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function publicError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "ZodError" || error instanceof SyntaxError || error.message.includes("profil structuré exploitable")) {
      return "Le profil n’a pas pu être finalisé. Vérifiez le texte extrait puis relancez l’analyse.";
    }
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "Ce CV demande plus de temps que prévu. Son contenu est conservé : vous pourrez relancer uniquement ce document dans un instant.";
    }
    return error.message;
  }
  return "Ce CV n’a pas pu être traité. Vérifiez son contenu puis réessayez.";
}

async function importOne(
  item: CvImportItem,
  organisationId: string,
  createdBy: string,
  emit: (event: CvImportProgressEvent) => void,
): Promise<ImportResult> {
  const startedAt = Date.now();
  const fingerprint = sourceFingerprint(item.text);
  const existing = await findExistingCandidate(organisationId, fingerprint);
  if (existing?.processing_status === "ready") {
    const metrics: CvProcessingMetrics = {
      inputCharacters: item.text.length,
      parserDurationMs: 0,
      parserAttempts: 0,
      embeddingDurationMs: 0,
      savingDurationMs: 0,
      totalDurationMs: Date.now() - startedAt,
      chunkCount: 0,
    };
    return { clientId: item.clientId, status: "success", candidateId: existing.id, fullname: existing.fullname, metrics, reused: true };
  }

  let coreCandidateId: string | null = null;
  try {
    let parserDurationMs = 0;
    let parserAttempts = 1;
    if (existing && existing.processing_status !== "ready") {
      emit({
        type: "item_stage",
        clientId: item.clientId,
        sourceName: item.sourceName,
        stage: "embedding",
        message: "Le profil existe déjà. Reprise de sa préparation pour la recherche…",
      });
      const admin = createAdminClient();
      const { data: storedChunks, error: storedChunksError } = await admin
        .from("section_chunks")
        .select("content, type")
        .eq("candidat_id", existing.id)
        .eq("organisation_id", organisationId);
      if (storedChunksError || !storedChunks?.length) throw new Error("Le profil existe déjà, mais sa préparation doit être relancée depuis sa page.");
      const chunks = storedChunks as CvEmbeddingChunk[];
      const embeddingStartedAt = Date.now();
      const embeddings = await createEmbeddings(chunks.map((chunk) => chunk.content));
      const embeddingDurationMs = Date.now() - embeddingStartedAt;
      const savingStartedAt = Date.now();
      await finalizeCandidateIndexing({
        candidateId: existing.id,
        organisationId,
        chunks,
        chunkEmbeddings: embeddings,
        analysisMetrics: { embeddingDurationMs, chunkCount: chunks.length },
      });
      const metrics: CvProcessingMetrics = {
        inputCharacters: item.text.length,
        parserDurationMs: 0,
        parserAttempts: 0,
        embeddingDurationMs,
        savingDurationMs: Date.now() - savingStartedAt,
        totalDurationMs: Date.now() - startedAt,
        chunkCount: chunks.length,
      };
      return { clientId: item.clientId, status: "success", candidateId: existing.id, fullname: existing.fullname, metrics, reused: true };
    }
    emit({
      type: "item_stage",
      clientId: item.clientId,
      sourceName: item.sourceName,
      stage: "parsing",
      message: "Lecture du CV et repérage des informations utiles…",
    });
    const parsed = await parseCvWithMammouth(item, {
      onRetry() {
        emit({
          type: "item_stage",
          clientId: item.clientId,
          sourceName: item.sourceName,
          stage: "parsing",
          message: "La mise en page demande une seconde lecture…",
        });
      },
      onComplete(metrics) {
        parserDurationMs = metrics.durationMs;
        parserAttempts = metrics.attempts;
      },
    });
    const chunks = buildCandidateChunks(parsed, item.text);
    const coreSavingStartedAt = Date.now();
    emit({
      type: "item_stage",
      clientId: item.clientId,
      sourceName: item.sourceName,
      stage: "saving",
      message: "Création du profil essentiel…",
    });
    coreCandidateId = await persistParsedCvCore({
      organisationId,
      createdBy,
      item,
      parsed,
      chunks,
      chunkEmbeddings: [],
      sourceFingerprint: fingerprint,
      analysisMetrics: {
        inputCharacters: item.text.length,
        parserDurationMs,
        parserAttempts,
        chunkCount: chunks.length,
      },
    });
    const coreSavingDurationMs = Date.now() - coreSavingStartedAt;
    if (coreCandidateId) {
      emit({
        type: "item_ready",
        clientId: item.clientId,
        candidateId: coreCandidateId,
        fullname: parsed.fullname || "Candidat à identifier",
      });
    }
    emit({
      type: "item_stage",
      clientId: item.clientId,
      sourceName: item.sourceName,
      stage: "embedding",
      message: coreCandidateId
        ? "Profil disponible. Préparation de la recherche en cours…"
        : "Organisation des expériences, compétences et formations…",
    });
    const embeddingStartedAt = Date.now();
    const embeddings = await createEmbeddings(chunks.map((chunk) => chunk.content));
    const embeddingDurationMs = Date.now() - embeddingStartedAt;
    if (embeddings.length !== chunks.length) {
      throw new Error("La préparation du profil pour la recherche est incomplète. Réessayez dans un instant.");
    }
    emit({
      type: "item_stage",
      clientId: item.clientId,
      sourceName: item.sourceName,
      stage: "saving",
      message: coreCandidateId ? "Dernières vérifications pour la recherche…" : "Dernières vérifications et création du profil…",
    });
    const finalSavingStartedAt = Date.now();
    const candidateId = coreCandidateId
      ? await finalizeCandidateIndexing({
          candidateId: coreCandidateId,
          organisationId,
          chunks,
          chunkEmbeddings: embeddings,
          analysisMetrics: { embeddingDurationMs, chunkCount: chunks.length },
        })
      : await persistParsedCv({
          organisationId,
          createdBy,
          item,
          parsed,
          chunks,
          chunkEmbeddings: embeddings,
          sourceFingerprint: fingerprint,
          analysisMetrics: {
            inputCharacters: item.text.length,
            parserDurationMs,
            parserAttempts,
            embeddingDurationMs,
            chunkCount: chunks.length,
          },
        });
    const savingDurationMs = coreSavingDurationMs + (Date.now() - finalSavingStartedAt);
    const metrics: CvProcessingMetrics = {
      inputCharacters: item.text.length,
      parserDurationMs,
      parserAttempts,
      embeddingDurationMs,
      savingDurationMs,
      totalDurationMs: Date.now() - startedAt,
      chunkCount: chunks.length,
    };
    console.info("cv_import_performance", {
      parser_ms: metrics.parserDurationMs,
      parser_attempts: metrics.parserAttempts,
      embedding_ms: metrics.embeddingDurationMs,
      saving_ms: metrics.savingDurationMs,
      total_ms: metrics.totalDurationMs,
      input_characters: metrics.inputCharacters,
      chunk_count: metrics.chunkCount,
    });
    return {
      clientId: item.clientId,
      status: "success",
      candidateId,
      fullname: parsed.fullname || "Candidat à identifier",
      metrics,
    };
  } catch (error) {
    if (coreCandidateId) await markCandidateIndexingFailed(coreCandidateId, organisationId).catch(() => undefined);
    return { clientId: item.clientId, status: "error", message: publicError(error) };
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ message: "Cette requête n’est pas autorisée." }, { status: 403 });
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return Response.json({ message: "Votre session a expiré. Reconnectez-vous pour continuer." }, { status: 401 });
  }
  if (!profile.organisation_id) {
    return Response.json({ message: "Créez votre organisation avant d’importer des CV." }, { status: 403 });
  }
  if (profile.role === "viewer") {
    return Response.json({ message: "Votre rôle permet de consulter les talents, mais pas d’en importer." }, { status: 403 });
  }
  if (profile.organisation?.status !== "active") {
    return Response.json({ message: "L’organisation doit être active pour importer des CV." }, { status: 403 });
  }
  const organisationId = profile.organisation_id;
  const creatorId = profile.id;

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 2_500_000) {
    return Response.json({ message: "Le lot est trop volumineux. Importez moins de CV à la fois." }, { status: 413 });
  }

  const body = await request.json().catch(() => null);
  const parsedRequest = cvImportRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return Response.json(
      { message: parsedRequest.error.issues[0]?.message || "Les CV envoyés ne sont pas valides." },
      { status: 400 },
    );
  }

  const items = parsedRequest.data.items;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const emit = (event: CvImportProgressEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };

      void (async () => {
        const results = new Array<ImportResult>(items.length);
        const startedAt = Date.now();
        let nextIndex = 0;
        let completed = 0;
        emit({ type: "batch_started", total: items.length });
        for (const item of items) {
          emit({
            type: "item_stage",
            clientId: item.clientId,
            sourceName: item.sourceName,
            stage: "queued",
            message: "En attente de traitement…",
          });
        }

        const heartbeat = setInterval(() => {
          emit({
            type: "heartbeat",
            elapsedSeconds: Math.floor((Date.now() - startedAt) / 1_000),
            completed,
            total: items.length,
          });
        }, 5_000);

        try {
          async function worker() {
            while (nextIndex < items.length) {
              const index = nextIndex;
              nextIndex += 1;
              const result = await importOne(items[index], organisationId, creatorId, emit);
              results[index] = result;
              completed += 1;
              if (result.status === "success") {
                emit({
                  type: "item_complete",
                  clientId: result.clientId,
                  candidateId: result.candidateId,
                  fullname: result.fullname,
                  metrics: result.metrics,
                  reused: result.reused,
                });
              } else {
                emit({ type: "item_error", clientId: result.clientId, message: result.message });
              }
            }
          }

          await Promise.all(Array.from({ length: Math.min(3, items.length) }, () => worker()));
          const imported = results.filter((result) => result.status === "success").length;
          emit({ type: "batch_complete", imported, failed: results.length - imported });
        } catch {
          emit({ type: "batch_error", message: "Le traitement du lot s’est interrompu. Les profils déjà terminés restent sauvegardés." });
        } finally {
          clearInterval(heartbeat);
          if (open) controller.close();
          open = false;
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
