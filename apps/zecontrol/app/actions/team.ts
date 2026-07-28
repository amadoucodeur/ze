"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  composeAuthEmail,
  composeLoginIdentifier,
  USER_IDENTIFIER_PATTERN,
} from "@/lib/identifiers";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";
import { createAdminClient } from "@/lib/supabase/admin";

export type TeamFormState = {
  message?: string;
  success?: string;
  errors?: Record<string, string[]>;
};

export type CollaboratorState = TeamFormState & {
  credentials?: {
    fullname: string;
    identifiant: string;
    temporaryPassword: string;
  };
};

export type PasswordState = TeamFormState & {
  credentials?: { identifiant: string; temporaryPassword: string };
};

const productConfigSchema = z.object({
  role: z.enum(["admin", "agent"], { message: "Choisissez un rôle valide." }),
  policy: z.enum(["strict", "flexible", "free"], {
    message: "Choisissez une politique valide.",
  }),
  canRemote: z.boolean(),
  poste: z.string().trim().max(100, "Ce poste est trop long."),
  service: z.string().trim().max(100, "Ce service est trop long."),
});

const identitySchema = z.object({
  fullname: z.string().trim().min(2, "Saisissez le nom complet.").max(100),
  email: z.string().trim().toLowerCase().email("Saisissez une adresse email valide."),
  phone: z.string().trim().max(30, "Ce numéro est trop long."),
  identifiant: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Utilisez au moins 3 caractères.")
    .max(48, "Cet identifiant est trop long.")
    .regex(
      USER_IDENTIFIER_PATTERN,
      "Utilisez uniquement des lettres minuscules, chiffres, points, tirets ou underscores.",
    ),
});

const passwordChoiceSchema = z
  .object({
    passwordMode: z.enum(["generated", "custom"]),
    password: z.string().max(128, "Ce mot de passe est trop long."),
  })
  .superRefine((value, context) => {
    if (value.passwordMode === "custom" && value.password.length < 8) {
      context.addIssue({
        code: "custom",
        path: ["password"],
        message: "Utilisez au moins 8 caractères.",
      });
    }
  });

const collaboratorSchema = identitySchema.and(productConfigSchema).and(passwordChoiceSchema);
const updateSchema = identitySchema.and(productConfigSchema);

function generatedPassword() {
  return `Zc9!${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function productInput(formData: FormData) {
  return {
    role: formData.get("role"),
    policy: formData.get("policy"),
    canRemote: formData.get("canRemote") === "on",
    poste: formData.get("poste"),
    service: formData.get("service"),
  };
}

async function managerContext() {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/connexion");
  const organisation = access.organisation;
  const productProfile = access.productProfile;
  if (access.status !== "ready" || !organisation || !productProfile) {
    redirect("/dashboard");
  }
  if (productProfile.role !== "owner" && productProfile.role !== "admin") {
    redirect("/dashboard");
  }
  return { ...access, organisation, productProfile };
}

export async function activateExistingCollaboratorAction(targetId: string) {
  const manager = await managerContext();
  const parsedId = z.string().uuid().safeParse(targetId);
  if (!parsedId.success || parsedId.data === manager.profile.id) return;

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, role, is_active, organisation_id")
    .eq("id", parsedId.data)
    .eq("organisation_id", manager.organisation.id)
    .maybeSingle();
  if (!target || !target.is_active || target.role === "owner") return;

  const { data: existingConfig, error: lookupError } = await admin
    .schema("zecontrol")
    .from("profiles_configs")
    .select("id")
    .eq("id", target.id)
    .maybeSingle();
  if (lookupError) redirect("/dashboard/equipe?error=activation");

  const now = new Date().toISOString();
  const result = existingConfig
    ? await admin
        .schema("zecontrol")
        .from("profiles_configs")
        .update({ is_active: true, updated_at: now })
        .eq("id", target.id)
    : await admin.schema("zecontrol").from("profiles_configs").insert({
        id: target.id,
        role: "agent",
        policy: "strict",
        can_remote: false,
        is_active: true,
        updated_at: now,
      });

  if (result.error) redirect("/dashboard/equipe?error=activation");
  revalidatePath("/dashboard/equipe");
  redirect(`/dashboard/equipe/${target.id}?status=activated`);
}

export async function createCollaboratorAction(
  _state: CollaboratorState,
  formData: FormData,
): Promise<CollaboratorState> {
  const manager = await managerContext();
  const parsed = collaboratorSchema.safeParse({
    fullname: formData.get("fullname"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    identifiant: formData.get("identifiant"),
    ...productInput(formData),
    passwordMode: formData.get("passwordMode"),
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const admin = createAdminClient();
  const loginIdentifier = composeLoginIdentifier(
    parsed.data.identifiant,
    manager.organisation.identifiant,
  );
  const [{ data: identifierExists }, { data: emailExists }] = await Promise.all([
    admin.from("profiles").select("id").eq("identifiant", loginIdentifier).maybeSingle(),
    admin.from("profiles").select("id, organisation_id").eq("email", parsed.data.email).maybeSingle(),
  ]);
  const errors: Record<string, string[]> = {};
  if (identifierExists) errors.identifiant = ["Cet identifiant est déjà utilisé."];
  if (emailExists) {
    errors.email = [
      emailExists.organisation_id === manager.organisation.id
        ? "Ce profil existe déjà dans ZeSuite. Activez-le depuis la liste des utilisateurs disponibles."
        : "Cette adresse email est déjà associée à un autre compte.",
    ];
  }
  if (Object.keys(errors).length) return { errors };

  const password =
    parsed.data.passwordMode === "custom"
      ? parsed.data.password
      : generatedPassword();
  const { data: createdUser, error: authError } = await admin.auth.admin.createUser({
    email: composeAuthEmail(loginIdentifier),
    password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.fullname,
      organisation_id: manager.organisation.id,
      zecontrol_role: parsed.data.role,
      created_by: manager.profile.id,
      created_product: "zecontrol",
      contact_email: parsed.data.email,
      login_identifier: loginIdentifier,
    },
  });
  if (authError || !createdUser.user) {
    return authError?.message.toLowerCase().includes("already")
      ? { errors: { identifiant: ["Cet identifiant possède déjà un compte."] } }
      : { message: "Le compte du collaborateur n’a pas pu être créé. Réessayez." };
  }

  const now = new Date().toISOString();
  // Auth may create the shared ZeSuite profile through its database trigger.
  // Upsert completes that row instead of failing on its primary key.
  const { error: profileError } = await admin.from("profiles").upsert({
    id: createdUser.user.id,
    fullname: parsed.data.fullname,
    email: parsed.data.email,
    phone: parsed.data.phone || null,
    identifiant: loginIdentifier,
    role: "viewer",
    organisation_id: manager.organisation.id,
    must_change_password: true,
    is_active: true,
    meta_data: {
      created_by: manager.profile.id,
      creation_method: "organisation",
      created_product: "zecontrol",
    },
    updated_at: now,
  }, { onConflict: "id" });
  if (profileError) {
    console.error("ZeControl collaborator profile creation failed", {
      code: profileError.code,
      message: profileError.message,
      details: profileError.details,
      hint: profileError.hint,
    });
    await admin.auth.admin.deleteUser(createdUser.user.id);
    if (profileError.code === "23505") {
      return { message: "Cet email ou cet identifiant est déjà utilisé." };
    }
    return { message: "Le profil n’a pas pu être créé. Aucun compte incomplet n’a été conservé." };
  }

  const { error: configError } = await admin
    .schema("zecontrol")
    .from("profiles_configs")
    .insert({
      id: createdUser.user.id,
      role: parsed.data.role,
      policy: parsed.data.policy,
      can_remote: parsed.data.canRemote,
      poste: parsed.data.poste || null,
      service: parsed.data.service || null,
      is_active: true,
      updated_at: now,
    });
  if (configError) {
    await admin.from("profiles").delete().eq("id", createdUser.user.id);
    await admin.auth.admin.deleteUser(createdUser.user.id);
    return { message: "L’accès ZeControl n’a pas pu être créé. Aucun compte incomplet n’a été conservé." };
  }

  revalidatePath("/dashboard/equipe");
  return {
    success: "Le collaborateur a été créé.",
    credentials: {
      fullname: parsed.data.fullname,
      identifiant: loginIdentifier,
      temporaryPassword: password,
    },
  };
}

export async function updateCollaboratorAction(
  targetId: string,
  _state: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const manager = await managerContext();
  const parsedId = z.string().uuid().safeParse(targetId);
  if (!parsedId.success) return { message: "Ce collaborateur est introuvable." };
  const parsed = updateSchema.safeParse({
    fullname: formData.get("fullname"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    identifiant: formData.get("identifiant"),
    ...productInput(formData),
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const admin = createAdminClient();
  const [{ data: target }, { data: config }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, fullname, email, phone, identifiant, role, organisation_id")
      .eq("id", parsedId.data)
      .eq("organisation_id", manager.organisation.id)
      .maybeSingle(),
    admin
      .schema("zecontrol")
      .from("profiles_configs")
      .select("id, role, policy, can_remote, poste, service")
      .eq("id", parsedId.data)
      .maybeSingle(),
  ]);
  if (!target || !config || config.role === "owner" || target.id === manager.profile.id) {
    return { message: "Ce collaborateur ne peut pas être modifié." };
  }

  const loginIdentifier = composeLoginIdentifier(
    parsed.data.identifiant,
    manager.organisation.identifiant,
  );
  const [{ data: identifierExists }, { data: emailExists }] = await Promise.all([
    admin.from("profiles").select("id").eq("identifiant", loginIdentifier).neq("id", target.id).maybeSingle(),
    admin.from("profiles").select("id").eq("email", parsed.data.email).neq("id", target.id).maybeSingle(),
  ]);
  const errors: Record<string, string[]> = {};
  if (identifierExists) errors.identifiant = ["Cet identifiant est déjà utilisé."];
  if (emailExists) errors.email = ["Cette adresse email est déjà associée à un compte."];
  if (Object.keys(errors).length) return { errors };

  const { data: authUser, error: authLookupError } =
    await admin.auth.admin.getUserById(target.id);
  if (authLookupError || !authUser.user) {
    return { message: "Le compte d’authentification est introuvable." };
  }
  const previousAuthEmail = authUser.user.email;
  const previousMetadata = authUser.user.user_metadata;
  const { error: authError } = await admin.auth.admin.updateUserById(target.id, {
    email: composeAuthEmail(loginIdentifier),
    email_confirm: true,
    user_metadata: {
      ...previousMetadata,
      full_name: parsed.data.fullname,
      contact_email: parsed.data.email,
      login_identifier: loginIdentifier,
      zecontrol_role: parsed.data.role,
    },
  });
  if (authError) return { message: "Les accès n’ont pas pu être modifiés. Réessayez." };

  const now = new Date().toISOString();
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      fullname: parsed.data.fullname,
      email: parsed.data.email,
      phone: parsed.data.phone || null,
      identifiant: loginIdentifier,
      updated_at: now,
    })
    .eq("id", target.id)
    .eq("organisation_id", manager.organisation.id);
  if (profileError) {
    if (previousAuthEmail) {
      await admin.auth.admin.updateUserById(target.id, {
        email: previousAuthEmail,
        email_confirm: true,
        user_metadata: previousMetadata,
      });
    }
    return { message: "Les informations n’ont pas été enregistrées." };
  }

  const { error: configError } = await admin
    .schema("zecontrol")
    .from("profiles_configs")
    .update({
      role: parsed.data.role,
      policy: parsed.data.policy,
      can_remote: parsed.data.canRemote,
      poste: parsed.data.poste || null,
      service: parsed.data.service || null,
      updated_at: now,
    })
    .eq("id", target.id);
  if (configError) {
    await admin.from("profiles").update({
      fullname: target.fullname,
      email: target.email,
      phone: target.phone,
      identifiant: target.identifiant,
      updated_at: now,
    }).eq("id", target.id);
    if (previousAuthEmail) {
      await admin.auth.admin.updateUserById(target.id, {
        email: previousAuthEmail,
        email_confirm: true,
        user_metadata: previousMetadata,
      });
    }
    return { message: "La configuration ZeControl n’a pas été enregistrée." };
  }

  revalidatePath("/dashboard/equipe");
  revalidatePath(`/dashboard/equipe/${target.id}`);
  return { success: "Les informations et la configuration ont été mises à jour." };
}

export async function setCollaboratorStatusAction(targetId: string, active: boolean) {
  const manager = await managerContext();
  const parsedId = z.string().uuid().safeParse(targetId);
  if (!parsedId.success || parsedId.data === manager.profile.id) return;
  const admin = createAdminClient();
  const { data: config } = await admin
    .schema("zecontrol")
    .from("profiles_configs")
    .select("id, role")
    .eq("id", parsedId.data)
    .maybeSingle();
  const { data: target } = await admin
    .from("profiles")
    .select("id")
    .eq("id", parsedId.data)
    .eq("organisation_id", manager.organisation.id)
    .maybeSingle();
  if (!config || !target || config.role === "owner") return;

  const { error } = await admin
    .schema("zecontrol")
    .from("profiles_configs")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", target.id);
  if (error) redirect(`/dashboard/equipe/${target.id}?statusError=update`);
  revalidatePath("/dashboard/equipe");
  redirect(`/dashboard/equipe/${target.id}?status=${active ? "reactivated" : "suspended"}`);
}

export async function resetCollaboratorPasswordAction(
  targetId: string,
  _state: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const manager = await managerContext();
  const parsedId = z.string().uuid().safeParse(targetId);
  if (!parsedId.success || parsedId.data === manager.profile.id) {
    return { message: "Ce collaborateur est introuvable." };
  }
  const parsed = passwordChoiceSchema.safeParse({
    passwordMode: formData.get("passwordMode"),
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const admin = createAdminClient();
  const [{ data: target }, { data: config }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, identifiant, organisation_id, must_change_password")
      .eq("id", parsedId.data)
      .eq("organisation_id", manager.organisation.id)
      .maybeSingle(),
    admin
      .schema("zecontrol")
      .from("profiles_configs")
      .select("id, role")
      .eq("id", parsedId.data)
      .maybeSingle(),
  ]);
  if (!target || !config || config.role === "owner") {
    return { message: "Ce collaborateur ne peut pas être modifié." };
  }

  const password =
    parsed.data.passwordMode === "custom"
      ? parsed.data.password
      : generatedPassword();
  const { error: flagError } = await admin
    .from("profiles")
    .update({ must_change_password: true, updated_at: new Date().toISOString() })
    .eq("id", target.id)
    .eq("organisation_id", manager.organisation.id);
  if (flagError) return { message: "La réinitialisation n’a pas pu être préparée." };

  const { error: authError } = await admin.auth.admin.updateUserById(target.id, {
    password,
  });
  if (authError) {
    await admin
      .from("profiles")
      .update({ must_change_password: target.must_change_password })
      .eq("id", target.id);
    return { message: "Le mot de passe n’a pas pu être réinitialisé." };
  }

  revalidatePath(`/dashboard/equipe/${target.id}`);
  return {
    success: "Le mot de passe de départ est prêt.",
    credentials: { identifiant: target.identifiant, temporaryPassword: password },
  };
}
