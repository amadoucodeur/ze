"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/current-profile";
import { composeAuthEmail, composeLoginIdentifier, USER_IDENTIFIER_PATTERN } from "@/lib/identifiers";
import { getPlan, hasActivePlanAccess } from "@/lib/billing/plans";
import { getSeatCapacity } from "@/lib/billing/entitlements";

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

export type CollaboratorUpdateState = {
  message?: string;
  success?: string;
  errors?: Record<string, string[]>;
};

export type CollaboratorPasswordState = CollaboratorUpdateState & {
  credentials?: {
    identifiant: string;
    temporaryPassword: string;
  };
};

const collaboratorIdentitySchema = z.object({
  fullname: z.string().trim().min(2, "Saisissez le nom complet.").max(100, "Ce nom est trop long."),
  email: z.string().trim().toLowerCase().email("Saisissez une adresse email valide."),
  phone: z.string().trim().max(30, "Ce numéro est trop long."),
  identifiant: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Utilisez au moins 3 caractères.")
    .max(48, "Cet identifiant est trop long.")
    .regex(USER_IDENTIFIER_PATTERN, "Utilisez uniquement des lettres minuscules, chiffres, points, tirets ou underscores."),
  role: z.enum(["admin", "recruiter", "viewer"], {
    message: "Choisissez un rôle valide.",
  }),
});

const passwordChoiceSchema = z
  .object({
    passwordMode: z.enum(["generated", "custom"]),
    password: z.string().max(128, "Ce mot de passe est trop long."),
  })
  .superRefine((value, context) => {
    if (value.passwordMode === "custom" && value.password.length < 8) {
      context.addIssue({ code: "custom", path: ["password"], message: "Utilisez au moins 8 caractères." });
    }
  });

const collaboratorSchema = collaboratorIdentitySchema.and(passwordChoiceSchema);

function temporaryPassword() {
  return `Zr9!${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function managerWithOrganisation() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");
  if (profile.role !== "owner" && profile.role !== "admin") redirect("/dashboard");
  if (!profile.organisation_id || !profile.organisation) {
    redirect(profile.role === "owner" ? "/dashboard/organisation/nouvelle" : "/dashboard");
  }
  return profile;
}

export async function createCollaboratorAction(
  _state: CollaboratorState,
  formData: FormData,
): Promise<CollaboratorState> {
  const manager = await managerWithOrganisation();
  const parsed = collaboratorSchema.safeParse({
    fullname: formData.get("fullname"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    identifiant: formData.get("identifiant"),
    role: formData.get("role"),
    passwordMode: formData.get("passwordMode"),
    password: formData.get("password") ?? "",
  });

  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const admin = createAdminClient();
  const organisation = manager.organisation;
  if (!organisation) redirect("/dashboard/organisation/nouvelle");
  if (!hasActivePlanAccess(organisation)) {
    return { message: "La période d’accès de l’organisation est terminée. Le propriétaire doit renouveler le plan avant d’ajouter un collaborateur." };
  }
  const plan = getPlan(organisation.plan);
  const { count: activeSeatCount } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("organisation_id", manager.organisation_id).eq("is_active", true);
  if (plan.seatLimit !== null && (activeSeatCount ?? 0) >= plan.seatLimit) {
    return { message: `Le plan ${plan.name} inclut ${plan.seatLimit} utilisateur${plan.seatLimit > 1 ? "s" : ""}. Le propriétaire peut choisir un plan supérieur depuis la facturation.` };
  }
  const loginIdentifier = composeLoginIdentifier(parsed.data.identifiant, organisation.identifiant);
  const [{ data: identifierExists }, { data: emailExists }] = await Promise.all([
    admin.from("profiles").select("id").eq("identifiant", loginIdentifier).maybeSingle(),
    admin.from("profiles").select("id").eq("email", parsed.data.email).maybeSingle(),
  ]);

  const errors: Record<string, string[]> = {};
  if (identifierExists) errors.identifiant = ["Cet identifiant est déjà utilisé."];
  if (emailExists) errors.email = ["Cette adresse email est déjà associée à un compte."];
  if (Object.keys(errors).length) return { errors };

  const password = parsed.data.passwordMode === "custom" ? parsed.data.password : temporaryPassword();
  const authenticationEmail = composeAuthEmail(loginIdentifier);
  const { data: createdUser, error: authError } = await admin.auth.admin.createUser({
    email: authenticationEmail,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.fullname,
      organisation_id: manager.organisation_id,
      role: parsed.data.role,
      created_by: manager.id,
      contact_email: parsed.data.email,
      login_identifier: loginIdentifier,
    },
  });

  if (authError || !createdUser.user) {
    const identifierConflict = authError?.message.toLowerCase().includes("already") || authError?.message.toLowerCase().includes("registered");
    return identifierConflict
      ? { errors: { identifiant: ["Cet identifiant possède déjà un compte."] } }
      : { message: "Le compte du collaborateur n’a pas pu être créé. Réessayez." };
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: createdUser.user.id,
    fullname: parsed.data.fullname,
    email: parsed.data.email,
    phone: parsed.data.phone || null,
    identifiant: loginIdentifier,
    role: parsed.data.role,
    organisation_id: manager.organisation_id,
    must_change_password: true,
    is_active: true,
    meta_data: {
      created_by: manager.id,
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
      identifiant: loginIdentifier,
      temporaryPassword: password,
    },
  };
}

export async function setCollaboratorStatusAction(targetId: string, active: boolean) {
  const manager = await managerWithOrganisation();
  const parsedTargetId = z.string().uuid().safeParse(targetId);
  if (!parsedTargetId.success) return;
  if (active && manager.organisation) {
    const capacity = await getSeatCapacity(manager.organisation);
    if (!capacity.allowed) redirect(`/dashboard/equipe/${targetId}?statusError=${capacity.reason === "inactive" ? "inactive-plan" : "seat-limit"}`);
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, role, organisation_id")
    .eq("id", parsedTargetId.data)
    .eq("organisation_id", manager.organisation_id)
    .maybeSingle();

  if (!target || target.role === "owner" || target.id === manager.id) return;

  const { error: authError } = await admin.auth.admin.updateUserById(target.id, {
    ban_duration: active ? "none" : "876000h",
  });
  if (authError) redirect(`/dashboard/equipe/${target.id}?statusError=update`);

  const { error: profileError } = await admin
    .from("profiles")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", target.id)
    .eq("organisation_id", manager.organisation_id);

  if (profileError) {
    await admin.auth.admin.updateUserById(target.id, {
      ban_duration: active ? "876000h" : "none",
    });
    redirect(`/dashboard/equipe/${target.id}?statusError=${profileError.message.includes("plan_seat_limit_reached") ? "seat-limit" : "update"}`);
  }

  revalidatePath("/dashboard/equipe");
  revalidatePath(`/dashboard/equipe/${target.id}`);
  redirect(`/dashboard/equipe/${target.id}?status=${active ? "reactivated" : "suspended"}`);
}

export async function updateCollaboratorAction(
  targetId: string,
  _state: CollaboratorUpdateState,
  formData: FormData,
): Promise<CollaboratorUpdateState> {
  const manager = await managerWithOrganisation();
  const parsedTargetId = z.string().uuid().safeParse(targetId);
  if (!parsedTargetId.success) return { message: "Ce collaborateur est introuvable." };

  const parsed = collaboratorIdentitySchema.safeParse({
    fullname: formData.get("fullname"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    identifiant: formData.get("identifiant"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, fullname, email, identifiant, role, organisation_id")
    .eq("id", parsedTargetId.data)
    .eq("organisation_id", manager.organisation_id)
    .maybeSingle();
  if (!target || target.role === "owner" || target.id === manager.id) return { message: "Ce collaborateur ne peut pas être modifié." };

  const organisation = manager.organisation;
  if (!organisation) return { message: "Votre organisation est introuvable." };
  const loginIdentifier = composeLoginIdentifier(parsed.data.identifiant, organisation.identifiant);
  const [{ data: identifierExists }, { data: emailExists }] = await Promise.all([
    admin.from("profiles").select("id").eq("identifiant", loginIdentifier).neq("id", target.id).maybeSingle(),
    admin.from("profiles").select("id").eq("email", parsed.data.email).neq("id", target.id).maybeSingle(),
  ]);
  const errors: Record<string, string[]> = {};
  if (identifierExists) errors.identifiant = ["Cet identifiant est déjà utilisé."];
  if (emailExists) errors.email = ["Cette adresse email est déjà associée à un compte."];
  if (Object.keys(errors).length) return { errors };

  const { data: authUser, error: authLookupError } = await admin.auth.admin.getUserById(target.id);
  if (authLookupError || !authUser.user) return { message: "Le compte d’authentification est introuvable." };

  const previousAuthEmail = authUser.user.email;
  const previousMetadata = authUser.user.user_metadata;
  const nextMetadata = {
    ...previousMetadata,
    full_name: parsed.data.fullname,
    organisation_id: manager.organisation_id,
    role: parsed.data.role,
    contact_email: parsed.data.email,
    login_identifier: loginIdentifier,
  };
  const { error: authError } = await admin.auth.admin.updateUserById(target.id, {
    email: composeAuthEmail(loginIdentifier),
    email_confirm: true,
    user_metadata: nextMetadata,
  });
  if (authError) {
    return authError.message.toLowerCase().includes("already")
      ? { errors: { identifiant: ["Cet identifiant possède déjà un compte."] } }
      : { message: "Les accès du collaborateur n’ont pas pu être modifiés. Réessayez." };
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      fullname: parsed.data.fullname,
      email: parsed.data.email,
      phone: parsed.data.phone || null,
      identifiant: loginIdentifier,
      role: parsed.data.role,
      updated_at: new Date().toISOString(),
    })
    .eq("id", target.id)
    .eq("organisation_id", manager.organisation_id);

  if (profileError) {
    if (previousAuthEmail) {
      await admin.auth.admin.updateUserById(target.id, {
        email: previousAuthEmail,
        email_confirm: true,
        user_metadata: previousMetadata,
      });
    }
    return { message: "Les modifications n’ont pas été enregistrées. Aucun accès incohérent n’a été conservé." };
  }

  revalidatePath("/dashboard/equipe");
  revalidatePath(`/dashboard/equipe/${target.id}`);
  return { success: "Les informations et le rôle du collaborateur ont été mis à jour." };
}

export async function resetCollaboratorPasswordAction(
  targetId: string,
  _state: CollaboratorPasswordState,
  formData: FormData,
): Promise<CollaboratorPasswordState> {
  const manager = await managerWithOrganisation();
  const parsedTargetId = z.string().uuid().safeParse(targetId);
  if (!parsedTargetId.success) return { message: "Ce collaborateur est introuvable." };
  const parsed = passwordChoiceSchema.safeParse({
    passwordMode: formData.get("passwordMode"),
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, identifiant, role, organisation_id, must_change_password")
    .eq("id", parsedTargetId.data)
    .eq("organisation_id", manager.organisation_id)
    .maybeSingle();
  if (!target || target.role === "owner" || target.id === manager.id) return { message: "Ce collaborateur ne peut pas être modifié." };

  const password = parsed.data.passwordMode === "custom" ? parsed.data.password : temporaryPassword();
  const { error: flagError } = await admin
    .from("profiles")
    .update({ must_change_password: true, updated_at: new Date().toISOString() })
    .eq("id", target.id)
    .eq("organisation_id", manager.organisation_id);
  if (flagError) return { message: "La réinitialisation n’a pas pu être préparée. Réessayez." };

  const { error: authError } = await admin.auth.admin.updateUserById(target.id, { password });
  if (authError) {
    await admin
      .from("profiles")
      .update({ must_change_password: target.must_change_password })
      .eq("id", target.id)
      .eq("organisation_id", manager.organisation_id);
    return { message: "Le mot de passe n’a pas pu être réinitialisé. Réessayez." };
  }

  revalidatePath(`/dashboard/equipe/${target.id}`);
  return {
    success: "Le mot de passe de départ est prêt. Transmettez-le de façon sécurisée.",
    credentials: { identifiant: target.identifiant, temporaryPassword: password },
  };
}
