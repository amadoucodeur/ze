"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Archive,
  ArrowUpDown,
  ChevronRight,
  Gauge,
  MapPin,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from "lucide-react";

export type TalentPoolItem = {
  id: string;
  fullname: string;
  posteType: string | null;
  localisation: string | null;
  summary: string | null;
  statut: string;
  performanceScore: number | null;
  archivedAt: string | null;
  createdAt: string;
  creatorName: string;
  industries: string[];
  skills: Array<{ name: string; expertise: string | null }>;
  languages: Array<{ name: string; level: string | null }>;
};

type Filters = {
  query: string;
  availability: string;
  location: string;
  skill: string;
  language: string;
  industry: string;
  minScore: string;
  sort: "recent" | "score" | "name";
};

const emptyFilters: Filters = {
  query: "",
  availability: "",
  location: "",
  skill: "",
  language: "",
  industry: "",
  minScore: "",
  sort: "recent",
};

const availabilityLabels: Record<string, string> = {
  available: "Disponible",
  employed: "En poste",
  open_to_opportunities: "À l’écoute",
  freelance: "Freelance",
  student: "En formation",
  unavailable: "Indisponible",
  unknown: "À confirmer",
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function includes(value: string | null, term: string) {
  return !term || normalize(value || "").includes(normalize(term));
}

export function TalentPoolExplorer({
  talents,
  archived,
  initialQuery = "",
}: {
  talents: TalentPoolItem[];
  archived: boolean;
  initialQuery?: string;
}) {
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters, query: initialQuery });

  const activeFilterCount = [
    filters.availability,
    filters.location,
    filters.skill,
    filters.language,
    filters.industry,
    filters.minScore,
  ].filter(Boolean).length;

  const filteredTalents = useMemo(() => {
    const queryTerms = normalize(filters.query).split(/\s+/).filter(Boolean);
    const minScore = filters.minScore ? Number(filters.minScore) : null;
    const matches = talents.filter((talent) => {
      const searchable = [
        talent.fullname,
        talent.posteType,
        talent.localisation,
        talent.summary,
        talent.creatorName,
        ...talent.industries,
        ...talent.skills.map((skill) => `${skill.name} ${skill.expertise || ""}`),
        ...talent.languages.map((language) => `${language.name} ${language.level || ""}`),
      ].filter(Boolean).join(" ");
      const normalizedSearchable = normalize(searchable);
      return (queryTerms.length === 0 || queryTerms.every((term) => normalizedSearchable.includes(term)))
        && (!filters.availability || talent.statut === filters.availability)
        && includes(talent.localisation, filters.location)
        && (!filters.skill || talent.skills.some((skill) => includes(skill.name, filters.skill)))
        && (!filters.language || talent.languages.some((language) => includes(language.name, filters.language)))
        && (!filters.industry || talent.industries.some((industry) => includes(industry, filters.industry)))
        && (minScore === null || (talent.performanceScore || 0) >= minScore);
    });

    return matches.sort((a, b) => {
      if (filters.sort === "name") return a.fullname.localeCompare(b.fullname, "fr");
      if (filters.sort === "score") return (b.performanceScore || 0) - (a.performanceScore || 0);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [filters, talents]);

  const resetFilters = () => setFilters(emptyFilters);
  const semanticQuery = [
    filters.query.trim(),
    filters.skill && `compétence ${filters.skill}`,
    filters.location && `localisation ${filters.location}`,
    filters.language && `langue ${filters.language}`,
    filters.industry && `secteur ${filters.industry}`,
    filters.availability && `disponibilité ${availabilityLabels[filters.availability]}`,
    filters.minScore && `qualité du profil au moins ${filters.minScore}%`,
  ].filter(Boolean).join(", ");
  const semanticHref = semanticQuery.length >= 3
    ? `/dashboard/recherche?q=${encodeURIComponent(semanticQuery)}`
    : "/dashboard/recherche";

  return (
    <section className="talent-pool-explorer" aria-label={archived ? "Profils archivés" : "Tous les profils"}>
      <div className="talent-pool-search-card">
        <div className="talent-pool-search-copy">
          <span className="talent-pool-search-icon" aria-hidden="true"><Search size={22} /></span>
          <div><strong>Trouvez un profil en quelques secondes</strong><p>Nom, métier, compétence, secteur, langue ou localisation.</p></div>
        </div>
        <label className="talent-pool-query">
          <span className="sr-only">Rechercher dans les profils</span>
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            value={filters.query}
            placeholder="Ex. développeur React, comptable, anglais…"
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
          />
          {filters.query && <button type="button" onClick={() => setFilters((current) => ({ ...current, query: "" }))}>Effacer</button>}
        </label>
        {!archived && (
          <Link className="talent-pool-semantic-action" href={semanticHref}>
            <Sparkles size={18} />
            <span><strong>Classer par pertinence</strong><small>Recherche sémantique</small></span>
            <ChevronRight size={17} />
          </Link>
        )}
      </div>

      <details className="talent-pool-filters" open={activeFilterCount > 0}>
        <summary>
          <span><SlidersHorizontal size={18} /> Filtres avancés {activeFilterCount > 0 && <b>{activeFilterCount}</b>}</span>
          <small>Disponibilité, compétences, langues et plus</small>
        </summary>
        <div className="talent-pool-filter-grid">
          <label><span>Disponibilité</span><select value={filters.availability} onChange={(event) => setFilters((current) => ({ ...current, availability: event.target.value }))}><option value="">Toutes</option>{Object.entries(availabilityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>Compétence</span><input value={filters.skill} placeholder="Ex. React" onChange={(event) => setFilters((current) => ({ ...current, skill: event.target.value }))} /></label>
          <label><span>Localisation</span><input value={filters.location} placeholder="Ex. Abidjan" onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))} /></label>
          <label><span>Langue</span><input value={filters.language} placeholder="Ex. Anglais" onChange={(event) => setFilters((current) => ({ ...current, language: event.target.value }))} /></label>
          <label><span>Secteur</span><input value={filters.industry} placeholder="Ex. Fintech" onChange={(event) => setFilters((current) => ({ ...current, industry: event.target.value }))} /></label>
          <label><span>Qualité minimale</span><select value={filters.minScore} onChange={(event) => setFilters((current) => ({ ...current, minScore: event.target.value }))}><option value="">Indifférente</option><option value="40">40 % et plus</option><option value="60">60 % et plus</option><option value="80">80 % et plus</option></select></label>
        </div>
        <div className="talent-pool-filter-footer">
          <button type="button" disabled={activeFilterCount === 0} onClick={resetFilters}><RotateCcw size={16} /> Réinitialiser</button>
          <span>Les filtres s’appliquent instantanément aux profils affichés.</span>
        </div>
      </details>

      <div className="talent-pool-results-heading">
        <div><strong>{filteredTalents.length}</strong><span>profil{filteredTalents.length > 1 ? "s" : ""} affiché{filteredTalents.length > 1 ? "s" : ""}</span></div>
        <label><ArrowUpDown size={16} /><span className="sr-only">Trier les profils</span><select value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as Filters["sort"] }))}><option value="recent">Plus récents</option><option value="score">Mieux documentés</option><option value="name">Ordre alphabétique</option></select></label>
      </div>

      {filteredTalents.length > 0 ? (
        <div className="talent-pool-grid">
          {filteredTalents.map((talent) => (
            <article className="talent-pool-card" key={talent.id}>
              <div className="talent-pool-card-top">
                <span className="talent-pool-avatar" aria-hidden="true">{talent.fullname.slice(0, 2).toUpperCase()}</span>
                <div><span>{archived ? "Profil archivé" : availabilityLabels[talent.statut] || "À confirmer"}</span><h2>{talent.fullname}</h2><p>{talent.posteType || "Expertise à compléter"}</p></div>
                {talent.performanceScore !== null && <strong className="talent-pool-score"><Gauge size={14} />{talent.performanceScore}%</strong>}
              </div>
              <div className="talent-pool-card-meta">
                {talent.localisation && <span><MapPin size={14} />{talent.localisation}</span>}
                <span><UserRound size={14} />Ajouté par {talent.creatorName}</span>
              </div>
              {(talent.skills.length > 0 || talent.industries.length > 0) && <div className="talent-pool-tags">{talent.skills.slice(0, 3).map((skill) => <span key={skill.name}>{skill.name}</span>)}{talent.skills.length === 0 && talent.industries.slice(0, 2).map((industry) => <span key={industry}>{industry}</span>)}</div>}
              <Link href={`/dashboard/talents/${talent.id}`} aria-label={`Ouvrir le profil de ${talent.fullname}`}>Voir le profil <ChevronRight size={17} /></Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="talent-pool-no-result">
          {archived ? <Archive size={28} /> : <Search size={28} />}
          <h2>Aucun profil ne correspond à ces critères.</h2>
          <p>Retirez un filtre ou lancez une recherche sémantique pour élargir les correspondances.</p>
          <button className="button button-secondary" type="button" onClick={resetFilters}><RotateCcw size={17} /> Effacer les filtres</button>
        </div>
      )}
    </section>
  );
}
