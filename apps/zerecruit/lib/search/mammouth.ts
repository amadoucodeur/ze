import "server-only";

import { z } from "zod";
import {
  talentSearchIntentSchema,
  type TalentSearchIntent,
  type TalentSearchMessage,
} from "./schema";

const MAMMOUTH_API_URL = "https://api.mammouth.ai/v1";
const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

function getApiKey() {
  const apiKey = process.env.MAMMOUTH_AI_API_KEY;
  if (!apiKey) throw new Error("Le service de recherche intelligente n’est pas configuré.");
  return apiKey;
}

function extractJson(content: string) {
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) throw new Error("La demande n’a pas pu être structurée.");
  return JSON.parse(content.slice(firstBrace, lastBrace + 1)) as unknown;
}

function normalizeForGrounding(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isExplicitlyMentioned(source: string, value: string) {
  const normalizedValue = normalizeForGrounding(value);
  return normalizedValue.length >= 2 && source.includes(normalizedValue);
}

function groundIntentInUserRequest(intent: TalentSearchIntent, messages: TalentSearchMessage[]): TalentSearchIntent {
  const rawUserRequest = messages.filter((message) => message.role === "user").map((message) => message.content).join(". ");
  const source = normalizeForGrounding(rawUserRequest);
  const hasExplicitExperience = /\b\d+(?:[.,]\d+)?\s*(?:ans?|annees?|mois)\b/.test(source)
    && /\b(?:experience|anciennete|minimum|min|au moins)\b/.test(source);
  const hasExplicitProfileQuality = /\b(?:qualite|complet|documente|score)\b/.test(source) && /\b\d{1,3}\s*%?\b/.test(source);
  const hasExplicitSalary = /\b(?:salaire|salarial|budget|remuneration|fcfa|xof|eur|euro|usd|dollar)\b/.test(source);
  const availabilityTerms: Record<string, string[]> = {
    available: ["disponible", "libre", "immediatement"],
    employed: ["en poste"],
    open_to_opportunities: ["a l ecoute", "opportunites"],
    freelance: ["freelance", "independant"],
    student: ["etudiant", "etudiante", "en formation"],
    unavailable: ["indisponible"],
    unknown: ["a confirmer", "inconnue", "inconnu"],
  };

  const safeQueries = [...new Set([
    intent.understoodRequest,
    rawUserRequest.replace(/\s+/g, " ").trim().slice(0, 500),
  ].filter((query) => query.length >= 3))].slice(0, 3);

  return {
    ...intent,
    searchQueries: safeQueries,
    mustHaveSkills: intent.mustHaveSkills.filter((value) => isExplicitlyMentioned(source, value)),
    niceToHaveSkills: intent.niceToHaveSkills.filter((value) => isExplicitlyMentioned(source, value)),
    locations: intent.locations.filter((value) => isExplicitlyMentioned(source, value)),
    languages: intent.languages.filter((value) => isExplicitlyMentioned(source, value)),
    industries: intent.industries.filter((value) => isExplicitlyMentioned(source, value)),
    availability: intent.availability.filter((value) => (availabilityTerms[value] || []).some((term) => source.includes(term))),
    minExperienceMonths: hasExplicitExperience ? intent.minExperienceMonths : null,
    minProfileScore: hasExplicitProfileQuality ? intent.minProfileScore : null,
    salary: hasExplicitSalary ? intent.salary : { maximum: null, currency: null, period: null },
  };
}

export async function understandTalentSearch(
  messages: TalentSearchMessage[],
  attempt = 0,
): Promise<TalentSearchIntent> {
  const response = await fetch(`${MAMMOUTH_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.MAMMOUTH_SEARCH_MODEL || process.env.MAMMOUTH_PARSER_MODEL || "mammouth-recommended",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Tu aides un recruteur francophone à transformer une conversation en recherche professionnelle de candidats.
Réponds uniquement avec un objet JSON valide, sans markdown ni commentaire.

Comprends la demande, corrige les fautes et complète seulement le vocabulaire de recherche avec des synonymes ou formulations proches. N’invente jamais une exigence, un lieu, un budget, un diplôme ou une ancienneté qui n’a pas été demandé.
Pose une seule question de clarification uniquement si la demande est trop vague pour lancer une recherche utile. Sinon, needsClarification vaut false.
Les searchQueries sont 1 à 3 formulations sémantiques autonomes destinées à une recherche d’embeddings. Elles peuvent élargir le vocabulaire, mais les critères inférés restent dans searchQueries et ne deviennent pas des mustHaveSkills.

Ignore et signale dans excludedSensitiveCriteria tout critère lié au genre, à l’âge, à l’origine, à la nationalité lorsqu’elle n’est pas une obligation légale explicite, à la religion, à la santé, au handicap, à la situation familiale, à la grossesse, à l’orientation sexuelle ou à toute autre donnée sensible. Ne les utilise jamais pour classer les personnes.
La disponibilité autorisée est available, employed, open_to_opportunities, freelance, student, unavailable ou unknown.

Schéma exact :
{
  "understoodRequest": string,
  "needsClarification": boolean,
  "clarificationQuestion": string|null,
  "searchQueries": string[],
  "roles": string[],
  "mustHaveSkills": string[],
  "niceToHaveSkills": string[],
  "locations": string[],
  "availability": ("available"|"employed"|"open_to_opportunities"|"freelance"|"student"|"unavailable"|"unknown")[],
  "languages": string[],
  "industries": string[],
  "minExperienceMonths": number|null,
  "minProfileScore": number|null,
  "salary": {"maximum": number|null, "currency": string|null, "period": "month"|"year"|null},
  "excludedSensitiveCriteria": string[]
}`,
        },
        ...messages.map((message) => ({ role: message.role, content: message.content })),
        ...(attempt > 0 ? [{ role: "user" as const, content: "Renvoie maintenant uniquement l’objet JSON conforme au schéma exact." }] : []),
      ],
    }),
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) throw new Error("La recherche est très sollicitée. Réessayez dans un instant.");
    if (response.status === 401) throw new Error("La configuration de la recherche doit être vérifiée.");
    throw new Error("La demande n’a pas pu être comprise pour le moment.");
  }

  try {
    const content = responseSchema.parse(payload).choices[0].message.content;
    const intent = talentSearchIntentSchema.parse(extractJson(content));
    return groundIntentInUserRequest(intent, messages);
  } catch (error) {
    if (attempt === 0 && (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof Error)) {
      return understandTalentSearch(messages, 1);
    }
    throw error;
  }
}
