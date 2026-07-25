import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";
import { ZeControlLogo } from "@ze/ui-foundations/brands";

type AuthCodeErrorPageProps = {
  searchParams: Promise<{ reason?: string }>;
};

export default async function AuthCodeErrorPage({
  searchParams,
}: AuthCodeErrorPageProps) {
  const { reason } = await searchParams;
  const wrongMethod = reason === "login-method";
  const missingProfile = reason === "profile";

  return (
    <main className="simple-state-page">
      <ZeControlLogo />
      <div className="state-card">
        <span><AlertCircle size={25} /></span>
        <h1>
          {wrongMethod
            ? "Utilisez l’accès prévu pour votre compte."
            : missingProfile
              ? "Ce compte n’est pas encore rattaché à ZeSuite."
              : "La connexion n’a pas abouti."}
        </h1>
        <p>
          {wrongMethod
            ? "Les propriétaires utilisent Google. Les collaborateurs utilisent l’identifiant et le mot de passe fournis par leur organisation."
            : missingProfile
              ? "Connectez-vous avec un compte ZeSuite existant ou contactez l’administrateur de votre organisation."
              : "Le lien a peut-être expiré ou déjà été utilisé. Relancez simplement la connexion."}
        </p>
        <Link className="button button-primary" href="/connexion">
          Retour à la connexion <ArrowRight size={18} />
        </Link>
      </div>
    </main>
  );
}
