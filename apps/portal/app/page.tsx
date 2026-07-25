import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  Check,
  Clock3,
  Layers3,
  Plus,
  ShieldCheck,
  Sparkles,
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

const products = [
  {
    name: "ZeRecruit",
    category: "Recrutement",
    description: "Transformez votre CVthèque en moteur de talents intelligent.",
    detail: "Recherche, matching et collaboration",
    href: zeRecruitUrl,
    className: "product-recruit",
    Logo: ZeRecruitLogo,
    cta: "Ouvrir ZeRecruit",
  },
  {
    name: "ZeControl",
    category: "Temps & présences",
    description: "Gardez une vision fiable du temps, même sur le terrain.",
    detail: "Pointage, présence et mode hors connexion",
    href: zeControlUrl,
    className: "product-control",
    Logo: ZeControlLogo,
    cta: "Découvrir ZeControl",
  },
];

const foundations = [
  {
    icon: Building2,
    number: "01",
    title: "Une seule organisation",
    text: "Vos informations d’entreprise restent cohérentes d’un produit à l’autre.",
  },
  {
    icon: Layers3,
    number: "02",
    title: "Des produits à la carte",
    text: "Vous activez uniquement les outils utiles à votre façon de travailler.",
  },
  {
    icon: UserRoundCheck,
    number: "03",
    title: "Des accès maîtrisés",
    text: "Chaque collaborateur retrouve les produits qui lui sont réellement ouverts.",
  },
];

export default function Home() {
  return (
    <main id="accueil">
      <a className="skip-link" href="#contenu">
        Aller au contenu principal
      </a>

      <header className="site-header">
        <div className="shell header-inner">
          <a className="brand-link" href="#accueil" aria-label="ZeSuite, accueil">
            <ZeSuiteLogo />
          </a>
          <nav aria-label="Navigation principale">
            <a href="#produits">Nos produits</a>
            <a href="#promesse">Pourquoi ZeSuite</a>
          </nav>
          <a className="header-action" href="#produits">
            Accéder à mes produits
            <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      </header>

      <section className="hero" id="contenu">
        <div className="shell hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">
              <Sparkles size={15} aria-hidden="true" />
              Le point d’entrée de votre entreprise
            </p>
            <h1>
              Vos équipes.
              <br />
              Vos outils. <em>Enfin réunis.</em>
            </h1>
            <p className="hero-summary">
              ZeSuite rassemble vos produits métiers dans un espace simple,
              cohérent et prêt à évoluer avec votre organisation.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#produits">
                Explorer les produits
                <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a className="text-link" href="#promesse">
                Comprendre ZeSuite
              </a>
            </div>
            <div className="hero-reassurance" aria-label="Avantages ZeSuite">
              <span><Check size={15} /> Un compte</span>
              <span><Check size={15} /> Une organisation</span>
              <span><Check size={15} /> Des accès sur mesure</span>
            </div>
          </div>

          <div className="launcher-wrap" aria-label="Aperçu du portail ZeSuite">
            <span className="launcher-glow" aria-hidden="true" />
            <div className="launcher-card">
              <div className="launcher-topbar">
                <ZeSuiteLogo compact />
                <div>
                  <span>ZeSuite</span>
                  <small>Votre espace de travail</small>
                </div>
                <span className="launcher-avatar">AK</span>
              </div>
              <div className="launcher-heading">
                <div>
                  <small>Bonjour Awa,</small>
                  <h2>Que voulez-vous faire aujourd’hui&nbsp;?</h2>
                </div>
                <span className="organisation-chip"><Building2 size={14} /> Kawa Studio</span>
              </div>
              <div className="launcher-products">
                <a className="launcher-product launcher-recruit" href={zeRecruitUrl}>
                  <ZeRecruitLogo compact />
                  <div><strong>ZeRecruit</strong><span>4 recrutements actifs</span></div>
                  <ArrowUpRight size={17} />
                </a>
                <a className="launcher-product launcher-control" href={zeControlUrl}>
                  <ZeControlLogo compact />
                  <div><strong>ZeControl</strong><span>18 personnes présentes</span></div>
                  <ArrowUpRight size={17} />
                </a>
              </div>
              <div className="launcher-status">
                <span><ShieldCheck size={16} /> Accès sécurisés</span>
                <span><BadgeCheck size={16} /> 2 produits actifs</span>
              </div>
            </div>
            <div className="floating-note note-access">
              <UserRoundCheck size={18} />
              <div><small>Nouvel accès</small><strong>Mariam a rejoint ZeRecruit</strong></div>
            </div>
            <div className="floating-note note-presence">
              <Clock3 size={18} />
              <div><small>ZeControl</small><strong>Équipe à l’heure</strong></div>
            </div>
          </div>
        </div>
        <div className="shell family-strip">
          <span>Une même exigence, plusieurs expertises</span>
          <div><strong>Simple</strong><i /> <strong>Spécialisé</strong><i /> <strong>Évolutif</strong></div>
        </div>
      </section>

      <section className="products-section" id="produits">
        <div className="shell">
          <div className="section-heading">
            <div>
              <p className="section-kicker">La famille Ze</p>
              <h2>À chaque métier,<br />son produit dédié.</h2>
            </div>
            <p>
              Une identité commune pour vous orienter. Une expérience vraiment
              spécialisée pour accomplir votre travail.
            </p>
          </div>

          <div className="product-grid">
            {products.map(({ Logo, ...product }) => (
              <article className={`product-card ${product.className}`} key={product.name}>
                <div className="card-topline">
                  <Logo inverse />
                  <span>Disponible</span>
                </div>
                <div className="product-card-copy">
                  <p>{product.category}</p>
                  <h3>{product.description}</h3>
                  <span className="product-detail"><BadgeCheck size={17} /> {product.detail}</span>
                </div>
                <a href={product.href}>
                  {product.cta}
                  <ArrowUpRight size={19} aria-hidden="true" />
                </a>
                <div className="card-pattern" aria-hidden="true">
                  <span /><span /><span />
                </div>
              </article>
            ))}

            <article className="product-card product-future">
              <div className="future-mark"><Plus size={23} /></div>
              <div>
                <p>La suite continue</p>
                <h3>Le prochain outil trouvera naturellement sa place.</h3>
                <span>Même compte. Nouvelle expertise.</span>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="promise-section" id="promesse">
        <div className="shell promise-grid">
          <div className="promise-copy">
            <p className="section-kicker">Une base commune</p>
            <h2>Votre entreprise reste une. Vos possibilités grandissent.</h2>
            <p>
              ZeSuite crée un fil rouge entre vos outils sans effacer ce qui
              rend chaque produit utile, clair et expert dans son métier.
            </p>
          </div>
          <div className="foundation-list">
            {foundations.map((foundation) => {
              const Icon = foundation.icon;
              return (
                <article key={foundation.number}>
                  <span className="foundation-icon"><Icon size={21} /></span>
                  <div><small>{foundation.number}</small><h3>{foundation.title}</h3><p>{foundation.text}</p></div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="closing-wrap">
        <div className="shell closing-section">
          <div className="closing-copy">
            <ZeSuiteLogo inverse />
            <h2>Un seul endroit pour faire avancer toute votre équipe.</h2>
            <p>Commencez avec un produit. Ajoutez la suite à votre rythme.</p>
          </div>
          <a className="button button-lime" href="#produits">
            Découvrir la famille Ze <ArrowRight size={18} />
          </a>
          <div className="closing-symbol" aria-hidden="true"><ZeSuiteLogo compact /></div>
        </div>
      </section>

      <footer className="shell">
        <ZeSuiteLogo />
        <p>Des produits simples pour les équipes qui avancent.</p>
        <span>© {new Date().getFullYear()} ZeSuite</span>
      </footer>
    </main>
  );
}
