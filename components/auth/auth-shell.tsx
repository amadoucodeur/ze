import { ArrowLeft, Check, Sparkles } from "lucide-react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand-glow" />
        <BrandLogo variant="light" />
        <div className="auth-brand-copy">
          <span className="auth-kicker"><Sparkles size={15} /> Votre vivier, enfin intelligent</span>
          <h1>Le bon candidat.<br />Au bon moment.</h1>
          <p>Rejoignez les équipes qui transforment chaque CV reçu en opportunité de recrutement.</p>
          <div className="auth-benefits"><span><Check size={16} /> Recherche en langage naturel</span><span><Check size={16} /> Matching clair et explicable</span><span><Check size={16} /> Données isolées par organisation</span></div>
        </div>
        <div className="auth-quote"><p>“La technologie doit aider les recruteurs à voir plus loin, sans perdre l’humain de vue.”</p><span>L’ambition ZeRecruit</span></div>
      </section>
      <section className="auth-form-panel">
        <Link href="/" className="back-home"><ArrowLeft size={17} /> Retour à l’accueil</Link>
        <div className="auth-form-wrap">{children}</div>
        <p className="auth-legal">En continuant, vous acceptez les conditions d’utilisation et la politique de confidentialité de ZeRecruit.</p>
      </section>
    </main>
  );
}
