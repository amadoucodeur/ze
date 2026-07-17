import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BrainCircuit,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  FileSearch,
  Languages,
  Layers3,
  LockKeyhole,
  Menu,
  Search,
  Sparkles,
  Target,
  UploadCloud,
  Users,
  WandSparkles,
  Zap,
} from "lucide-react";
import { BrandLogo, BrandMark } from "@/components/brand-logo";
import { PricingCards } from "@/components/pricing-cards";

const candidates = [
  { initials: "AM", name: "Aïcha M.", role: "Product Designer", score: 94, tone: "peach" },
  { initials: "SK", name: "Samuel K.", role: "Lead Frontend", score: 91, tone: "blue" },
  { initials: "FN", name: "Fatou N.", role: "Data Analyst", score: 87, tone: "lime" },
];

const features = [
  {
    icon: FileSearch,
    label: "CV enfin exploitables",
    title: "De vos PDF à une base de talents structurée.",
    text: "ZeRecruit extrait les compétences, expériences, formations et langues pour transformer chaque CV en profil réellement recherchable.",
    accent: "mint",
  },
  {
    icon: BrainCircuit,
    label: "Recherche intelligente",
    title: "Décrivez le talent. Trouvez les bons profils.",
    text: "Combinez filtres précis et langage naturel : « développeur React, fintech, 3 ans d’expérience » devient une shortlist actionnable.",
    accent: "lilac",
  },
  {
    icon: Target,
    label: "Matching explicable",
    title: "Un score utile, jamais une boîte noire.",
    text: "Comparez un candidat à une offre avec des critères lisibles : compétences, expérience, formation, localisation et attentes.",
    accent: "sand",
  },
];

export default function Home() {
  return (
    <main className="marketing-page">
      <a className="skip-link" href="#main-content">Aller au contenu principal</a>
      <header className="site-header">
        <div className="container nav-wrap">
          <BrandLogo />
          <nav className="desktop-nav" aria-label="Navigation principale">
            <a href="#produit">Produit</a>
            <a href="#fonctionnement">Comment ça marche</a>
            <a href="#plans">Plans</a>
            <a href="#faq">FAQ</a>
          </nav>
          <details className="mobile-menu">
            <summary aria-label="Ouvrir le menu"><Menu size={20} /></summary>
            <nav aria-label="Navigation mobile">
              <a href="#produit">Produit</a>
              <a href="#fonctionnement">Comment ça marche</a>
              <a href="#plans">Plans</a>
              <a href="#faq">FAQ</a>
              <Link href="/connexion">Se connecter</Link>
            </nav>
          </details>
          <div className="nav-actions">
            <Link className="text-link nav-login" href="/connexion">Se connecter</Link>
            <Link className="button button-dark button-small" href="/inscription">
              Essayer ZeRecruit <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </header>

      <section className="hero-section" id="main-content">
        <div className="hero-orb hero-orb-one" />
        <div className="hero-orb hero-orb-two" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow"><Sparkles size={15} /> Le recrutement, enfin augmenté par vos données</div>
            <h1>Votre prochain grand talent est déjà dans vos CV.</h1>
            <p className="hero-lead">
              ZeRecruit transforme votre CVthèque en moteur de recherche intelligent pour identifier, comparer et contacter les meilleurs profils en quelques instants.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/inscription">
                Commencer gratuitement <ArrowRight size={18} />
              </Link>
              <a className="button button-ghost" href="#produit">
                Découvrir le produit <ChevronRight size={18} />
              </a>
            </div>
            <div className="hero-reassurance" aria-label="Avantages de l’essai">
              <span><Check size={15} /> Mise en route rapide</span>
              <span><Check size={15} /> Sans carte bancaire</span>
              <span><Check size={15} /> Données cloisonnées par organisation</span>
            </div>
          </div>

          <div className="hero-product" aria-label="Aperçu de l’interface ZeRecruit">
            <div className="product-glow" />
            <div className="app-window">
              <div className="app-topbar">
                <div className="mini-brand"><BrandMark compact /><strong>ZeRecruit</strong></div>
                <div className="app-top-actions"><span /><span className="avatar-dot">YK</span></div>
              </div>
              <div className="app-body">
                <aside className="app-sidebar">
                  <span className="side-active"><Search size={14} /></span>
                  <span><Users size={14} /></span>
                  <span><BriefcaseBusiness size={14} /></span>
                  <span><BarChart3 size={14} /></span>
                </aside>
                <div className="app-content">
                  <div className="app-heading-row">
                    <div><span className="overline">Talent search</span><h3>Trouvez votre match.</h3></div>
                    <span className="filter-chip">12 profils</span>
                  </div>
                  <div className="smart-search">
                    <Search size={17} />
                    <span>Product designer, fintech, Abidjan...</span>
                    <kbd>⌘ K</kbd>
                  </div>
                  <div className="search-tags"><span>Figma</span><span>Fintech</span><span>+ 3 ans</span></div>
                  <div className="candidate-list">
                    {candidates.map((candidate, index) => (
                      <div className={`candidate-row ${index === 0 ? "candidate-selected" : ""}`} key={candidate.name}>
                        <div className={`candidate-avatar ${candidate.tone}`}>{candidate.initials}</div>
                        <div className="candidate-info"><strong>{candidate.name}</strong><span>{candidate.role}</span></div>
                        <div className="candidate-skills"><span>{index === 0 ? "Figma" : index === 1 ? "React" : "SQL"}</span><span>{index === 0 ? "UX" : index === 1 ? "TypeScript" : "Power BI"}</span></div>
                        <div className="score-ring" style={{ "--score": `${candidate.score * 3.6}deg` } as React.CSSProperties}><span>{candidate.score}</span></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="floating-card floating-match">
              <span className="float-icon"><WandSparkles size={17} /></span>
              <div><small>Matching terminé</small><strong>8 profils à fort potentiel</strong></div>
            </div>
            <div className="floating-card floating-cv">
              <span className="file-mini">PDF</span>
              <div><small>CV analysé</small><strong>Profil enrichi automatiquement</strong></div>
              <BadgeCheck size={18} />
            </div>
          </div>
        </div>
        <div className="container audience-strip">
          <span>Conçu pour les équipes qui recrutent vraiment</span>
          <div><strong>Cabinets</strong><strong>Scale-ups</strong><strong>Équipes RH</strong><strong>Talent acquisition</strong></div>
        </div>
      </section>

      <section className="problem-section">
        <div className="container problem-grid">
          <div className="section-heading left-heading">
            <span className="section-kicker">Le constat</span>
            <h2>Une CVthèque pleine ne devrait pas être une boîte noire.</h2>
          </div>
          <div className="problem-copy">
            <p>Vos meilleurs candidats sont noyés dans des dossiers, des PDF et des outils qui ne comprennent pas ce que vous cherchez.</p>
            <p className="problem-emphasis">ZeRecruit donne enfin une mémoire à votre recrutement.</p>
          </div>
        </div>
        <div className="container pain-cards">
          <article><span>01</span><h3>Les CV s’accumulent</h3><p>Des centaines de profils importés, rarement réexploités au bon moment.</p></article>
          <article><span>02</span><h3>La recherche est trop rigide</h3><p>Un mot-clé absent suffit à cacher un excellent candidat.</p></article>
          <article className="pain-card-highlight"><span>03</span><h3>La shortlist prend forme</h3><p>ZeRecruit relie vos critères aux données réelles de chaque profil.</p><div className="mini-arrow"><ArrowRight size={17} /></div></article>
        </div>
      </section>

      <section className="features-section" id="produit">
        <div className="container">
          <div className="section-heading centered-heading">
            <span className="section-kicker">Un produit. Trois super-pouvoirs.</span>
            <h2>Passez du CV au bon candidat, sans perdre le fil.</h2>
            <p>Une expérience fluide pour votre équipe, une lecture plus juste pour chaque talent.</p>
          </div>
          <div className="feature-grid">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <article className={`feature-card feature-${feature.accent}`} key={feature.title}>
                  <div className="feature-icon"><Icon size={24} /></div>
                  <span>{feature.label}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                  <a href="#fonctionnement">Voir comment ça marche <ArrowRight size={16} /></a>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="workflow-section" id="fonctionnement">
        <div className="container workflow-grid">
          <div className="workflow-copy">
            <span className="section-kicker light-kicker">Simple à prendre en main</span>
            <h2>Vos recrutements avancent. Votre base apprend.</h2>
            <p>Importez vos documents une fois. ZeRecruit structure l’information et la rend immédiatement utile à toute l’équipe.</p>
            <div className="workflow-steps">
              <div><span><UploadCloud size={19} /></span><div><strong>Importez vos CV</strong><p>Ajoutez un document ou alimentez votre vivier.</p></div></div>
              <div><span><Layers3 size={19} /></span><div><strong>Laissez ZeRecruit structurer</strong><p>Compétences, parcours et éléments clés sont organisés.</p></div></div>
              <div><span><Zap size={19} /></span><div><strong>Recherchez et décidez</strong><p>Filtrez, comparez et partagez votre shortlist.</p></div></div>
            </div>
            <Link className="button button-lime" href="/inscription">Créer mon espace <ArrowRight size={18} /></Link>
          </div>
          <div className="workflow-visual">
            <div className="profile-card-demo">
              <div className="profile-head"><div className="candidate-avatar peach big-avatar">AM</div><div><small>Profil candidat</small><h3>Aïcha Mensah</h3><p>Senior Product Designer · Abidjan</p></div><span className="verified-pill"><BadgeCheck size={14} /> Vérifié</span></div>
              <div className="profile-summary"><Sparkles size={17} /><p>7 ans d’expérience produit, dont 4 ans dans des environnements fintech à forte croissance.</p></div>
              <div className="profile-section"><span>Compétences clés</span><div><b>Product strategy</b><b>Figma</b><b>Design systems</b><b>User research</b></div></div>
              <div className="profile-bars"><div><span>Adéquation compétences</span><strong>96%</strong></div><i><b style={{ width: "96%" }} /></i><div><span>Expérience sectorielle</span><strong>91%</strong></div><i><b style={{ width: "91%" }} /></i></div>
            </div>
            <div className="language-float"><Languages size={18} /><div><small>Langues</small><strong>Français · Anglais</strong></div></div>
          </div>
        </div>
      </section>

      <section className="security-section" id="securite">
        <div className="container security-grid">
          <div className="security-badge"><LockKeyhole size={28} /><span /></div>
          <div><span className="section-kicker">Confiance par conception</span><h2>Vos données candidats restent vos données.</h2></div>
          <div className="security-points">
            <p><Check size={17} /> Cloisonnement strict par organisation</p>
            <p><Check size={17} /> Sessions sécurisées et accès contrôlés</p>
            <p><Check size={17} /> Documents sources conservés et traçables</p>
          </div>
        </div>
      </section>

      <section className="pricing-preview-section" id="plans">
        <div className="container">
          <div className="section-heading centered-heading">
            <span className="section-kicker">Des plans qui évoluent avec vous</span>
            <h2>Commencez petit. Recrutez grand.</h2>
            <p>Un tarif prévisible par organisation, avec les outils essentiels dès le premier plan.</p>
          </div>
          <PricingCards compact />
          <div className="pricing-preview-more"><Link href="/plans">Comparer tous les plans et fonctionnalités <ArrowRight size={17} /></Link></div>
        </div>
      </section>

      <section className="faq-section" id="faq">
        <div className="container faq-grid">
          <div className="section-heading left-heading"><span className="section-kicker">Questions fréquentes</span><h2>Avant de passer à la vitesse supérieure.</h2><p>Vous avez une question particulière ? Parlons de votre façon de recruter.</p></div>
          <div className="faq-list">
            <details open><summary>ZeRecruit remplace-t-il mon ATS ? <span>+</span></summary><p>ZeRecruit peut compléter votre ATS en rendant votre vivier réellement recherchable. Il est pensé pour centraliser l’intelligence candidat et accélérer le sourcing comme la présélection.</p></details>
            <details><summary>Quels types de CV puis-je importer ? <span>+</span></summary><p>La plateforme est conçue pour traiter les formats de CV courants et conserver le document original avec les données extraites.</p></details>
            <details><summary>La recherche se limite-t-elle aux mots-clés ? <span>+</span></summary><p>Non. ZeRecruit combine des filtres structurés avec une recherche sémantique pour comprendre l’intention derrière votre besoin.</p></details>
            <details><summary>Puis-je travailler avec plusieurs recruteurs ? <span>+</span></summary><p>Oui. Chaque organisation peut accueillir plusieurs recruteurs avec des données isolées des autres organisations.</p></details>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="cta-orb" />
        <div className="container cta-inner">
          <span className="cta-icon"><Sparkles size={22} /></span>
          <h2>Les bons talents ne devraient jamais rester introuvables.</h2>
          <p>Donnez à votre équipe un vivier qui travaille aussi intelligemment qu’elle.</p>
          <div><Link className="button button-lime button-large" href="/inscription">Commencer gratuitement <ArrowRight size={18} /></Link><Link className="cta-login" href="/connexion">J’ai déjà un compte</Link></div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container footer-main">
          <div><BrandLogo variant="light" /><p>La plateforme intelligente qui transforme votre CVthèque en avantage de recrutement.</p></div>
          <div><strong>Produit</strong><a href="#produit">Fonctionnalités</a><a href="#fonctionnement">Comment ça marche</a><Link href="/plans">Plans et tarifs</Link></div>
          <div><strong>Accès</strong><Link href="/connexion">Connexion</Link><Link href="/inscription">Créer un compte</Link><a href="#faq">Questions fréquentes</a></div>
        </div>
        <div className="container footer-bottom"><span>© 2026 ZeRecruit. Tous droits réservés.</span><span>Conçu pour révéler les talents.</span></div>
      </footer>
    </main>
  );
}
