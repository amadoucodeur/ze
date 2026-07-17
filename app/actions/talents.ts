"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export type TalentState = {
  message?: string;
  errors?: Record<string, string[]>;
};

const optionalEmail = z.union([z.literal(""), z.string().trim().email("Saisissez une adresse email valide.")]);

const talentSchema = z.object({
  fullname: z.string().trim().min(2, "Saisissez le nom complet.").max(120, "Ce nom est trop long."),
  posteType: z.string().trim().max(120, "Cet intitulé est trop long."),
  localisation: z.string().trim().max(120, "Cette localisation est trop longue."),
  email: optionalEmail,
  phone: z.string().trim().max(30, "Ce numéro est trop long."),
  summary: z.string().trim().max(1200, "Le résumé ne doit pas dépasser 1 200 caractères."),
});

export async function createTalentAction(_state: TalentState, formData: FormData): Promise<TalentState> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id) return { message: "Votre organisation doit être configurée avant d’ajouter un talent." };
  if (profile.role === "viewer") return { message: "Votre rôle permet de consulter les talents, mais pas d’en créer." };

  const parsed = talentSchema.safeParse({
    fullname: formData.get("fullname"),
    posteType: formData.get("posteType"),
    localisation: formData.get("localisation"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    summary: formData.get("summary"),
  });

  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const contacts = {
    ...(parsed.data.email ? { email: parsed.data.email } : {}),
    ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
  };

  const admin = createAdminClient();
  const { error } = await admin.from("candidats").insert({
    organisation_id: profile.organisation_id,
    fullname: parsed.data.fullname,
    poste_type: parsed.data.posteType || null,
    localisation: parsed.data.localisation || null,
    summary: parsed.data.summary || null,
    contacts,
    industries: [],
    weakness: [],
    source: "manual",
    statut: "nouveau",
    embedding_model: "pending",
  });

  if (error) return { message: "Le talent n’a pas pu être ajouté. Vérifiez les informations puis réessayez." };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/talents");
  redirect("/dashboard/talents?created=1");
}
