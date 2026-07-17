import type { Metadata } from "next";
import { UnifiedAuthForm } from "@/components/auth/credentials-form";

export const metadata: Metadata = { title: "Créer un compte" };
export default function SignupPage() { return <UnifiedAuthForm />; }
