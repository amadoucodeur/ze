import { z } from "zod";
import { candidateAvailabilityValues } from "@/lib/cv/schema";

export const talentSearchMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2_000),
});

export const talentSearchRequestSchema = z.object({
  messages: z.array(talentSearchMessageSchema).max(8).optional().default([]),
  offerId: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if (!value.offerId && value.messages.length === 0) context.addIssue({ code: "custom", message: "Décrivez votre besoin de recrutement." });
});

const nullableText = z.string().trim().max(160).nullable().optional().default(null);
const boundedList = (maximum: number, itemLength = 120) => z.array(
  z.preprocess(
    (value) => typeof value === "string" ? value.trim().slice(0, itemLength) : value,
    z.string().min(1),
  ),
).default([]).transform((items) => [...new Set(items)].slice(0, maximum));

export const talentSearchIntentSchema = z.object({
  understoodRequest: z.string().trim().min(1).max(500),
  needsClarification: z.boolean().default(false),
  clarificationQuestion: z.string().trim().max(300).nullable().optional().default(null),
  searchQueries: boundedList(3, 500).pipe(z.array(z.string().min(3))),
  roles: boundedList(8, 100),
  mustHaveSkills: boundedList(20, 100),
  niceToHaveSkills: boundedList(20, 100),
  locations: boundedList(6, 120),
  availability: z.array(z.enum(candidateAvailabilityValues)).default([]).transform((items) => [...new Set(items)].slice(0, 4)),
  languages: boundedList(8, 100),
  industries: boundedList(8, 100),
  minExperienceMonths: z.coerce.number().min(0).max(720).nullable().optional().default(null),
  minProfileScore: z.coerce.number().min(0).max(100).nullable().optional().default(null),
  salary: z.object({
    maximum: z.coerce.number().min(0).nullable().optional().default(null),
    currency: nullableText,
    period: z.enum(["month", "year"]).nullable().optional().default(null),
  }).optional().default({ maximum: null, currency: null, period: null }),
  excludedSensitiveCriteria: boundedList(6, 160),
});

export type TalentSearchMessage = z.infer<typeof talentSearchMessageSchema>;
export type TalentSearchIntent = z.infer<typeof talentSearchIntentSchema>;

export type TalentSearchResult = {
  id: string;
  fullname: string;
  posteType: string | null;
  localisation: string | null;
  summary: string | null;
  availability: string;
  relevanceScore: number;
  profileScore: number | null;
  salaryValue: Record<string, unknown>;
  skills: Array<{ name: string; expertise: string | null; score: number | null }>;
  languages: Array<{ name: string; level: string | null }>;
  matches: string[];
  gaps: string[];
  evidence: string[];
};

export type TalentSearchProgressEvent =
  | { type: "stage"; stage: "understanding" | "embedding" | "searching" | "ranking"; message: string }
  | { type: "heartbeat"; elapsedSeconds: number }
  | { type: "clarification"; question: string; understoodRequest: string }
  | { type: "complete"; understoodRequest: string; criteria: TalentSearchIntent; results: TalentSearchResult[]; durationMs: number }
  | { type: "error"; message: string };
