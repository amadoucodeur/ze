"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";

export type CollaboratorState = {
  message?: string;
  success?: string;
  errors?: Record<string, string[]>;
  credentials?: {
    fullname: string;
    identifiant: string;
    temporaryPassword: string;
  };
};

const collaboratorSchema = z.object({
  fullname: z.string().trim().min(2, "Saisissez le nom complet.").max(100, "Ce nom est trop long."),
  email: z.string().trim().toLowerCase().email("Saisissez une adresse email valide."),
  phone: z.string().trim().max(30, "Ce numéro est trop long."),
  identifiant: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Utilisez au moins 3 caractères.")
    .max(80, "Cet identifiant est trop long.")
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, "Utilisez uniquement des lettres minuscules, chiffres, points, tirets ou underscores."),
  role: z.enum(["admin", "recruiter", "viewer"], {
    message: "Choisissez un rôle valide.",
  }),
});

function temporaryPassword() {
  return `Zr9!${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function ownerWithOrganisation() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (profile.role !== "owner") redirect("/dashboard");
  if (!profile.organisation_id || !profile.organisation) redirect("/dashboard/organisation/nouvelle");
  return profile;
}

export async function createCollaboratorAction(
  _state: CollaboratorState,
  formData: FormData,
): Promise<CollaboratorState> {
  const owner = await ownerWithOrganisation();
  const parsed = collaboratorSchema.safeParse({
    fullname: formData.get("fullname"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    identifiant: formData.get("identifiant"),
    role: formData.get("role"),
  });

  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const admin = createAdminClient();
  const [{ data: identifierExists }, { data: emailExists }] = await Promise.all([
    admin.from("profiles").select("id").eq("identifiant", parsed.data.identifiant).maybeSingle(),
    admin.from("profiles").select("id").eq("email", parsed.data.email).maybeSingle(),
  ]);

  const errors: Record<string, string[]> = {};
  if (identifierExists) errors.identifiant = ["Cet identifiant est déjà utilisé."];
  if (emailExists) errors.email = ["Cette adresse email est déjà associée à un compte."];
  if (Object.keys(errors).length) return { errors };

  const password = temporaryPassword();
  const { data: createdUser, error: authError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.fullname,
      organisation_id: owner.organisation_id,
      role: parsed.data.role,
      created_by: owner.id,
    },
  });

  if (authError || !createdUser.user) {
    const emailConflict = authError?.message.toLowerCase().includes("already") || authError?.message.toLowerCase().includes("registered");
    return emailConflict
      ? { errors: { email: ["Cette adresse email possède déjà un compte."] } }
      : { message: "Le compte du collaborateur n’a pas pu être créé. Réessayez." };
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: createdUser.user.id,
    fullname: parsed.data.fullname,
    email: parsed.data.email,
    phone: parsed.data.phone || null,
    identifiant: parsed.data.identifiant,
    role: parsed.data.role,
    organisation_id: owner.organisation_id,
    must_change_password: true,
    is_active: true,
    meta_data: {
      created_by: owner.id,
      creation_method: "organisation",
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });

  if (profileError) {
    await admin.auth.admin.deleteUser(createdUser.user.id);
    if (profileError.code === "23505") {
      return { message: "Cet email ou cet identifiant est déjà utilisé." };
    }
    return { message: "Le profil du collaborateur n’a pas pu être créé. Aucun compte incomplet n’a été conservé." };
  }

  revalidatePath("/dashboard/equipe");
  return {
    success: "Le collaborateur a été créé. Transmettez-lui ces accès de façon sécurisée.",
    credentials: {
      fullname: parsed.data.fullname,
      identifiant: parsed.data.identifiant,
      temporaryPassword: password,
    },
  };
}

export async function setCollaboratorStatusAction(targetId: string, active: boolean) {
  const owner = await ownerWithOrganisation();
  const parsedTargetId = z.string().uuid().safeParse(targetId);
  if (!parsedTargetId.success) return;

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, role, organisation_id")
    .eq("id", parsedTargetId.data)
    .eq("organisation_id", owner.organisation_id)
    .maybeSingle();

  if (!target || target.role === "owner") return;

  await admin
    .from("profiles")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", target.id)
    .eq("organisation_id", owner.organisation_id);

  revalidatePath("/dashboard/equipe");
}
