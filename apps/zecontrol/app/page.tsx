import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  CloudOff,
  Laptop,
  MapPin,
  Radio,
  ShieldCheck,
  Smartphone,
  Tablet,
  TimerReset,
  UsersRound,
  WifiOff,
} from "lucide-react";
import { ZeControlLogo, ZeSuiteLogo } from "@ze/ui-foundations/brands";

const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL ?? "http://localhost:3002";

const team = [
  { initials: "AK", name: "Awa Koné", time: "08:02", status: "À l’heure" },
  { initials: "YM", name: "Yao Mensah", time: "08:11", status: "À l’heure" },
  { initials: "FN", name: "Fatou N’Diaye", time: "08:27", status: "Retard" },
];

export default function Home() {
  return (
    <main>
      <header className="control-header shell">
        <a className="brand-link" href="#accueil" aria-label="ZeControl, accueil">
          <ZeControlLogo />
        </a>
        <nav aria-label="Navigation principale">
          <a href="#solution">La solution</a>
          <a href="#hors-connexion">Hors connexion</a>
          <a href="#ecrans">Tous les écrans</a>
        </nav>
        <a className="suite-link" href={portalUrl}>
          <ZeSuiteLogo compact />
          <span>Retour à ZeSuite</span>
        </a>
      </header>

      <section className="control-hero shell" id="accueil">
        <div className="hero-copy">
          <p className="eyebrow"><Radio size={15} /> Temps & présences</p>
          <h1>
            Le pointage fiable,
            <br />
            <em>partout où vous travaillez.</em>
          </h1>
          <p className="hero-summary">
            ZeControl simplifie le suivi des présences, des retards et du temps
            de travail. Au bureau, sur le terrain ou avec un réseau instable.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#solution">
              Découvrir ZeControl <ArrowRight size={18} />
            </a>
            <a className="button button-ghost" href="#desktop">
              Voir l’expérience desktop
            </a>
          </div>
          <div className="trust-row" aria-label="Principaux avantages">
            <span><BadgeCheck size={16} /> Simple à utiliser</span>
            <span><ShieldCheck size={16} /> Traces vérifiables</span>
          </div>
        </div>

        <div className="product-stage" aria-label="Aperçu de ZeControl sur ordinateur et mobile">
          <div className="dashboard-window">
            <div className="window-bar">
              <span className="window-dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="window-title">Tableau de bord</span>
              <span className="live-pill"><i /> En direct</span>
            </div>
            <div className="dashboard-layout">
              <aside>
                <ZeControlLogo compact inverse />
                <span className="aside-active" />
                <span /><span /><span /><span />
              </aside>
              <div className="dashboard-main">
                <div className="dashboard-heading">
                  <div><small>Bonjour Amadou</small><strong>Présences du jour</strong></div>
                  <span>Mar. 21 juillet</span>
                </div>
                <div className="metric-row">
                  <article><small>Présents</small><strong>24</strong><i className="metric-up">+ 3</i></article>
                  <article><small>À l’heure</small><strong>21</strong><i>87,5 %</i></article>
                  <article><small>Retards</small><strong>03</strong><i className="metric-warn">À vérifier</i></article>
                </div>
                <div className="team-table">
                  <div className="table-head"><span>Collaborateur</span><span>Arrivée</span><span>Statut</span></div>
                  {team.map((member, index) => (
                    <div className="table-row" key={member.name}>
                      <span className={`avatar avatar-${index}`}>{member.initials}</span>
                      <strong>{member.name}</strong>
                      <time>{member.time}</time>
                      <span className={member.status === "Retard" ? "status status-late" : "status"}>{member.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="phone-card">
            <div className="phone-top"><span>9:41</span><i /></div>
            <ZeControlLogo compact />
            <p>Mardi 21 juillet</p>
            <strong>08:01:42</strong>
            <span className="location-ok"><MapPin size={13} /> Zone autorisée</span>
            <button type="button" tabIndex={-1} aria-label="Aperçu du bouton Pointer">
              <span><Check size={24} /></span>
              Pointé à 08:01
            </button>
            <small><WifiOff size={12} /> Prêt même si le réseau coupe</small>
          </div>

          <div className="sync-card"><CloudOff size={19} /><span><strong>3 événements</strong><small>prêts à synchroniser</small></span></div>
        </div>
      </section>

      <section className="proof-strip">
        <div className="shell">
          <p>Conçu pour suivre ce qui compte vraiment</p>
          <span><Check size={16} /> Arrivées & départs</span>
          <span><Check size={16} /> Pauses</span>
          <span><Check size={16} /> Retards</span>
          <span><Check size={16} /> Heures travaillées</span>
        </div>
      </section>

      <section className="solution-section shell" id="solution">
        <div className="section-heading">
          <p className="section-kicker">Une journée avec ZeControl</p>
          <h2>Pointer devient un geste simple. Piloter devient plus clair.</h2>
          <p>
            L’employé voit exactement ce qui est enregistré. Le manager retrouve
            une information structurée et les anomalies qui demandent son attention.
          </p>
        </div>
        <div className="benefit-grid">
          <article className="benefit-card employee-card">
            <div className="benefit-number">01</div>
            <div className="benefit-icon"><TimerReset size={24} /></div>
            <h3>Pour les collaborateurs</h3>
            <p>Un bouton clair pour pointer, une confirmation immédiate et un historique lisible.</p>
            <div className="mini-history" aria-hidden="true">
              <span><i className="dot-in" /> Arrivée <b>08:01</b></span>
              <span><i className="dot-pause" /> Pause <b>12:34</b></span>
              <span><i className="dot-out" /> Départ <b>17:42</b></span>
            </div>
          </article>
          <article className="benefit-card manager-card">
            <div className="benefit-number">02</div>
            <div className="benefit-icon"><UsersRound size={24} /></div>
            <h3>Pour les managers</h3>
            <p>Une vue d’ensemble immédiate, sans fouiller des feuilles ou multiplier les messages.</p>
            <div className="presence-summary" aria-hidden="true">
              <div className="summary-ring"><span>87%</span></div>
              <div><strong>21 à l’heure</strong><span>sur 24 présents</span></div>
            </div>
          </article>
          <article className="benefit-card company-card">
            <div className="benefit-number">03</div>
            <div className="benefit-icon"><Building2 size={24} /></div>
            <h3>Pour l’entreprise</h3>
            <p>Des règles cohérentes, des traces exploitables et moins de temps passé à corriger.</p>
            <div className="rule-card" aria-hidden="true">
              <ShieldCheck size={20} />
              <span><strong>Règle appliquée</strong><small>Tolérance d’arrivée · 15 min</small></span>
              <BadgeCheck size={18} />
            </div>
          </article>
        </div>
      </section>

      <section className="offline-section" id="hors-connexion">
        <div className="shell offline-layout">
          <div className="offline-copy">
            <p className="section-kicker light-kicker">Réseau instable, preuves conservées</p>
            <h2>Hors connexion ne veut pas dire sans contrôle.</h2>
            <p>
              Quand internet disparaît, ZeControl enregistre l’événement sur
              l’appareil avec ses éléments de contexte. À la reconnexion, le
              serveur le reçoit, vérifie sa cohérence et indique son niveau de confiance.
            </p>
            <div className="confidence-levels">
              <span><i className="confidence-high" /> Fiable</span>
              <span><i className="confidence-review" /> À vérifier</span>
              <span><i className="confidence-declared" /> Déclaré</span>
            </div>
          </div>
          <div className="offline-timeline">
            <article>
              <span className="timeline-icon"><Smartphone size={20} /></span>
              <div><small>Étape 1</small><h3>Enregistrement local</h3><p>Heure de l’appareil, localisation disponible et identifiant sécurisé.</p></div>
              <BadgeCheck size={19} />
            </article>
            <article>
              <span className="timeline-icon"><CloudOff size={20} /></span>
              <div><small>Étape 2</small><h3>Preuves préservées</h3><p>L’événement ne peut pas être discrètement réécrit avant l’envoi.</p></div>
              <BadgeCheck size={19} />
            </article>
            <article>
              <span className="timeline-icon"><ShieldCheck size={20} /></span>
              <div><small>Étape 3</small><h3>Synchronisation contrôlée</h3><p>Le serveur compare les données et signale les incohérences au manager.</p></div>
              <BadgeCheck size={19} />
            </article>
          </div>
        </div>
      </section>

      <section className="devices-section shell" id="ecrans">
        <div className="devices-heading">
          <div>
            <p className="section-kicker">Tous vos écrans comptent</p>
            <h2>Naturel sur mobile.<br />Confortable sur desktop.</h2>
          </div>
          <p>
            Les collaborateurs pointent là où ils travaillent. Les responsables
            disposent d’un espace complet pour lire, filtrer et décider.
          </p>
        </div>
        <div className="device-grid" id="desktop">
          <article>
            <span><Smartphone size={25} /></span>
            <small>Mobile</small>
            <h3>Pointer en quelques secondes</h3>
            <p>Une interface directe, pensée pour le terrain et les gestes rapides.</p>
          </article>
          <article className="featured-device">
            <span><Laptop size={27} /></span>
            <small>Desktop</small>
            <h3>Piloter avec toute la visibilité</h3>
            <p>Tableaux, filtres, validations et exports dans un espace de travail généreux.</p>
            <div className="desktop-lines" aria-hidden="true"><i /><i /><i /><i /></div>
          </article>
          <article>
            <span><Tablet size={25} /></span>
            <small>Tablette</small>
            <h3>Garder l’équipe en vue</h3>
            <p>Idéal pour un accueil, un atelier ou un responsable en mouvement.</p>
          </article>
        </div>
      </section>

      <section className="closing-cta shell">
        <div>
          <ZeControlLogo inverse />
          <h2>Le temps de votre équipe mérite une information claire.</h2>
          <p>ZeControl rejoint ZeSuite avec une expérience indépendante et un compte partagé.</p>
        </div>
        <a className="button button-light" href={portalUrl}>
          Découvrir ZeSuite <ArrowRight size={18} />
        </a>
      </section>

      <footer className="shell">
        <ZeControlLogo />
        <p>Temps & présences, simplement.</p>
        <a href={portalUrl}><ZeSuiteLogo compact /> Un produit ZeSuite</a>
      </footer>
    </main>
  );
}
