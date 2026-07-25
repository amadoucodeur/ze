import type { Metadata } from "next";
import { UnifiedAuthForm } from "@/components/auth/credentials-form";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  return <UnifiedAuthForm />;
}
