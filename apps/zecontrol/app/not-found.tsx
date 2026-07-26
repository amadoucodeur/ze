import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ZeControlLogo } from "@ze/ui-foundations/brands";

export default function NotFound() {
  return (
    <main className="zec-not-found">
      <header className="zec-not-found-header">
        <Link href="/" aria-label="ZeControl, revenir à l’accueil">
          <ZeControlLogo />
        </Link>
      </header>

      <section className="zec-not-found-content" aria-labelledby="not-found-title">
        <div className="zec-not-found-visual" aria-hidden="true">
          <span>4</span>
          <svg viewBox="0 0 160 160" role="presentation">
            <circle className="zec-not-found-orbit" cx="80" cy="80" r="68" />
            <circle className="zec-not-found-clock" cx="80" cy="80" r="49" />
            <circle className="zec-not-found-clock-inner" cx="80" cy="80" r="42" />
            <g className="zec-not-found-hands">
              <path d="M80 80V50" />
              <path d="M80 80L104 92" />
              <circle cx="80" cy="80" r="5" />
            </g>
            <circle className="zec-not-found-orbit-dot" cx="80" cy="12" r="5" />
          </svg>
          <span>4</span>
        </div>

        <p className="zec-not-found-kicker">Vous êtes sorti du cadre</p>
        <h1 id="not-found-title">Cette page n’existe pas.</h1>
        <p className="zec-not-found-copy">
          Le lien est peut-être incorrect ou la page a été déplacée.
        </p>

        <Link className="button button-primary zec-not-found-action" href="/">
          <ArrowLeft size={18} />
          Revenir à l’accueil
        </Link>
      </section>

      <p className="zec-not-found-signature">Temps &amp; présences, simplement.</p>
    </main>
  );
}
