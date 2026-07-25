import Link from "next/link";
import { ArrowLeft, Check, Clock3, ShieldCheck } from "lucide-react";
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
            <Clock3 size={15} /> Un accès ZeSuite
          </span>
          <h1>Le même compte.<br />Votre espace temps.</h1>
          <p>
            Utilisez votre identité ZeSuite existante ou créez votre espace
            directement depuis ZeControl.
          </p>
          <div className="auth-benefits">
            <span><Check size={16} /> Identité ZeSuite conservée</span>
            <span><Check size={16} /> Accès séparé par produit</span>
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
