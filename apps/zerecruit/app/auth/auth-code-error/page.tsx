import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

type AuthCodeErrorPageProps = {
  searchParams: Promise<{ reason?: string }>;
};

export default async function AuthCodeErrorPage({ searchParams }: AuthCodeErrorPageProps) {
  const { reason } = await searchParams;
  const wrongMethod = reason === "login-method";

  return <main className="simple-state-page"><BrandLogo /><div className="state-card"><span><AlertCircle size={25} /></span><h1>{wrongMethod ? "Utilisez votre accès d’équipe." : "Le lien n’est plus valide."}</h1><p>{wrongMethod ? "Ce compte a été créé par une organisation. Connectez-vous avec l’identifiant et le mot de passe qui vous ont été communiqués." : "Il a peut-être expiré ou déjà été utilisé. Relancez la connexion pour recevoir un nouveau lien sécurisé."}</p><Link className="button button-primary" href="/connexion">Retour à la connexion <ArrowRight size={18} /></Link></div></main>;
}
