import type { Metadata } from "next";
import { ResetRequestForm } from "@/components/auth/password-form";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return <ResetRequestForm />;
}
