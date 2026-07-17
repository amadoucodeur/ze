import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Headphones, Menu, ScanSearch, ShieldCheck, Sparkles, Users } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { PricingCards } from "@/components/pricing-cards";

export const metadata: Metadata = {
  title: "Plans et tarifs",
  description: "Choisissez le plan ZeRecruit adapté à votre équipe et transformez votre CVthèque en vivier de talents intelligent.",
};

const comparisonRows = [
  ["Période d’accès", "1 mois", "Abonnement", "Abonnement", "Sur mesure"],
  ["Utilisateurs inclus", "1", "1", "8", "Sur mesure"],
  ["Profils dans le vivier", "100", "1 000", "10 000", "Sur mesure"],
  ["Nouveaux CV par mois", "Inclus", "100", "500", "Sur mesure"],
  ["Recherche intelligente", true, true, true, true],
  ["Matching candidat–offre", "3 / mois", true, true, true],
  ["Rôles et accès d’équipe", "—", "—", true, true],
  ["Support prioritaire", "—", "—", true, true],
  ["Paramétrage accompagné", "—", "—", "—", true],
] as const;

export default function PlansPage() {
  return (
    <main className="marketing-page plans-page">
      <a className="skip-link" href="#main-content">Aller au contenu principal</a>
      <header className="site-header">
        <div className="container nav-wrap">
          <BrandLogo />
          <nav className="desktop-nav" aria-label="Navigation principale">
            <Link href="/#produit">Produit</Link>
            <Link href="/#fonctionnement">Comment ça marche</Link>
            <Link className="nav-current" href="/plans">Plans</Link>
            <Link href="/#faq">FAQ</Link>
          </nav>
          <details className="mobile-menu">
            <summary aria-label="Ouvrir le menu"><Menu size={20} /></summary>
            <nav aria-label="Navigation mobile">
              <Link href="/#produit">Produit</Link>
              <Link href="/#fonctionnement">Comment ça marche</Link>
              <Link href="/plans">Plans</Link>
              <Link href="/#faq">FAQ</Link>
              <Link href="/connexion">Se connecter</Link>
            </nav>
          </details>
          <div className="nav-actions">
            <Link className="text-link nav-login" href="/connexion">Se connecter</Link>
            <Link className="button button-dark button-small" href="/inscription">Essayer ZeRecruit <ArrowRight size={16} /></Link>
          </div>
        </div>
      </header>

      <section className="plans-hero" id="main-content">
        <div className="plans-hero-glow" />
        <div className="container plans-hero-copy">
          <div className="eyebrow"><Sparkles size={15} /> Des plans pensés pour recruter, pas pour vous limiter</div>
          <h1>Un prix clair.<br /><em>Un vivier qui prend de la valeur.</em></h1>
          <p>Commencez simplement, invitez votre équipe et évoluez quand votre volume de recrutement l’exige.</p>
          <div className="plans-trust-row">
            <span><Check size={16} /> 1 mois offert pour découvrir</span>
            <span><Check size={16} /> Sans carte bancaire</span>
            <span><Check size={16} /> Changement de plan flexible</span>
          </div>
        </div>
      </section>

      <section className="plans-pricing-section">
        <div className="container"><PricingCards /></div>
      </section>

      <section className="all-plans-section">
        <div className="container all-plans-grid">
          <div><span className="section-kicker">Dans chaque plan</span><h2>Les fondamentaux ne sont jamais une option.</h2></div>
          <div className="all-plans-benefits">
            <article><ScanSearch size={22} /><strong>Recherche intelligente</strong><p>Trouvez les profils pertinents au-delà des simples mots-clés.</p></article>
            <article><ShieldCheck size={22} /><strong>Données cloisonnées</strong><p>Chaque organisation garde ses candidats et ses accès séparés.</p></article>
            <article><Users size={22} /><strong>Collaboration fluide</strong><p>Partagez une base claire avec les personnes autorisées.</p></article>
            <article><Headphones size={22} /><strong>Une équipe disponible</strong><p>Obtenez de l’aide pour avancer sans ralentir vos recrutements.</p></article>
          </div>
        </div>
      </section>

      <section className="plan-comparison-section">
        <div className="container">
          <div className="section-heading centered-heading"><span className="section-kicker">Comparer les plans</span><h2>Choisissez selon votre rythme de recrutement.</h2><p>Les limites restent simples et visibles. Vous savez toujours ce qui est inclus.</p></div>
          <div className="comparison-table-wrap">
            <table className="comparison-table">
              <thead><tr><th scope="col">Fonctionnalité</th><th scope="col">Free</th><th scope="col">Essentiel</th><th scope="col" className="comparison-highlight">Équipe <span>Recommandé</span></th><th scope="col">Scale</th></tr></thead>
              <tbody>{comparisonRows.map(([label, free, essential, team, scale]) => <tr key={label}><th scope="row">{label}</th>{[free, essential, team, scale].map((value, index) => <td className={index === 2 ? "comparison-highlight" : ""} key={`${label}-${index}`}>{value === true ? <Check size={17} aria-label="Inclus" /> : value}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="faq-section pricing-faq">
        <div className="container faq-grid">
          <div className="section-heading left-heading"><span className="section-kicker">Questions sur les plans</span><h2>Pas de petite ligne cachée.</h2><p>Vous gardez une vision claire de votre abonnement et de vos volumes.</p></div>
          <div className="faq-list">
            <details open><summary>Puis-je utiliser ZeRecruit gratuitement ? <span>+</span></summary><p>Oui. Le plan Free vous donne un mois d’accès sans carte bancaire, dans la limite des volumes inclus. Vous choisissez ensuite le plan qui vous convient.</p></details>
            <details><summary>Que se passe-t-il si j’atteins ma limite de CV ? <span>+</span></summary><p>Vos profils existants restent accessibles. Vous pouvez passer au plan supérieur avant d’ajouter de nouveaux documents.</p></details>
            <details><summary>Puis-je changer de plan plus tard ? <span>+</span></summary><p>Oui. Votre plan peut évoluer avec votre équipe et votre volume de recrutement.</p></details>
            <details><summary>Le prix est-il par utilisateur ? <span>+</span></summary><p>Non. Chaque plan inclut un nombre d’utilisateurs pour toute l’organisation, afin de garder un coût prévisible.</p></details>
          </div>
        </div>
      </section>

      <section className="final-cta plan-final-cta">
        <div className="cta-orb" />
        <div className="container cta-inner"><span className="cta-icon"><Sparkles size={22} /></span><h2>Votre meilleur recrutement peut commencer par un CV déjà reçu.</h2><p>Essayez ZeRecruit et redonnez de la valeur à chaque profil de votre vivier.</p><div><Link className="button button-lime button-large" href="/inscription">Commencer gratuitement <ArrowRight size={18} /></Link><Link className="cta-login" href="/connexion">J’ai déjà un compte</Link></div></div>
      </section>

      <footer className="site-footer">
        <div className="container footer-main">
          <div><BrandLogo variant="light" /><p>La plateforme intelligente qui transforme votre CVthèque en avantage de recrutement.</p></div>
          <div><strong>Produit</strong><Link href="/#produit">Fonctionnalités</Link><Link href="/#fonctionnement">Comment ça marche</Link><Link href="/plans">Plans et tarifs</Link></div>
          <div><strong>Accès</strong><Link href="/connexion">Connexion</Link><Link href="/inscription">Créer un compte</Link><Link href="/#faq">Questions fréquentes</Link></div>
        </div>
        <div className="container footer-bottom"><span>© 2026 ZeRecruit. Tous droits réservés.</span><span>Conçu pour révéler les talents.</span></div>
      </footer>
    </main>
  );
}
