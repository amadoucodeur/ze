import Link from "next/link";
import { ArrowLeft, Clock3, ShieldCheck } from "lucide-react";
import { ZeControlLogo, ZeSuiteLogo } from "@ze/ui-foundations/brands";

const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL ?? "http://localhost:3002";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand-top">
          <ZeControlLogo inverse />
          <Link href="/">
            <ArrowLeft size={16} /> Retour au site
          </Link>
        </div>

        <div className="auth-brand-copy">
          <span className="auth-kicker">
            <Clock3 size={15} /> Temps & présences
          </span>
          <h1>Votre temps.<br />Simplement.</h1>
          <p>
            Connectez-vous pour pointer ou gérer votre équipe.
          </p>
          <div className="auth-benefits">
            <span><ShieldCheck size={16} /> Un accès adapté à votre rôle</span>
            <span><ShieldCheck size={16} /> Données isolées par organisation</span>
          </div>
        </div>

        <a className="auth-suite-link" href={portalUrl}>
          <ZeSuiteLogo compact inverse />
          <span>Découvrir les produits ZeSuite</span>
        </a>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-card">{children}</div>
      </section>
    </main>
  );
}
