import { createEmbeddings } from "@/lib/cv/mammouth";
import { understandTalentSearch } from "@/lib/search/mammouth";
import {
  talentSearchRequestSchema,
  type TalentSearchIntent,
  type TalentSearchProgressEvent,
  type TalentSearchResult,
} from "@/lib/search/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

type VectorMatch = {
  candidat_id: string;
  semantic_similarity: number;
  matched_chunks: Array<{ type?: string; content?: string; similarity?: number }> | null;
};

type CandidateRow = {
  id: string;
  fullname: string;
  poste_type: string | null;
  localisation: string | null;
  summary: string | null;
  statut: string;
  performance_score: number | null;
  salary_value: Record<string, unknown> | null;
  industries: string[] | null;
  skills: Array<{ name: string; expertise: string | null; score: number | null; nb_month_of_experiance: number | null }>;
  languages: Array<{ name: string; level: string | null }>;
};

type OfferSearchRow = {
  title: string;
  summary: string | null;
  mission: string | null;
  responsibilities: string[];
  must_have_skills: string[];
  nice_to_have_skills: string[];
  languages: string[];
  industries: string[];
  min_experience_months: number | null;
  location: string | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: "month" | "year" | null;
  success_outcomes: string[];
  recruiter_intent: string | null;
};

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function normalize(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function includesTerm(value: string, term: string) {
  const normalizedValue = normalize(value);
  const normalizedTerm = normalize(term);
  return normalizedValue.includes(normalizedTerm) || normalizedTerm.includes(normalizedValue);
}

function salaryMatches(candidateValue: Record<string, unknown> | null, intent: TalentSearchIntent) {
  if (intent.salary.maximum === null) return null;
  if (!candidateValue) return false;
  const candidateFrom = Number(candidateValue.from);
  const candidatePeriod = candidateValue.period === "year" ? "year" : "month";
  const candidateCurrency = normalize(candidateValue.currency);
  if (!Number.isFinite(candidateFrom)) return false;
  if (intent.salary.currency && candidateCurrency !== normalize(intent.salary.currency)) return false;
  const targetPeriod = intent.salary.period || "month";
  const normalizedCandidate = candidatePeriod === targetPeriod
    ? candidateFrom
    : candidatePeriod === "year"
      ? candidateFrom / 12
      : candidateFrom * 12;
  return normalizedCandidate <= intent.salary.maximum;
}

function offerSearchIntent(offer: OfferSearchRow): TalentSearchIntent {
  const query = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(". ").slice(0, 500);
  const searchQueries = [
    query(offer.title, offer.mission, offer.recruiter_intent),
    query(`Compétences indispensables : ${offer.must_have_skills.join(", ")}`, offer.nice_to_have_skills.length ? `Atouts : ${offer.nice_to_have_skills.join(", ")}` : null),
    query(offer.responsibilities.join(". "), offer.success_outcomes.join(". ")),
  ].filter((value) => value.length >= 3);
  return {
    understoodRequest: query(offer.title, offer.summary || offer.mission),
    needsClarification: false,
    clarificationQuestion: null,
    searchQueries: [...new Set(searchQueries)].slice(0, 3),
    roles: [offer.title],
    mustHaveSkills: [...new Set(offer.must_have_skills)].slice(0, 20),
    niceToHaveSkills: [...new Set(offer.nice_to_have_skills)].slice(0, 20),
    locations: offer.location ? [offer.location] : [],
    availability: [],
    languages: [...new Set(offer.languages)].slice(0, 8),
    industries: [...new Set(offer.industries)].slice(0, 8),
    minExperienceMonths: offer.min_experience_months,
    minProfileScore: null,
    salary: { maximum: offer.salary_max, currency: offer.salary_currency, period: offer.salary_period },
    excludedSensitiveCriteria: [],
  };
}

function rankCandidate(
  candidate: CandidateRow,
  semanticSimilarity: number,
  chunks: VectorMatch["matched_chunks"],
  intent: TalentSearchIntent,
): TalentSearchResult {
  const matches: string[] = [];
  const gaps: string[] = [];
  let earned = 0;
  let possible = 0;
  const addCriterion = (label: string, matched: boolean, weight: number, gapLabel = label) => {
    possible += weight;
    if (matched) {
      earned += weight;
      matches.push(label);
    } else {
      gaps.push(gapLabel);
    }
  };

  const skillNames = candidate.skills.map((skill) => skill.name);
  const professionalEvidence = [candidate.poste_type, candidate.summary, ...(chunks || []).map((chunk) => chunk.content)]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  for (const skill of intent.mustHaveSkills) {
    addCriterion(`Compétence clé : ${skill}`, skillNames.some((name) => includesTerm(name, skill)) || includesTerm(professionalEvidence, skill), 4, `Compétence « ${skill} » non confirmée`);
  }
  for (const skill of intent.niceToHaveSkills) {
    addCriterion(`Atout : ${skill}`, skillNames.some((name) => includesTerm(name, skill)) || includesTerm(professionalEvidence, skill), 1, `Atout « ${skill} » non confirmé`);
  }
  if (intent.roles.length) {
    const roleText = `${candidate.poste_type || ""} ${candidate.summary || ""}`;
    addCriterion("Métier recherché", intent.roles.some((role) => includesTerm(roleText, role)), 3, "Intitulé de poste à vérifier");
  }
  if (intent.locations.length) {
    addCriterion("Localisation", intent.locations.some((location) => includesTerm(candidate.localisation || "", location)), 2, "Localisation différente ou absente");
  }
  if (intent.availability.length) {
    addCriterion("Disponibilité", intent.availability.includes(candidate.statut as TalentSearchIntent["availability"][number]), 2, "Disponibilité à vérifier");
  }
  if (intent.languages.length) {
    const languageNames = candidate.languages.map((language) => language.name);
    for (const language of intent.languages) {
      addCriterion(`Langue : ${language}`, languageNames.some((name) => includesTerm(name, language)), 1.5, `Langue « ${language} » non confirmée`);
    }
  }
  if (intent.industries.length) {
    addCriterion("Secteur", intent.industries.some((industry) => (candidate.industries || []).some((value) => includesTerm(value, industry))), 1.5, "Expérience sectorielle à vérifier");
  }
  if (intent.minExperienceMonths !== null) {
    gaps.push("Durée totale d’expérience à confirmer dans le profil");
  }
  if (intent.minProfileScore !== null) {
    addCriterion("Profil suffisamment documenté", (candidate.performance_score || 0) >= intent.minProfileScore, 1, "Profil moins documenté que souhaité");
  }
  const withinSalary = salaryMatches(candidate.salary_value, intent);
  if (withinSalary !== null) addCriterion("Fourchette compatible", withinSalary, 2, "Fourchette salariale à vérifier");

  const semanticScore = Math.max(0, Math.min(100, semanticSimilarity * 100));
  const criteriaScore = possible > 0 ? earned / possible * 100 : semanticScore;
  const evidenceScore = candidate.performance_score ?? 50;
  const relevanceScore = Math.round(Math.max(0, Math.min(100, semanticScore * 0.65 + criteriaScore * 0.3 + evidenceScore * 0.05)));
  const evidence = (chunks || [])
    .map((chunk) => {
      if (typeof chunk.content !== "string") return "";
      const labels: Record<string, string> = {
        summary: "Résumé",
        experience: "Expérience",
        responsibility: "Responsabilité",
        achievement: "Réalisation",
        project: "Projet",
        education: "Formation",
        certification: "Certification",
        skill: "Compétence",
        language: "Langue",
        industry: "Secteur",
      };
      const label = typeof chunk.type === "string" ? labels[chunk.type] || "Élément professionnel" : "Élément professionnel";
      return `${label} — ${chunk.content.replace(/\s+/g, " ").trim().slice(0, 190)}`;
    })
    .filter(Boolean)
    .slice(0, 2);

  return {
    id: candidate.id,
    fullname: candidate.fullname,
    posteType: candidate.poste_type,
    localisation: candidate.localisation,
    summary: candidate.summary,
    availability: candidate.statut,
    relevanceScore,
    profileScore: candidate.performance_score,
    salaryValue: candidate.salary_value || {},
    skills: candidate.skills.map((skill) => ({ name: skill.name, expertise: skill.expertise, score: skill.score })).slice(0, 12),
    languages: candidate.languages,
    matches: [...new Set(matches)].slice(0, 6),
    gaps: [...new Set(gaps)].slice(0, 4),
    evidence,
  };
}

function publicError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "ZodError" || error instanceof SyntaxError) return "La demande n’a pas pu être organisée. Reformulez-la puis réessayez.";
    if (error.name === "TimeoutError" || error.name === "AbortError") return "La recherche demande plus de temps que prévu. Réessayez dans un instant.";
    if (error.message.includes("search_candidate_chunks")) return "La recherche intelligente est en cours de configuration. Actualisez puis réessayez.";
    const safeMessages = [
      "La recherche est très sollicitée.",
      "La configuration de la recherche doit être vérifiée.",
      "La demande n’a pas pu être comprise",
      "Les profils trouvés n’ont pas pu être chargés.",
      "Le service de recherche intelligente n’est pas configuré.",
    ];
    if (safeMessages.some((message) => error.message.startsWith(message))) return error.message;
  }
  return "La recherche n’a pas pu aboutir. Reformulez votre demande puis réessayez.";
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ message: "Cette requête n’est pas autorisée." }, { status: 403 });
  const profile = await getCurrentProfile();
  if (!profile) return Response.json({ message: "Votre session a expiré. Reconnectez-vous pour continuer." }, { status: 401 });
  if (!profile.organisation_id || profile.organisation?.status !== "active") {
    return Response.json({ message: "Une organisation active est nécessaire pour rechercher des talents." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 30_000) return Response.json({ message: "La conversation est trop longue. Démarrez une nouvelle recherche." }, { status: 413 });
  const body = await request.json().catch(() => null);
  const parsedRequest = talentSearchRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return Response.json({ message: parsedRequest.error.issues[0]?.message || "La demande n’est pas valide." }, { status: 400 });
  }

  let matchingOffer: OfferSearchRow | null = null;
  if (parsedRequest.data.offerId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("offres")
      .select("title, summary, mission, responsibilities, must_have_skills, nice_to_have_skills, languages, industries, min_experience_months, location, salary_max, salary_currency, salary_period, success_outcomes, recruiter_intent")
      .eq("id", parsedRequest.data.offerId)
      .eq("organisation_id", profile.organisation_id)
      .maybeSingle();
    if (!data) return Response.json({ message: "Cette offre n’est plus disponible pour le matching." }, { status: 404 });
    matchingOffer = data as OfferSearchRow;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const startedAt = Date.now();
      const emit = (event: TalentSearchProgressEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      const heartbeat = setInterval(() => emit({ type: "heartbeat", elapsedSeconds: Math.floor((Date.now() - startedAt) / 1_000) }), 5_000);

      void (async () => {
        try {
          emit({ type: "stage", stage: "understanding", message: "Compréhension de votre besoin…" });
          const intent = matchingOffer
            ? offerSearchIntent(matchingOffer)
            : await understandTalentSearch(parsedRequest.data.messages);
          if (intent.needsClarification && intent.clarificationQuestion) {
            emit({ type: "clarification", question: intent.clarificationQuestion, understoodRequest: intent.understoodRequest });
            return;
          }

          emit({ type: "stage", stage: "embedding", message: "Préparation des critères de recherche…" });
          const embeddings = await createEmbeddings(intent.searchQueries);
          emit({ type: "stage", stage: "searching", message: "Recherche dans les expériences et compétences…" });
          const supabase = await createClient();
          const rpcResults = await Promise.all(embeddings.map((embedding) => supabase.rpc("search_candidate_chunks", {
            query_embedding: JSON.stringify(embedding),
            result_limit: 100,
            min_similarity: 0.05,
          })));
          const rpcError = rpcResults.find((result) => result.error)?.error;
          if (rpcError) throw new Error(rpcError.message);

          const aggregated = new Map<string, { scores: number[]; chunks: NonNullable<VectorMatch["matched_chunks"]> }>();
          for (const result of rpcResults) {
            for (const row of (result.data || []) as VectorMatch[]) {
              const current = aggregated.get(row.candidat_id) || { scores: [], chunks: [] };
              current.scores.push(Number(row.semantic_similarity) || 0);
              current.chunks.push(...(Array.isArray(row.matched_chunks) ? row.matched_chunks : []));
              aggregated.set(row.candidat_id, current);
            }
          }

          emit({ type: "stage", stage: "ranking", message: "Classement des profils les plus pertinents…" });
          const candidateIds = [...aggregated.keys()];
          let candidates: CandidateRow[] = [];
          {
            const admin = createAdminClient();
            let candidateQuery = admin
              .from("candidats")
              .select("id, fullname, poste_type, localisation, summary, statut, performance_score, salary_value, industries, skills(name, expertise, score, nb_month_of_experiance), languages(name, level)")
              .eq("organisation_id", profile.organisation_id!)
              .is("archived_at", null);
            if (candidateIds.length) candidateQuery = candidateQuery.in("id", candidateIds);
            const { data, error } = await candidateQuery.limit(200);
            if (error) throw new Error("Les profils trouvés n’ont pas pu être chargés.");
            candidates = (data || []) as CandidateRow[];
          }

          const results = candidates.map((candidate) => {
            const vector = aggregated.get(candidate.id) || { scores: [0], chunks: [] };
            const maximum = Math.max(...vector.scores);
            const average = vector.scores.reduce((sum, value) => sum + value, 0) / vector.scores.length;
            return rankCandidate(candidate, maximum * 0.75 + average * 0.25, vector.chunks, intent);
          }).sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 12);

          emit({ type: "complete", understoodRequest: intent.understoodRequest, criteria: intent, results, durationMs: Date.now() - startedAt });
        } catch (error) {
          emit({ type: "error", message: publicError(error) });
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
