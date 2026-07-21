import { z } from "zod";
import { cvImportItemSchema } from "@/lib/cv/schema";

export const publicApplicationSchema = z.object({
  organisation: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/),
  offerSlug: z.string().trim().min(3).max(100).regex(/^[a-z0-9-]+$/),
  fullname: z.string().trim().min(2, "Indiquez votre nom complet.").max(140),
  email: z.string().trim().email("Indiquez une adresse email valide.").max(240),
  phone: z.string().trim().max(50).optional().default(""),
  coverNote: z.string().trim().max(5_000).optional().default(""),
  consent: z.literal(true),
  item: cvImportItemSchema,
});

export type PublicApplicationInput = z.infer<typeof publicApplicationSchema>;
