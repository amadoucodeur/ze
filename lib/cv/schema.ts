import { z } from "zod";

export const CV_IMPORT_LIMIT = 25;
export const CV_ENRICHMENT_FILE_LIMIT = 5;
export const CV_ENRICHMENT_TEXT_MIN_LENGTH = 10;
export const CV_ENRICHMENT_TEXT_MAX_LENGTH = 45_000;
export const CV_TEXT_MIN_LENGTH = 40;
export const CV_TEXT_MAX_LENGTH = 60_000;
export const CV_FILE_MAX_SIZE = 10 * 1024 * 1024;
export const CV_EMBEDDING_MODEL = "text-embedding-3-small";
export const CV_ANALYSIS_VERSION = "2026-07-fast-v1";
export const CV_EMBEDDING_CHUNK_LIMIT = 32;

export const candidateAvailabilityValues = [
  "available",
  "employed",
  "open_to_opportunities",
  "freelance",
  "student",
  "unavailable",
  "unknown",
] as const;

export const chunkTypeValues = [
  "profile_summary",
  "professional_summary",
  "experience",
  "responsibility",
  "achievement",
  "project",
  "education",
  "certification",
  "training",
  "skill",
  "language",
  "industry",
  "salary",
  "contact",
  "document",
  "cover_letter",
  "portfolio",
  "interview_note",
  "other",
] as const;

export const cvImportItemSchema = z.object({
  clientId: z.string().trim().min(1).max(100),
  sourceName: z.string().trim().min(1).max(240),
  sourceType: z.enum(["pdf", "docx", "text", "manual"]),
  text: z
    .string()
    .trim()
    .min(CV_TEXT_MIN_LENGTH, "Le contenu est trop court pour créer un profil fiable.")
    .max(CV_TEXT_MAX_LENGTH, "Le contenu dépasse la limite de 60 000 caractères."),
});

export const cvImportRequestSchema = z.object({
  items: z.array(cvImportItemSchema).min(1).max(CV_IMPORT_LIMIT),
});

export const candidateEnrichmentRequestSchema = z
  .object({
    items: z.array(cvImportItemSchema).max(CV_ENRICHMENT_FILE_LIMIT),
    manualText: z.string().trim().max(CV_ENRICHMENT_TEXT_MAX_LENGTH).optional().default(""),
  })
  .superRefine((value, context) => {
    const totalLength = value.manualText.length
      + value.items.reduce((total, item) => total + item.text.length, 0);
    if (totalLength < CV_ENRICHMENT_TEXT_MIN_LENGTH) {
      context.addIssue({
        code: "custom",
        message: "Ajoutez une information plus précise ou un document exploitable.",
      });
    }
    if (totalLength > CV_ENRICHMENT_TEXT_MAX_LENGTH) {
      context.addIssue({
        code: "custom",
        message: "Les informations dépassent 45 000 caractères. Retirez un document ou raccourcissez le texte.",
      });
    }
  });

const optionalText = z.string().trim().max(2_000).optional().nullable();
const score = z.coerce.number().min(0).max(100).transform(Math.round);

export const parsedCvSchema = z.object({
  fullname: z.string().trim().max(120).optional().nullable(),
  posteType: z.string().trim().max(120).optional().nullable(),
  localisation: z.string().trim().max(120).optional().nullable(),
  summary: z.string().trim().max(2_000).optional().nullable(),
  availability: z.enum(candidateAvailabilityValues).optional().default("unknown"),
  salaryValue: z
    .object({
      from: z.coerce.number().min(0),
      to: z.coerce.number().min(0),
      currency: z.string().trim().min(3).max(8),
      period: z.enum(["month", "year"]),
      confidence: score,
      rationale: z.string().trim().min(1).max(500),
      marketBasis: z.string().trim().min(1).max(240),
    })
    .refine((value) => value.to >= value.from, { message: "La borne haute doit être supérieure à la borne basse." })
    .optional()
    .nullable()
    .default(null),
  performance: z.object({
    overall: score,
    completeness: score,
    experience: score,
    expertise: score,
    education: score,
    marketReadiness: score,
    strengths: z.array(z.string().trim().min(1).max(240)).max(6).default([]),
    considerations: z.array(z.string().trim().min(1).max(240)).max(6).default([]),
    evidence: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
  }),
  contacts: z
    .object({
      email: z.string().trim().max(240).optional().nullable(),
      phone: z.string().trim().max(50).optional().nullable(),
      linkedin: z.string().trim().max(500).optional().nullable(),
    })
    .optional()
    .default({}),
  industries: z.array(z.string().trim().min(1).max(100)).max(10).optional().default([]),
  pointsAttention: z.array(z.string().trim().min(1).max(240)).max(8).optional().default([]),
  skills: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        importance: z.enum(["Primary", "Secondary", "Bonus"]).nullable().optional().transform((value) => value ?? "Secondary"),
        score,
        months: z.coerce.number().min(0).max(720).optional().nullable(),
        expertise: z
          .enum(["Beginner", "Junior", "Intermediate", "Advanced", "Expert"])
          .optional()
          .nullable()
          .catch(null),
        industry: optionalText,
      }),
    )
    .max(40)
    .optional()
    .default([]),
  languages: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "native"]).optional().nullable().catch(null),
      }),
    )
    .max(20)
    .optional()
    .default([]),
  formations: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(240),
        institutionName: z.string().trim().max(240).optional().nullable(),
        issuerDate: z.string().trim().max(10).optional().nullable(),
        type: z.enum(["degree", "certification", "training"]).nullable().optional().transform((value) => value ?? "training"),
        fieldOfStudy: optionalText,
        address: optionalText,
        description: optionalText,
        startDate: z.string().trim().max(10).optional().nullable(),
        endDate: z.string().trim().max(10).optional().nullable(),
        months: z.coerce.number().min(0).max(240).optional().nullable(),
        confidence: score,
      }),
    )
    .max(20)
    .optional()
    .default([]),
  sections: z
    .array(
      z.object({
        // A useful section must never invalidate the whole candidate because a
        // provider returned a synonymous or localized category. Unknown labels
        // remain searchable under the neutral `other` bucket.
        type: z.enum(chunkTypeValues).catch("other"),
        content: z.string().trim().min(1).max(3_500),
      }),
    )
    .max(16)
    .optional()
    .default([]),
});

export type CvImportItem = z.infer<typeof cvImportItemSchema>;
export type ParsedCv = z.infer<typeof parsedCvSchema>;
export type CvEmbeddingChunk = { type: (typeof chunkTypeValues)[number]; content: string };

export type CvProcessingMetrics = {
  inputCharacters: number;
  parserDurationMs: number;
  parserAttempts: number;
  embeddingDurationMs: number;
  savingDurationMs: number;
  totalDurationMs: number;
  chunkCount: number;
};

export type CandidateEnrichmentProgressEvent =
  | { type: "stage"; stage: "parsing" | "embedding" | "saving"; message: string }
  | { type: "heartbeat"; elapsedSeconds: number; message: string }
  | { type: "complete"; candidateId: string; fullname: string; metrics: CvProcessingMetrics }
  | { type: "error"; message: string };

export type CvImportProgressEvent =
  | { type: "batch_started"; total: number }
  | {
      type: "item_stage";
      clientId: string;
      sourceName: string;
      stage: "queued" | "parsing" | "embedding" | "saving";
      message: string;
    }
  | {
      type: "item_complete";
      clientId: string;
      candidateId: string;
      fullname: string;
      metrics: CvProcessingMetrics;
      reused?: boolean;
    }
  | { type: "item_ready"; clientId: string; candidateId: string; fullname: string }
  | { type: "item_error"; clientId: string; message: string }
  | { type: "heartbeat"; elapsedSeconds: number; completed: number; total: number }
  | { type: "batch_complete"; imported: number; failed: number }
  | { type: "batch_error"; message: string };
