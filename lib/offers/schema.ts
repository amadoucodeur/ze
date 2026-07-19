import { z } from "zod";

const boundedText = (maximum: number) => z.preprocess(
  (value) => typeof value === "string" ? value.trim().slice(0, maximum) : value,
  z.string(),
);
const optionalText = boundedText(6_000).optional().nullable().default(null);
const textList = z.array(boundedText(300))
  .optional()
  .default([])
  .transform((items) => [...new Set(items.filter(Boolean))].slice(0, 20));

export const offerAnalysisSchema = z.object({
  title: boundedText(160).pipe(z.string().min(2)),
  summary: optionalText,
  mission: optionalText,
  responsibilities: textList,
  mustHaveSkills: textList,
  niceToHaveSkills: textList,
  languages: textList,
  industries: textList,
  minExperienceMonths: z.coerce.number().min(0).max(720).optional().nullable().default(null),
  education: boundedText(500).optional().nullable().default(null),
  successOutcomes: textList,
  recruiterIntent: boundedText(4_000).optional().nullable().default(null),
  pointsToClarify: textList,
  excludedSensitiveCriteria: textList,
});

export const offerAnalysisRequestSchema = z.object({
  form: z.object({
    title: z.string().trim().max(160).optional().default(""),
    department: z.string().trim().max(120).optional().default(""),
    contractType: z.string().trim().max(40).optional().default(""),
    workMode: z.string().trim().max(40).optional().default(""),
    location: z.string().trim().max(160).optional().default(""),
    salaryMin: z.string().trim().max(30).optional().default(""),
    salaryMax: z.string().trim().max(30).optional().default(""),
    salaryCurrency: z.string().trim().max(8).optional().default(""),
    salaryPeriod: z.string().trim().max(10).optional().default(""),
    headcount: z.string().trim().max(5).optional().default("1"),
    targetStartDate: z.string().trim().max(10).optional().default(""),
  }),
  freeText: z.string().trim().max(60_000).optional().default(""),
  documents: z.array(z.object({
    sourceName: z.string().trim().min(1).max(240),
    text: z.string().trim().min(20).max(60_000),
  })).max(5).optional().default([]),
}).superRefine((value, context) => {
  const length = value.freeText.length + value.documents.reduce((total, document) => total + document.text.length, 0);
  if (!value.form.title && length < 20) context.addIssue({ code: "custom", message: "Ajoutez un intitulé, un document ou une description du besoin." });
  if (length > 100_000) context.addIssue({ code: "custom", message: "Le contenu de l’offre dépasse la limite autorisée." });
});

export const interviewGuideRequestSchema = z.object({
  candidatureId: z.string().uuid(),
});

export const interviewQuestionSchema = z.object({
  question: boundedText(1_000).pipe(z.string().min(5)),
  purpose: boundedText(700).pipe(z.string().min(3)),
  expectedSignals: z.array(boundedText(300)).default([]).transform((items) => [...new Set(items.filter(Boolean))].slice(0, 5)),
  category: z.enum(["motivation", "experience", "skill", "situation", "availability", "role", "closing"]),
});

export const interviewGuideSchema = z.object({
  introduction: boundedText(1_000).optional().default(""),
  questions: z.array(interviewQuestionSchema).min(5).transform((questions) => questions.slice(0, 12)),
});

export type OfferAnalysis = z.infer<typeof offerAnalysisSchema>;
export type OfferAnalysisRequest = z.infer<typeof offerAnalysisRequestSchema>;
export type InterviewGuide = z.infer<typeof interviewGuideSchema>;
