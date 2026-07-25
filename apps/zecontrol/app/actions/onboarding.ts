"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { composeLoginIdentifier } from "@/lib/identifiers";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureZeControlOwnerAccess } from "@/lib/supabase/provision";
import { createClient } from "@/lib/supabase/server";

export type OnboardingState = {
  message?: string;
  errors?: Record<string, string[]>;
};

const organisationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Saisissez le nom de votre organisation.")
    .max(100, "Ce nom est trop long."),
  identifiant: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Utilisez au moins 3 caractères.")
    .max(40, "Utilisez au maximum 40 caractères.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Utilisez uniquement des lettres minuscules, chiffres et tirets.",
    ),
});

async function currentOwner() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/connexion");

  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, email, identifiant, role, organisation_id, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error || !profile) return null;
  return profile;
}

export async function createOrganisationAction(
  _state: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const profile = await currentOwner();
  if (!profile || !profile.is_active) {
    return { message: "Votre profil ZeSuite n’est pas actif." };
  }
  if (profile.role !== "owner") {
    return { message: "Seul un propriétaire peut créer une organisation." };
  }
  if (profile.organisation_id) redirect("/activation");

  const parsed = organisationSchema.safeParse({
    name: formData.get("name"),
    identifiant: formData.get("identifiant"),
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const admin = createAdminClient();
  const { data: organisation, error: organisationError } = await admin
    .from("organisations")
    .insert({
      name: parsed.data.name,
      identifiant: parsed.data.identifiant,
      email: profile.email ?? null,
      created_by: profile.id,
      plan: "free",
      status: "active",
      settings: { default_language: "fr" },
    })
    .select("id")
    .single();

  if (organisationError?.code === "23505") {
    return {
      errors: {
        identifiant: ["Cet identifiant d’organisation est déjà utilisé."],
      },
    };
  }
  if (organisationError || !organisation) {
    return {
      message: "L’organisation n’a pas pu être créée. Réessayez.",
    };
  }

  const rollback = async () => {
    await admin
      .schema("zecontrol")
      .from("orga_configs")
      .delete()
      .eq("id", organisation.id);
    await admin
      .from("profiles")
      .update({
        organisation_id: null,
        identifiant: profile.identifiant,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id)
      .eq("organisation_id", organisation.id);
    await admin
      .from("organisations")
      .delete()
      .eq("id", organisation.id)
      .eq("created_by", profile.id);
  };

  const { data: linkedProfile, error: linkError } = await admin
    .from("profiles")
    .update({
      organisation_id: organisation.id,
      identifiant: composeLoginIdentifier("admin", parsed.data.identifiant),
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id)
    .is("organisation_id", null)
    .select("id")
    .maybeSingle();

  if (linkError || !linkedProfile) {
    await rollback();
    return {
      message:
        "Votre compte n’a pas pu être associé à l’organisation. Réessayez.",
    };
  }

  const now = new Date().toISOString();
  const { error: organisationConfigError } = await admin
    .schema("zecontrol")
    .from("orga_configs")
    .insert({ id: organisation.id, is_active: true, updated_at: now });

  if (organisationConfigError) {
    await rollback();
    return {
      message: "L’accès ZeControl n’a pas pu être initialisé. Réessayez.",
    };
  }

  const { error: profileConfigError } = await admin
    .schema("zecontrol")
    .from("profiles_configs")
    .insert({
      id: profile.id,
      role: "owner",
      is_active: true,
      updated_at: now,
    });

  if (profileConfigError) {
    await rollback();
    return {
      message: "Votre accès ZeControl n’a pas pu être créé. Réessayez.",
    };
  }

  redirect("/dashboard?organisation=created");
}

export async function activateZeControlAction() {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  if (
    access.profile.role !== "owner" ||
    !access.profile.is_active ||
    !access.organisation ||
    access.organisation.status !== "active"
  ) {
    redirect("/activation?error=not-allowed");
  }
  if (access.status === "ready") redirect("/dashboard");

  const result = await ensureZeControlOwnerAccess(access, {
    reactivate: true,
  });
  if (result !== "ready") {
    redirect("/activation?error=activation-failed");
  }

  redirect("/dashboard?activation=success");
}
