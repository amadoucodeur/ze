import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  CV_ANALYSIS_VERSION,
  CV_EMBEDDING_MODEL,
  type CvEmbeddingChunk,
  type CvImportItem,
  type ParsedCv,
} from "./schema";

type PersistCvInput = {
  organisationId: string;
  createdBy: string;
  item: CvImportItem;
  parsed: ParsedCv;
  chunks: CvEmbeddingChunk[];
  chunkEmbeddings: number[][];
  sourceFingerprint?: string;
  analysisMetrics?: Record<string, number>;
};

type UpdateCandidateInput = {
  candidateId: string;
  organisationId: string;
  parsed: ParsedCv;
  chunks: CvEmbeddingChunk[];
  chunkEmbeddings: number[][];
  newSkillSource: "manual" | "import";
};

type FinalizeCandidateIndexingInput = {
  candidateId: string;
  organisationId: string;
  chunks: CvEmbeddingChunk[];
  chunkEmbeddings: number[][];
  analysisMetrics?: Record<string, number>;
};

let transactionalCreateAvailable: boolean | null = null;
let transactionalUpdateAvailable: boolean | null = null;

function compactObject(value: Record<string, string | null | undefined>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => Boolean(item)));
}

function validDate(value: string | null | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function vector(value: number[]) {
  return JSON.stringify(value);
}

function isMissingRpc(error: { code?: string; message?: string } | null) {
  return Boolean(
    error
    && (error.code === "PGRST202"
      || error.message?.includes("persist_candidate_analysis_v1")
      || error.message?.includes("update_candidate_analysis_v1")),
  );
}

function candidatePayload(parsed: ParsedCv, source?: string) {
  return {
    fullname: parsed.fullname || "Candidat à identifier",
    poste_type: parsed.posteType || null,
    localisation: parsed.localisation || null,
    summary: parsed.summary || null,
    contacts: compactObject(parsed.contacts),
    industries: parsed.industries,
    weakness: parsed.pointsAttention,
    ...(source ? { source } : {}),
    statut: parsed.availability,
    performance_score: parsed.performance.overall,
    performance: parsed.performance,
    embedding_model: CV_EMBEDDING_MODEL,
  };
}

function relationPayloads({
  parsed,
  chunks,
  chunkEmbeddings,
  skillSource,
}: {
  parsed: ParsedCv;
  chunks: CvEmbeddingChunk[];
  chunkEmbeddings: number[][];
  skillSource: "cv" | "manual" | "import";
}) {
  return {
    chunks: chunks.map((chunk, index) => ({
      content: chunk.content,
      type: chunk.type,
      embedding_model: CV_EMBEDDING_MODEL,
      embedding: chunkEmbeddings[index] ? vector(chunkEmbeddings[index]) : null,
    })),
    skills: parsed.skills.map((skill) => ({
      name: skill.name,
      importance: skill.importance,
      source: skillSource,
      score: skill.score,
      nb_month_of_experiance: skill.months,
      expertise: skill.expertise,
      industry: skill.industry,
    })),
    languages: parsed.languages.map((language) => ({ name: language.name, level: language.level })),
    formations: parsed.formations.map((formation) => ({
      name: formation.name,
      institution_name: formation.institutionName,
      issuer_date: validDate(formation.issuerDate),
      type: formation.type,
      field_of_study: formation.fieldOfStudy,
      adresse: formation.address,
      description: formation.description,
      start_date: validDate(formation.startDate),
      end_date: validDate(formation.endDate),
      nb_training_months: formation.months,
      confidence_score: formation.confidence,
    })),
  };
}

export async function persistParsedCvCore({
  organisationId,
  createdBy,
  item,
  parsed,
  chunks,
  sourceFingerprint,
  analysisMetrics,
}: PersistCvInput) {
  if (transactionalCreateAvailable === false) return null;
  const admin = createAdminClient();
  const source = item.sourceType === "manual" ? "manual_text" : `cv:${item.sourceName}`;
  const relations = relationPayloads({
    parsed,
    chunks,
    chunkEmbeddings: [],
    skillSource: item.sourceType === "manual" ? "manual" : "cv",
  });
  const { data, error } = await admin.rpc("persist_candidate_core_v1", {
    p_organisation_id: organisationId,
    p_created_by: createdBy,
    p_candidate: candidatePayload(parsed, source),
    p_chunks: relations.chunks,
    p_skills: relations.skills,
    p_languages: relations.languages,
    p_formations: relations.formations,
    p_source_fingerprint: sourceFingerprint || null,
    p_analysis_version: CV_ANALYSIS_VERSION,
    p_analysis_metrics: analysisMetrics || {},
  });
  if (!error && typeof data === "string") {
    transactionalCreateAvailable = true;
    return data;
  }
  if (error && !isMissingRpc(error)) throw new Error("Le profil de base n’a pas pu être créé.");
  transactionalCreateAvailable = false;
  return null;
}

export async function finalizeCandidateIndexing({
  candidateId,
  organisationId,
  chunks,
  chunkEmbeddings,
  analysisMetrics,
}: FinalizeCandidateIndexingInput) {
  const admin = createAdminClient();
  const payload = chunks.map((chunk, index) => ({
    content: chunk.content,
    type: chunk.type,
    embedding_model: CV_EMBEDDING_MODEL,
    embedding: vector(chunkEmbeddings[index]),
  }));
  const { data, error } = await admin.rpc("finalize_candidate_indexing_v1", {
    p_candidate_id: candidateId,
    p_organisation_id: organisationId,
    p_chunks: payload,
    p_analysis_metrics: analysisMetrics || {},
  });
  if (error || typeof data !== "string") throw new Error("Le profil est créé, mais sa préparation pour la recherche doit être relancée.");
  return data;
}

export async function markCandidateIndexingFailed(candidateId: string, organisationId: string) {
  const admin = createAdminClient();
  await admin.rpc("mark_candidate_indexing_failed_v1", {
    p_candidate_id: candidateId,
    p_organisation_id: organisationId,
  });
}

async function deleteCandidateRelations(candidateId: string) {
  const admin = createAdminClient();
  for (const table of ["section_chunks", "skills", "languages", "formations"] as const) {
    const { error } = await admin.from(table).delete().eq("candidat_id", candidateId);
    if (error) throw error;
  }
}

async function insertCandidateRelations({
  candidateId,
  organisationId,
  parsed,
  chunks,
  chunkEmbeddings,
  skillSource,
  existingSkillSources = {},
}: {
  candidateId: string;
  organisationId: string;
  parsed: ParsedCv;
  chunks: CvEmbeddingChunk[];
  chunkEmbeddings: number[][];
  skillSource: "cv" | "manual" | "import";
  existingSkillSources?: Record<string, "cv" | "manual" | "cover_letter" | "interview" | "portfolio" | "technical_test" | "reference" | "import" | "other">;
}) {
  const admin = createAdminClient();

  if (chunks.length) {
    const { error } = await admin.from("section_chunks").insert(
      chunks.map((chunk, index) => ({
        content: chunk.content,
        type: chunk.type,
        candidat_id: candidateId,
        organisation_id: organisationId,
        embedding_model: CV_EMBEDDING_MODEL,
        embedding: vector(chunkEmbeddings[index]),
      })),
    );
    if (error) throw error;
  }

  if (parsed.skills.length) {
    const { error } = await admin.from("skills").insert(
      parsed.skills.map((skill) => ({
        candidat_id: candidateId,
        name: skill.name,
        importance: skill.importance,
        source: existingSkillSources[skill.name.trim().toLowerCase()] || skillSource,
        score: skill.score,
        nb_month_of_experiance: skill.months,
        expertise: skill.expertise,
        industry: skill.industry,
      })),
    );
    if (error) throw error;
  }

  if (parsed.languages.length) {
    const { error } = await admin.from("languages").insert(
      parsed.languages.map((language) => ({
        candidat_id: candidateId,
        organisation_id: organisationId,
        name: language.name,
        level: language.level,
      })),
    );
    if (error) throw error;
  }

  if (parsed.formations.length) {
    const { error } = await admin.from("formations").insert(
      parsed.formations.map((formation) => ({
        candidat_id: candidateId,
        organisation_id: organisationId,
        name: formation.name,
        institution_name: formation.institutionName,
        issuer_date: validDate(formation.issuerDate),
        type: formation.type,
        field_of_study: formation.fieldOfStudy,
        adresse: formation.address,
        description: formation.description,
        start_date: validDate(formation.startDate),
        end_date: validDate(formation.endDate),
        nb_training_months: formation.months,
        confidence_score: formation.confidence,
      })),
    );
    if (error) throw error;
  }
}

async function rollbackCandidate(candidateId: string) {
  const admin = createAdminClient();
  await Promise.all([
    admin.from("section_chunks").delete().eq("candidat_id", candidateId),
    admin.from("skills").delete().eq("candidat_id", candidateId),
    admin.from("languages").delete().eq("candidat_id", candidateId),
    admin.from("formations").delete().eq("candidat_id", candidateId),
  ]);
  await admin.from("candidats").delete().eq("id", candidateId);
}

export async function persistParsedCv({
  organisationId,
  createdBy,
  item,
  parsed,
  chunks,
  chunkEmbeddings,
  sourceFingerprint,
  analysisMetrics,
}: PersistCvInput) {
  const admin = createAdminClient();
  const source = item.sourceType === "manual" ? "manual_text" : `cv:${item.sourceName}`;
  const relations = relationPayloads({
    parsed,
    chunks,
    chunkEmbeddings,
    skillSource: item.sourceType === "manual" ? "manual" : "cv",
  });
  if (transactionalCreateAvailable !== false) {
    const { data: rpcCandidateId, error: rpcError } = await admin.rpc("persist_candidate_analysis_v1", {
      p_organisation_id: organisationId,
      p_created_by: createdBy,
      p_candidate: candidatePayload(parsed, source),
      p_chunks: relations.chunks,
      p_skills: relations.skills,
      p_languages: relations.languages,
      p_formations: relations.formations,
      p_source_fingerprint: sourceFingerprint || null,
      p_analysis_version: CV_ANALYSIS_VERSION,
      p_analysis_metrics: analysisMetrics || {},
    });
    if (!rpcError && typeof rpcCandidateId === "string") {
      transactionalCreateAvailable = true;
      return rpcCandidateId;
    }
    if (rpcError && !isMissingRpc(rpcError)) {
      throw new Error("Le profil extrait n’a pas pu être enregistré dans une transaction complète.");
    }
    transactionalCreateAvailable = false;
  }

  const { data: candidate, error: candidateError } = await admin
    .from("candidats")
    .insert({
      organisation_id: organisationId,
      created_by: createdBy,
      ...candidatePayload(parsed, source),
    })
    .select("id")
    .single();

  if (candidateError || !candidate) {
    throw new Error("Le profil extrait n’a pas pu être enregistré.");
  }

  try {
    await insertCandidateRelations({
      candidateId: candidate.id,
      organisationId,
      parsed,
      chunks,
      chunkEmbeddings,
      skillSource: item.sourceType === "manual" ? "manual" : "cv",
    });

    return candidate.id as string;
  } catch {
    await rollbackCandidate(candidate.id);
    throw new Error("Le profil a été analysé, mais sa sauvegarde complète a échoué. Aucun profil partiel n’a été conservé.");
  }
}

export async function updateCandidateFromParsedCv({
  candidateId,
  organisationId,
  parsed,
  chunks,
  chunkEmbeddings,
  newSkillSource,
}: UpdateCandidateInput) {
  const admin = createAdminClient();
  const relations = relationPayloads({ parsed, chunks, chunkEmbeddings, skillSource: newSkillSource });
  if (transactionalUpdateAvailable !== false) {
    const { data: rpcCandidateId, error: rpcError } = await admin.rpc("update_candidate_analysis_v1", {
      p_candidate_id: candidateId,
      p_organisation_id: organisationId,
      p_candidate: candidatePayload(parsed),
      p_chunks: relations.chunks,
      p_skills: relations.skills,
      p_languages: relations.languages,
      p_formations: relations.formations,
      p_analysis_version: CV_ANALYSIS_VERSION,
    });
    if (!rpcError && typeof rpcCandidateId === "string") {
      transactionalUpdateAvailable = true;
      return rpcCandidateId;
    }
    if (rpcError && !isMissingRpc(rpcError)) {
      throw new Error("Les nouvelles informations n’ont pas pu être enregistrées dans une transaction complète.");
    }
    transactionalUpdateAvailable = false;
  }

  const { data: candidate, error: candidateError } = await admin
    .from("candidats")
    .select("id, fullname, poste_type, localisation, summary, contacts, industries, weakness, statut, performance_score, performance, embedding_model, updated_at")
    .eq("id", candidateId)
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (candidateError || !candidate) {
    throw new Error("Le profil à actualiser est introuvable dans votre organisation.");
  }

  const relationTables = ["section_chunks", "skills", "languages", "formations"] as const;
  const relationBackups = new Map<(typeof relationTables)[number], Record<string, unknown>[]>();
  for (const table of relationTables) {
    const { data, error } = await admin.from(table).select("*").eq("candidat_id", candidateId);
    if (error) throw new Error("Les informations actuelles du profil n’ont pas pu être sécurisées.");
    relationBackups.set(table, (data || []) as Record<string, unknown>[]);
  }

  const restore = async () => {
    await deleteCandidateRelations(candidateId);
    for (const table of relationTables) {
      const rows = relationBackups.get(table) || [];
      if (rows.length) {
        const { error } = await admin.from(table).insert(rows);
        if (error) throw error;
      }
    }
    const { error } = await admin
      .from("candidats")
      .update({
        fullname: candidate.fullname,
        poste_type: candidate.poste_type,
        localisation: candidate.localisation,
        summary: candidate.summary,
        contacts: candidate.contacts,
        industries: candidate.industries,
        weakness: candidate.weakness,
        statut: candidate.statut,
        performance_score: candidate.performance_score,
        performance: candidate.performance,
        embedding_model: candidate.embedding_model,
        updated_at: candidate.updated_at,
      })
      .eq("id", candidateId)
      .eq("organisation_id", organisationId);
    if (error) throw error;
  };

  try {
    const existingSkillSources = Object.fromEntries(
      (relationBackups.get("skills") || [])
        .filter((row) => typeof row.name === "string" && typeof row.source === "string")
        .map((row) => [String(row.name).trim().toLowerCase(), row.source]),
    ) as Record<string, "cv" | "manual" | "cover_letter" | "interview" | "portfolio" | "technical_test" | "reference" | "import" | "other">;
    await deleteCandidateRelations(candidateId);
    await insertCandidateRelations({
      candidateId,
      organisationId,
      parsed,
      chunks,
      chunkEmbeddings,
      skillSource: newSkillSource,
      existingSkillSources,
    });
    const { error } = await admin
      .from("candidats")
      .update({
        fullname: parsed.fullname || candidate.fullname,
        poste_type: parsed.posteType || null,
        localisation: parsed.localisation || null,
        summary: parsed.summary || null,
        contacts: compactObject(parsed.contacts),
        industries: parsed.industries,
        weakness: parsed.pointsAttention,
        statut: parsed.availability,
        performance_score: parsed.performance.overall,
        performance: parsed.performance,
        embedding_model: CV_EMBEDDING_MODEL,
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidateId)
      .eq("organisation_id", organisationId);
    if (error) throw error;
    return candidateId;
  } catch {
    try {
      await restore();
    } catch {
      throw new Error("L’actualisation a été interrompue. Rechargez le profil avant de réessayer.");
    }
    throw new Error("Les nouvelles informations n’ont pas pu être enregistrées. Le profil précédent a été restauré.");
  }
}
