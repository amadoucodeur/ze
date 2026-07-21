import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  Layers3,
  Plus,
  UserRoundCheck,
} from "lucide-react";
import {
  ZeControlLogo,
  ZeRecruitLogo,
  ZeSuiteLogo,
} from "@ze/ui-foundations/brands";

const zeRecruitUrl =
  process.env.NEXT_PUBLIC_ZERECRUIT_URL ?? "http://localhost:3000";
const zeControlUrl =
  process.env.NEXT_PUBLIC_ZECONTROL_URL ?? "http://localhost:3001";

export default function Home() {
  return (
    <main>
      <header className="site-header shell">
        <a className="brand-link" href="#accueil" aria-label="ZeSuite, accueil">
          <ZeSuiteLogo />
        </a>
        <nav aria-label="Navigation principale">
          <a href="#produits">Produits</a>
          <a href="#fonctionnement">Fonctionnement</a>
        </nav>
        <a className="header-action" href="#produits">
          Accéder à mes produits
          <ArrowRight size={17} aria-hidden="true" />
        </a>
      </header>

      <section className="hero shell" id="accueil">
        <div className="hero-copy">
          <p className="eyebrow">
            <span aria-hidden="true" /> La suite qui relie vos équipes
          </p>
          <h1>
            Tous vos outils.
            <br />
            <em>Un seul compte.</em>
          </h1>
          <p className="hero-summary">
            ZeSuite réunit des produits simples pour recruter, organiser et
            piloter votre entreprise. Activez uniquement ceux dont vous avez
            besoin, sans recréer vos équipes.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#produits">
              Découvrir les produits
              <ArrowRight size={18} aria-hidden="true" />
            </a>
            <a className="text-link" href="#fonctionnement">
              Comment ça fonctionne
            </a>
          </div>
        </div>

        <div className="suite-visual" aria-label="Les produits ZeSuite reliés">
          <div className="visual-orbit visual-orbit-one" aria-hidden="true" />
          <div className="visual-orbit visual-orbit-two" aria-hidden="true" />
          <div className="suite-core-card">
            <ZeSuiteLogo compact className="hero-monogram-logo" />
          </div>
          <div className="mini-product mini-recruit">
            <ZeRecruitLogo compact />
            <div>
              <span>ZeRecruit</span>
              <small>Recrutement</small>
            </div>
            <BadgeCheck size={17} aria-label="Actif" />
          </div>
          <div className="mini-product mini-control">
            <ZeControlLogo compact />
            <div>
              <span>ZeControl</span>
              <small>Temps & présences</small>
            </div>
            <BadgeCheck size={17} aria-label="Actif" />
          </div>
          <div className="mini-product mini-future">
            <span className="future-icon"><Plus size={18} /></span>
            <div>
              <span>Votre prochain outil</span>
              <small>La suite évolue avec vous</small>
            </div>
          </div>
        </div>
      </section>

      <section className="products-section" id="produits">
        <div className="shell">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Les produits ZeSuite</p>
              <h2>Un métier, une expérience claire.</h2>
            </div>
            <p>
              Chaque produit conserve sa propre logique et son identité, tout
              en partageant votre organisation et vos accès.
            </p>
          </div>

          <div className="product-grid">
            <article className="product-card recruit-card">
              <div className="card-topline">
                <ZeRecruitLogo inverse />
                <span>Disponible</span>
              </div>
              <div className="product-card-copy">
                <p>Recrutement intelligent</p>
                <h3>Retrouvez les meilleurs talents déjà dans vos CV.</h3>
                <ul>
                  <li><BadgeCheck size={17} /> CVthèque centralisée</li>
                  <li><BadgeCheck size={17} /> Recherche et matching par IA</li>
                </ul>
              </div>
              <a href={zeRecruitUrl}>
                Ouvrir ZeRecruit
                <ArrowUpRight size={19} aria-hidden="true" />
              </a>
              <div className="card-decoration recruit-decoration" aria-hidden="true">
                <span>CV</span><span>01</span><span>✓</span>
              </div>
            </article>

            <article className="product-card control-card">
              <div className="card-topline">
                <ZeControlLogo inverse />
                <span>Nouveau</span>
              </div>
              <div className="product-card-copy">
                <p>Temps & présences</p>
                <h3>Un pointage simple, fiable et adapté au terrain.</h3>
                <ul>
                  <li><BadgeCheck size={17} /> Présences en temps réel</li>
                  <li><BadgeCheck size={17} /> Hors connexion contrôlé</li>
                </ul>
              </div>
              <a href={zeControlUrl}>
                Découvrir ZeControl
                <ArrowUpRight size={19} aria-hidden="true" />
              </a>
              <div className="card-decoration control-decoration" aria-hidden="true">
                <span className="clock-face"><i /><b /></span>
                <span className="presence-pill">08:02 · À l’heure</span>
              </div>
            </article>

            <article className="product-card future-card">
              <div className="future-mark"><Plus size={24} /></div>
              <p>La suite est extensible</p>
              <h3>Un prochain produit pourra trouver sa place ici.</h3>
              <span className="future-note">Même compte. Nouvelle expertise.</span>
            </article>
          </div>
        </div>
      </section>

      <section className="how-section shell" id="fonctionnement">
        <div className="how-intro">
          <p className="section-kicker">Simple dès le premier jour</p>
          <h2>Votre entreprise reste la même. Vos possibilités grandissent.</h2>
          <p>
            Quand vous ajoutez un produit, ZeSuite reconnaît votre organisation.
            Vous décidez ensuite quels collaborateurs peuvent y accéder.
          </p>
        </div>
        <div className="steps-grid">
          <article>
            <span><Building2 size={22} /></span>
            <small>01</small>
            <h3>Une organisation</h3>
            <p>Vos informations d’entreprise restent centralisées.</p>
          </article>
          <article>
            <span><Layers3 size={22} /></span>
            <small>02</small>
            <h3>Activez un produit</h3>
            <p>Ajoutez ZeRecruit, ZeControl ou un futur outil en quelques étapes.</p>
          </article>
          <article>
            <span><UserRoundCheck size={22} /></span>
            <small>03</small>
            <h3>Choisissez vos accès</h3>
            <p>Réutilisez les utilisateurs existants sans recréer leurs comptes.</p>
          </article>
        </div>
      </section>

      <section className="closing-section shell">
        <div>
          <ZeSuiteLogo inverse />
          <h2>Une suite cohérente.<br />Des produits vraiment spécialisés.</h2>
        </div>
        <a className="button button-light" href="#produits">
          Explorer la suite <ArrowRight size={18} />
        </a>
      </section>

      <footer className="shell">
        <ZeSuiteLogo />
        <p>Des outils simples pour les équipes qui avancent.</p>
        <span>© {new Date().getFullYear()} ZeSuite</span>
      </footer>
    </main>
  );
}
