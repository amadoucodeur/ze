import "server-only";

import { z } from "zod";
import { calculateProfileQuality } from "@/lib/cv/quality";
import {
  CV_EMBEDDING_CHUNK_LIMIT,
  CV_EMBEDDING_MODEL,
  parsedCvSchema,
  type CvEmbeddingChunk,
  type CvImportItem,
  type ParsedCv,
} from "./schema";

const MAMMOUTH_API_URL = "https://api.mammouth.ai/v1";
const PARSER_ATTEMPT_TIMEOUT_MS = 45_000;

const chatResponseSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

const embeddingResponseSchema = z.object({
  data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()).length(1536) })),
});

function getApiKey() {
  const apiKey = process.env.MAMMOUTH_AI_API_KEY;
  if (!apiKey) throw new Error("La clé Mammouth AI n’est pas configurée.");
  return apiKey;
}

async function mammouthRequest(path: string, body: Record<string, unknown>, timeoutMs: number) {
  const response = await fetch(`${MAMMOUTH_API_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const apiMessage =
      payload && typeof payload === "object" && "error" in payload
        ? (payload.error as { message?: string } | undefined)?.message
        : undefined;
    if (response.status === 429) throw new Error("Mammouth AI est momentanément très sollicité. Réessayez dans un instant.");
    if (response.status === 401) throw new Error("La configuration Mammouth AI doit être vérifiée.");
    throw new Error(apiMessage || "L’analyse IA n’a pas pu aboutir.");
  }

  return payload;
}

function extractJson(content: string) {
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("L’IA n’a pas renvoyé un profil structuré exploitable.");
  }
  return JSON.parse(content.slice(firstBrace, lastBrace + 1)) as unknown;
}

function fallbackName(sourceName: string, sourceType: CvImportItem["sourceType"]) {
  if (sourceType === "manual") return "Candidat à identifier";
  const cleaned = sourceName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b(cv|resume|curriculum vitae)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 120) : "Candidat à identifier";
}

function isStructureFailure(error: unknown) {
  return error instanceof z.ZodError
    || error instanceof SyntaxError
    || (error instanceof Error && error.message.includes("profil structuré exploitable"));
}

export async function parseCvWithMammouth(
  item: CvImportItem,
  options: { onRetry?: () => void; onComplete?: (metrics: { durationMs: number; attempts: number; model: string }) => void } = {},
): Promise<ParsedCv> {
  const startedAt = Date.now();
  const primaryModel = process.env.MAMMOUTH_PARSER_MODEL || "mistral-small-2603";
  const fallbackModel = process.env.MAMMOUTH_PARSER_FALLBACK_MODEL || "mistral-medium-3.1";

  async function attemptParse(text: string, attempt: number): Promise<ParsedCv> {
    const model = attempt === 0 ? primaryModel : fallbackModel;
    const payload = await mammouthRequest("/chat/completions", {
      model,
      temperature: 0,
      max_tokens: 4_500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Tu extrais fidèlement des CV pour un logiciel de recrutement francophone.
Réponds uniquement avec un objet JSON valide, sans markdown ni commentaire.
N’invente rien. N’infère jamais le genre, l’âge, l’origine, la situation familiale, la religion, la santé ou toute donnée sensible.
Les pointsAttention décrivent uniquement des informations professionnelles absentes, contradictoires ou ambiguës. Ils ne jugent jamais la personne.
Utilise null si une valeur n’est pas explicitement disponible. Les dates doivent être au format YYYY-MM-DD ou null.
Les niveaux de langue autorisés sont A1, A2, B1, B2, C1, C2, native.
Les expertises autorisées sont Beginner, Junior, Intermediate, Advanced, Expert.
Les types de formation autorisés sont degree, certification, training.
Tous les scores sont des entiers de 0 à 100 et décrivent uniquement la qualité objective du document et des informations qu’il contient. Ils ne mesurent ni la valeur de la personne, ni son adéquation à un poste, ni une décision de recrutement.
La disponibilité professionnelle autorisée est available, employed, open_to_opportunities, freelance, student, unavailable ou unknown. Utilise unknown lorsque le CV ne permet pas de conclure raisonnablement.
N’estime jamais de salaire, de rémunération attendue ou de valeur financière du candidat.
issuerDate est la date d’obtention effective du diplôme, certificat ou formation. institutionName est le nom de l’établissement qui l’a délivré.
Découpe uniquement les cinq expériences, réalisations, projets, formations ou certifications les plus probants dans sections. Privilégie les éléments concrets, datés et vérifiables. Ne répète pas le résumé, les contacts, le salaire, les compétences ou les langues déjà présents dans leurs champs dédiés. Retourne au maximum 5 sections.

Schéma attendu :
{
  "fullname": string|null,
  "posteType": string|null,
  "localisation": string|null,
  "summary": string|null,
  "availability": "available"|"employed"|"open_to_opportunities"|"freelance"|"student"|"unavailable"|"unknown",
  "performance": {"overall": number, "contentQuality": number, "presentationQuality": number, "completeness": number, "clarity": number, "consistency": number, "evidenceQuality": number, "strengths": string[], "improvements": string[], "evidence": string[]},
  "contacts": {"email": string|null, "phone": string|null, "linkedin": string|null},
  "industries": string[],
  "pointsAttention": string[],
  "skills": [{"name": string, "importance": "Primary"|"Secondary"|"Bonus", "score": number, "months": number|null, "expertise": "Beginner"|"Junior"|"Intermediate"|"Advanced"|"Expert"|null, "industry": string|null}],
  "languages": [{"name": string, "level": "A1"|"A2"|"B1"|"B2"|"C1"|"C2"|"native"|null}],
  "formations": [{"name": string, "institutionName": string|null, "issuerDate": string|null, "type": "degree"|"certification"|"training", "fieldOfStudy": string|null, "address": string|null, "description": string|null, "startDate": string|null, "endDate": string|null, "months": number|null, "confidence": number}],
  "sections": [{"type": string, "content": string}]
}`,
        },
        {
          role: "user",
          content: `Source : ${item.sourceName}\n\nCONTENU DU CV\n${text}`,
        },
      ],
    }, PARSER_ATTEMPT_TIMEOUT_MS);

    try {
      const response = chatResponseSchema.parse(payload);
      const parsed = parsedCvSchema.parse(extractJson(response.choices[0].message.content));
      options.onComplete?.({ durationMs: Date.now() - startedAt, attempts: attempt + 1, model: response.model || model });
      const normalized = { ...parsed, fullname: parsed.fullname || fallbackName(item.sourceName, item.sourceType) };
      return { ...normalized, performance: calculateProfileQuality(normalized, item.text) };
    } catch (error) {
      if (attempt === 0 && isStructureFailure(error)) {
        options.onRetry?.();
        return attemptParse(
          `${item.text}\n\n[INSTRUCTION DE FORMAT — NE FAIT PAS PARTIE DU CV]\nLa réponse précédente ne respectait pas exactement le schéma JSON. Relis le document et renvoie tous les champs demandés avec uniquement les valeurs autorisées. Utilise null ou un tableau vide lorsque l’information manque.`,
          1,
        );
      }
      throw error;
    }
  }

  return attemptParse(item.text, 0);
}

export function splitCvIntoChunks(text: string, maxLength = 3_500) {
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxLength) {
      if (current) chunks.push(current);
      for (let offset = 0; offset < paragraph.length; offset += maxLength) {
        chunks.push(paragraph.slice(offset, offset + maxLength));
      }
      current = "";
    } else if (!current) {
      current = paragraph;
    } else if (current.length + paragraph.length + 2 <= maxLength) {
      current += `\n\n${paragraph}`;
    } else {
      chunks.push(current);
      current = paragraph;
    }
  }

  if (current) chunks.push(current);
  return chunks.slice(0, 20);
}

export function buildCandidateEmbeddingText(parsed: ParsedCv) {
  return [
    parsed.fullname,
    parsed.posteType,
    parsed.localisation,
    parsed.summary,
    parsed.industries.length ? `Secteurs : ${parsed.industries.join(", ")}` : null,
    parsed.skills.length ? `Compétences : ${parsed.skills.map((skill) => skill.name).join(", ")}` : null,
    parsed.languages.length ? `Langues : ${parsed.languages.map((language) => language.name).join(", ")}` : null,
    parsed.formations.length ? `Formations : ${parsed.formations.map((formation) => formation.name).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCandidateChunks(parsed: ParsedCv, rawText: string): CvEmbeddingChunk[] {
  const profileSummary = buildCandidateEmbeddingText(parsed);
  const excludedTypes = new Set(["contact", "salary", "profile_summary", "professional_summary", "skill", "language", "industry", "document"]);
  const typePriority: Partial<Record<CvEmbeddingChunk["type"], number>> = {
    achievement: 100,
    experience: 95,
    project: 90,
    responsibility: 85,
    portfolio: 80,
    certification: 75,
    education: 70,
    training: 65,
    cover_letter: 50,
    interview_note: 45,
    other: 35,
  };
  const usefulSections = parsed.sections
    .filter((section) => !excludedTypes.has(section.type))
    .sort((left, right) => (typePriority[right.type] || 0) - (typePriority[left.type] || 0));
  const rawChunks = splitCvIntoChunks(rawText).map((content) => ({ type: "document" as const, content }));
  const candidates: CvEmbeddingChunk[] = [
    ...(profileSummary ? [{ type: "profile_summary" as const, content: profileSummary }] : []),
    ...usefulSections,
  ];

  // Même lorsque les sections structurées occupent toute la capacité, une
  // preuve issue du document original reste disponible pour expliquer le match.
  if (rawChunks.length) {
    const rawSlot = Math.max(0, CV_EMBEDDING_CHUNK_LIMIT - 1);
    candidates.splice(rawSlot, 0, rawChunks[0]);
  }
  candidates.push(...rawChunks.slice(1));

  const unique = new Map<string, CvEmbeddingChunk>();
  for (const chunk of candidates) {
    const key = chunk.content.replace(/\s+/g, " ").trim().toLowerCase();
    if (!unique.has(key)) unique.set(key, chunk);
  }
  return [...unique.values()].slice(0, CV_EMBEDDING_CHUNK_LIMIT);
}

export async function createEmbeddings(inputs: string[]) {
  if (!inputs.length) return [];
  const payload = await mammouthRequest("/embeddings", {
    model: CV_EMBEDDING_MODEL,
    input: inputs,
  }, 60_000);
  const response = embeddingResponseSchema.parse(payload);
  return response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}
