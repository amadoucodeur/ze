"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export type TalentState = {
  message?: string;
  success?: string;
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

const talentUpdateSchema = talentSchema.extend({
  summary: z.string().trim().max(2_000, "Le résumé ne doit pas dépasser 2 000 caractères."),
  statut: z.enum(["available", "employed", "open_to_opportunities", "freelance", "student", "unavailable", "unknown"]),
  linkedin: z.union([
    z.literal(""),
    z.string().trim().url("Saisissez un lien LinkedIn valide.").max(500, "Ce lien est trop long.").refine((value) => value.startsWith("https://") || value.startsWith("http://"), "Le lien doit commencer par https://"),
  ]),
  industries: z.string().max(1_000, "La liste des secteurs est trop longue."),
  pointsAttention: z.string().max(2_000, "La liste des points d’attention est trop longue."),
});

function splitList(value: string, limit: number) {
  return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

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
    created_by: profile.id,
    fullname: parsed.data.fullname,
    poste_type: parsed.data.posteType || null,
    localisation: parsed.data.localisation || null,
    summary: parsed.data.summary || null,
    contacts,
    industries: [],
    weakness: [],
    source: "manual",
    statut: "unknown",
    embedding_model: "pending",
  });

  if (error) return { message: "Le talent n’a pas pu être ajouté. Vérifiez les informations puis réessayez." };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/talents");
  redirect("/dashboard/talents?created=1");
}

export async function updateTalentAction(
  talentId: string,
  _state: TalentState,
  formData: FormData,
): Promise<TalentState> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id) return { message: "Votre organisation doit être configurée pour modifier ce profil." };
  if (profile.role === "viewer") return { message: "Votre accès permet de consulter ce profil, mais pas de le modifier." };
  if (!z.string().uuid().safeParse(talentId).success) return { message: "Ce profil est introuvable." };

  const parsed = talentUpdateSchema.safeParse({
    fullname: formData.get("fullname"),
    posteType: formData.get("posteType"),
    localisation: formData.get("localisation"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    summary: formData.get("summary"),
    statut: formData.get("statut"),
    linkedin: formData.get("linkedin"),
    industries: formData.get("industries"),
    pointsAttention: formData.get("pointsAttention"),
  });

  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  // Kept server-side until authenticated UPDATE policies can be safely verified.
  // The organisation boundary always comes from the authenticated profile.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("candidats")
    .update({
      fullname: parsed.data.fullname,
      poste_type: parsed.data.posteType || null,
      localisation: parsed.data.localisation || null,
      summary: parsed.data.summary || null,
      statut: parsed.data.statut,
      contacts: {
        ...(parsed.data.email ? { email: parsed.data.email } : {}),
        ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
        ...(parsed.data.linkedin ? { linkedin: parsed.data.linkedin } : {}),
      },
      industries: splitList(parsed.data.industries, 10),
      weakness: splitList(parsed.data.pointsAttention, 8),
    })
    .eq("id", talentId)
    .eq("organisation_id", profile.organisation_id)
    .select("id")
    .maybeSingle();

  if (error || !data) return { message: "Les modifications n’ont pas pu être enregistrées. Vérifiez les informations puis réessayez." };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/talents");
  revalidatePath(`/dashboard/talents/${talentId}`);
  redirect(`/dashboard/talents/${talentId}?updated=1`);
}

async function getEditableTalent(talentId: string) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (!profile.organisation_id || profile.role === "viewer" || !z.string().uuid().safeParse(talentId).success) return null;
  return { profile, admin: createAdminClient() };
}

export async function archiveTalentAction(talentId: string) {
  const context = await getEditableTalent(talentId);
  if (!context) redirect("/dashboard/talents");
  const { data } = await context.admin
    .from("candidats")
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", talentId)
    .eq("organisation_id", context.profile.organisation_id)
    .select("id")
    .maybeSingle();
  if (!data) redirect(`/dashboard/talents/${talentId}?actionError=archive`);
  revalidatePath("/dashboard/talents");
  revalidatePath(`/dashboard/talents/${talentId}`);
  redirect(`/dashboard/talents/${talentId}?archived=1`);
}

export async function restoreTalentAction(talentId: string) {
  const context = await getEditableTalent(talentId);
  if (!context) redirect("/dashboard/talents");
  const { data } = await context.admin
    .from("candidats")
    .update({ archived_at: null, updated_at: new Date().toISOString() })
    .eq("id", talentId)
    .eq("organisation_id", context.profile.organisation_id)
    .select("id")
    .maybeSingle();
  if (!data) redirect(`/dashboard/talents/${talentId}?actionError=restore`);
  revalidatePath("/dashboard/talents");
  revalidatePath(`/dashboard/talents/${talentId}`);
  redirect(`/dashboard/talents/${talentId}?restored=1`);
}

export async function deleteTalentAction(
  talentId: string,
  _state: TalentState,
  formData: FormData,
): Promise<TalentState> {
  const context = await getEditableTalent(talentId);
  if (!context) return { message: "Vous n’êtes pas autorisé à supprimer ce profil." };
  const confirmation = String(formData.get("confirmation") || "").trim();
  const { data: candidate } = await context.admin
    .from("candidats")
    .select("id, fullname")
    .eq("id", talentId)
    .eq("organisation_id", context.profile.organisation_id)
    .maybeSingle();
  if (!candidate) return { message: "Ce profil n’existe plus ou n’appartient pas à votre organisation." };
  if (confirmation !== candidate.fullname) {
    return { errors: { confirmation: [`Saisissez exactement « ${candidate.fullname} » pour confirmer.`] } };
  }

  const childTables = ["section_chunks", "skills", "languages", "formations"] as const;
  for (const table of childTables) {
    const { error } = await context.admin.from(table).delete().eq("candidat_id", talentId);
    if (error) return { message: "La suppression n’a pas pu être terminée. Le profil a été conservé." };
  }
  const { data: deleted, error } = await context.admin
    .from("candidats")
    .delete()
    .eq("id", talentId)
    .eq("organisation_id", context.profile.organisation_id)
    .select("id")
    .maybeSingle();
  if (error || !deleted) return { message: "Le profil n’a pas pu être supprimé. Réessayez." };
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/talents");
  redirect("/dashboard/talents?deleted=1");
}
