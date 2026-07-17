"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export type SettingsState = {
  message?: string;
  success?: string;
  errors?: Record<string, string[]>;
};

const optionalEmail = z.union([
  z.literal(""),
  z.string().trim().email("Saisissez une adresse email valide."),
]);

const optionalUrl = z.union([
  z.literal(""),
  z.string().trim().url("Saisissez une URL complète, par exemple https://entreprise.com."),
]);

const profileSchema = z.object({
  fullname: z.string().trim().min(2, "Saisissez votre nom complet.").max(100, "Ce nom est trop long."),
  phone: z.string().trim().max(30, "Ce numéro est trop long."),
});

const organisationSchema = z.object({
  name: z.string().trim().min(2, "Saisissez le nom de l’entreprise.").max(100, "Ce nom est trop long."),
  identifiant: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Utilisez au moins 3 caractères.")
    .max(40, "Utilisez au maximum 40 caractères.")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Utilisez uniquement des lettres minuscules, chiffres et tirets."),
  email: optionalEmail,
  phone: z.string().trim().max(30, "Ce numéro est trop long."),
  websiteUrl: optionalUrl,
  description: z.string().trim().max(600, "La description ne doit pas dépasser 600 caractères."),
  logoUrl: optionalUrl,
});

function nullable(value: string) {
  return value || null;
}

async function authenticatedProfile() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  return profile;
}

export async function updateProfileAction(
  _state: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const profile = await authenticatedProfile();
  const parsed = profileSchema.safeParse({
    fullname: formData.get("fullname"),
    phone: formData.get("phone"),
  });

  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      fullname: parsed.data.fullname,
      phone: nullable(parsed.data.phone),
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id);

  if (error) return { message: "Votre profil n’a pas pu être enregistré. Réessayez." };

  revalidatePath("/dashboard", "layout");
  return { success: "Votre profil a bien été mis à jour." };
}

export async function createOrganisationAction(
  _state: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const profile = await authenticatedProfile();
  if (profile.role !== "owner") return { message: "Seul un propriétaire peut créer une organisation." };
  if (profile.organisation_id) redirect("/dashboard/parametres/organisation");

  const parsed = organisationSchema.safeParse({
    name: formData.get("name"),
    identifiant: formData.get("identifiant"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    websiteUrl: formData.get("websiteUrl"),
    description: formData.get("description"),
    logoUrl: formData.get("logoUrl"),
  });

  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const admin = createAdminClient();
  const { data: organisation, error } = await admin
    .from("organisations")
    .insert({
      name: parsed.data.name,
      identifiant: parsed.data.identifiant,
      email: nullable(parsed.data.email),
      phone: nullable(parsed.data.phone),
      website_url: nullable(parsed.data.websiteUrl),
      description: nullable(parsed.data.description),
      logo_url: nullable(parsed.data.logoUrl),
      created_by: profile.id,
      plan: "free",
      status: "active",
      settings: {
        default_language: "fr",
        candidate_retention_days: 365,
        ai_scoring_enabled: true,
        automatic_cv_parsing: true,
        default_embedding_model: "text-embedding-3-small",
      },
    })
    .select("id")
    .single();

  if (error?.code === "23505") return { errors: { identifiant: ["Cet identifiant d’organisation est déjà utilisé."] } };
  if (error || !organisation) return { message: "L’organisation n’a pas pu être créée. Réessayez." };

  const { data: linkedProfile, error: linkError } = await admin
    .from("profiles")
    .update({ organisation_id: organisation.id, updated_at: new Date().toISOString() })
    .eq("id", profile.id)
    .is("organisation_id", null)
    .select("id")
    .maybeSingle();

  if (linkError || !linkedProfile) {
    await admin.from("organisations").delete().eq("id", organisation.id).eq("created_by", profile.id);
    return { message: "Votre compte n’a pas pu être associé à l’organisation. Réessayez." };
  }

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard?organisation=created");
}

export async function updateOrganisationAction(
  _state: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const profile = await authenticatedProfile();
  if (profile.role !== "owner" || !profile.organisation_id) {
    return { message: "Seul le propriétaire peut modifier les paramètres de l’organisation." };
  }

  const parsed = organisationSchema.safeParse({
    name: formData.get("name"),
    identifiant: formData.get("identifiant"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    websiteUrl: formData.get("websiteUrl"),
    description: formData.get("description"),
    logoUrl: formData.get("logoUrl"),
  });

  const preferenceSchema = z.object({
    defaultLanguage: z.enum(["fr", "en"]),
    retentionDays: z.coerce.number().int().min(30).max(3650),
  });
  const preferences = preferenceSchema.safeParse({
    defaultLanguage: formData.get("defaultLanguage"),
    retentionDays: formData.get("retentionDays"),
  });

  if (!parsed.success || !preferences.success) {
    const errors = {
      ...(parsed.success ? {} : parsed.error.flatten().fieldErrors),
      ...(preferences.success ? {} : preferences.error.flatten().fieldErrors),
    };
    return { errors };
  }

  const admin = createAdminClient();
  const { data: currentOrganisation } = await admin
    .from("organisations")
    .select("settings")
    .eq("id", profile.organisation_id)
    .maybeSingle();
  const currentSettings = currentOrganisation?.settings && typeof currentOrganisation.settings === "object"
    ? currentOrganisation.settings
    : {};

  const { error } = await admin
    .from("organisations")
    .update({
      name: parsed.data.name,
      identifiant: parsed.data.identifiant,
      email: nullable(parsed.data.email),
      phone: nullable(parsed.data.phone),
      website_url: nullable(parsed.data.websiteUrl),
      description: nullable(parsed.data.description),
      logo_url: nullable(parsed.data.logoUrl),
      settings: {
        ...currentSettings,
        default_language: preferences.data.defaultLanguage,
        candidate_retention_days: preferences.data.retentionDays,
        ai_scoring_enabled: formData.get("aiScoringEnabled") === "on",
        automatic_cv_parsing: formData.get("automaticCvParsing") === "on",
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.organisation_id);

  if (error?.code === "23505") return { errors: { identifiant: ["Cet identifiant d’organisation est déjà utilisé."] } };
  if (error) return { message: "Les paramètres de l’organisation n’ont pas pu être enregistrés." };

  revalidatePath("/dashboard", "layout");
  return { success: "Les paramètres de l’organisation ont bien été mis à jour." };
}
