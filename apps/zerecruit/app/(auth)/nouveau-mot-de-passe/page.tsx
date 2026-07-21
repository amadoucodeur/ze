import type { Metadata } from "next";
import { NewPasswordForm } from "@/components/auth/password-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nouveau mot de passe" };
export default function NewPasswordPage() { return <NewPasswordForm />; }
