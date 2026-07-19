import "server-only";

import { z } from "zod";
import { interviewGuideSchema, offerAnalysisSchema, type InterviewGuide, type OfferAnalysis, type OfferAnalysisRequest } from "./schema";

const MAMMOUTH_API_URL = "https://api.mammouth.ai/v1";
const responseSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) });

function apiKey() {
  const key = process.env.MAMMOUTH_AI_API_KEY;
  if (!key) throw new Error("Le service d’analyse des offres n’est pas configuré.");
  return key;
}

function extractJson(content: string) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("L’analyse n’a pas renvoyé de résultat structuré.");
  return JSON.parse(content.slice(start, end + 1)) as unknown;
}

async function structuredCompletion<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  const models = [
    process.env.MAMMOUTH_OFFER_MODEL || process.env.MAMMOUTH_PARSER_MODEL || "mistral-small-2603",
    process.env.MAMMOUTH_OFFER_FALLBACK_MODEL || "mistral-medium-3.1",
  ];
  let lastError: unknown;
  for (const model of models) {
    try {
      const response = await fetch(`${MAMMOUTH_API_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 5_000,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(response.status === 429 ? "Le service est très sollicité. Réessayez dans un instant." : "L’analyse de l’offre n’a pas pu aboutir.");
      const raw = extractJson(responseSchema.parse(payload).choices[0].message.content);
      return schema.parse(raw);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("L’analyse n’a pas pu aboutir.");
}

export async function analyseOffer(input: OfferAnalysisRequest): Promise<OfferAnalysis> {
  const documents = input.documents.map((document) => `DOCUMENT : ${document.sourceName}\n${document.text}`).join("\n\n");
  return structuredCompletion(
    `Tu structures une fiche de poste pour un logiciel de recrutement francophone. Réponds uniquement en JSON valide.
Utilise seulement les informations professionnelles fournies. Cherche l’intention profonde du recruteur : résultat attendu, problèmes à résoudre, contexte, responsabilités et signaux de réussite. Ne transforme jamais une supposition en exigence.
Sépare strictement les compétences indispensables des atouts souhaités. Place les ambiguïtés dans pointsToClarify.
Écarte tout critère discriminatoire ou sensible (âge, genre, origine, religion, santé, situation familiale et données similaires) et liste-le dans excludedSensitiveCriteria sans l’utiliser.
Schéma exact :
{"title":string,"summary":string|null,"mission":string|null,"responsibilities":string[],"mustHaveSkills":string[],"niceToHaveSkills":string[],"languages":string[],"industries":string[],"minExperienceMonths":number|null,"education":string|null,"successOutcomes":string[],"recruiterIntent":string|null,"pointsToClarify":string[],"excludedSensitiveCriteria":string[]}`,
    `CHAMPS SAISIS\n${JSON.stringify(input.form)}\n\nTEXTE LIBRE\n${input.freeText || "Aucun"}\n\n${documents || "Aucun document"}`,
    offerAnalysisSchema,
  );
}

export async function generateInterviewGuide(context: {
  offer: Record<string, unknown>;
  candidate: Record<string, unknown>;
}): Promise<InterviewGuide> {
  return structuredCompletion(
    `Tu prépares un guide d’entretien professionnel, équitable et contextualisé pour une offre et un candidat.
Réponds uniquement en JSON valide. Propose 7 à 10 questions courtes, ouvertes et directement utiles à la décision humaine.
Commence par la motivation et le contexte, puis vérifie les exigences indispensables, approfondis les expériences avec des questions situationnelles, couvre les écarts à confirmer, la disponibilité et termine par une question ouverte.
Ne pose aucune question sur l’âge, le genre, l’origine, la religion, la santé, la situation familiale ou une autre donnée sensible. Ne cherche pas à confirmer une donnée sensible trouvée ailleurs.
Pour chaque question, explique brièvement son objectif et donne 1 à 3 signaux professionnels à écouter. Le recruteur saisira ensuite fidèlement la réponse donnée par le candidat.
Schéma exact :
{"introduction":string,"questions":[{"question":string,"purpose":string,"expectedSignals":string[],"category":"motivation"|"experience"|"skill"|"situation"|"availability"|"role"|"closing"}]}`,
    `OFFRE VALIDÉE\n${JSON.stringify(context.offer)}\n\nPROFIL PROFESSIONNEL\n${JSON.stringify(context.candidate)}`,
    interviewGuideSchema,
  );
}
