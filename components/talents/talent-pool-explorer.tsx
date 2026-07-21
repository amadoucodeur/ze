"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArrowUpDown,
  ChevronRight,
  Gauge,
  LoaderCircle,
  MapPin,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Plus,
  UserRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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

type TalentQueryRow = {
  id: string;
  fullname: string;
  poste_type: string | null;
  localisation: string | null;
  summary: string | null;
  statut: string | null;
  performance_score: number | null;
  archived_at: string | null;
  created_by: string;
  created_at: string;
  industries: string[] | null;
  skills: Array<{ name: string; expertise: string | null }> | null;
  languages: Array<{ name: string; level: string | null }> | null;
  creator_name: string | null;
  total_count: number | string;
};

const PAGE_SIZE = 24;

function toTalentPoolItem(talent: TalentQueryRow): TalentPoolItem {
  return {
    id: talent.id,
    fullname: talent.fullname,
    posteType: talent.poste_type,
    localisation: talent.localisation,
    summary: talent.summary,
    statut: talent.statut || "unknown",
    performanceScore: talent.performance_score,
    archivedAt: talent.archived_at,
    createdAt: talent.created_at,
    creatorName: talent.creator_name || "un membre de l’équipe",
    industries: Array.isArray(talent.industries) ? talent.industries : [],
    skills: Array.isArray(talent.skills) ? talent.skills : [],
    languages: Array.isArray(talent.languages) ? talent.languages : [],
  };
}

async function loadTalentPage(archived: boolean, filters: Filters, offset: number) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("search_candidate_pool", {
    p_archived: archived,
    p_query: filters.query.trim(),
    p_availability: filters.availability,
    p_location: filters.location.trim(),
    p_skill: filters.skill.trim(),
    p_language: filters.language.trim(),
    p_industry: filters.industry.trim(),
    p_min_score: filters.minScore ? Number(filters.minScore) : null,
    p_sort: filters.sort,
    p_limit: PAGE_SIZE,
    p_offset: offset,
  });
  if (error) throw error;
  const rows = (data || []) as TalentQueryRow[];
  return { rows, count: rows.length ? Number(rows[0].total_count) || 0 : 0 };
}

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

export function TalentPoolExplorer({
  archived,
  initialQuery = "",
  canCreate,
}: {
  archived: boolean;
  initialQuery?: string;
  canCreate: boolean;
}) {
  const [talents, setTalents] = useState<TalentPoolItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters, query: initialQuery });

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      async function loadInitialPage() {
        setRefreshing(true);
        setLoadError(null);
        try {
          const { rows, count } = await loadTalentPage(archived, filters, 0);
          if (!active) return;
          setTalents(rows.map(toTalentPoolItem));
          setTotalCount(count);
        } catch {
          if (active) setLoadError("Les profils ne peuvent pas être chargés pour le moment.");
        } finally {
          if (active) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      }
      void loadInitialPage();
    }, 250);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [archived, filters, reloadKey]);

  async function loadMore() {
    if (loadingMore || talents.length >= totalCount) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const { rows, count } = await loadTalentPage(archived, filters, talents.length);
      const nextTalents = rows.map(toTalentPoolItem);
      setTalents((current) => [...current, ...nextTalents]);
      setTotalCount(count);
    } catch {
      setLoadError("La suite des profils n’a pas pu être chargée. Réessayez.");
    } finally {
      setLoadingMore(false);
    }
  }

  const activeFilterCount = [
    filters.availability,
    filters.location,
    filters.skill,
    filters.language,
    filters.industry,
    filters.minScore,
  ].filter(Boolean).length;
  const hasActiveSearch = activeFilterCount > 0 || filters.query.trim().length > 0;

  const filteredTalents = talents;

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

  if (loading) {
    return <div className="talents-empty-state" role="status"><span><LoaderCircle className="spin" size={30} /></span><div><small>Chargement</small><h2>Préparation du vivier…</h2><p>Les profils autorisés pour votre organisation arrivent.</p></div></div>;
  }

  if (loadError && talents.length === 0) {
    return <div className="talents-empty-state" role="alert"><span><AlertCircle size={30} /></span><div><small>Chargement interrompu</small><h2>Le vivier est momentanément indisponible.</h2><p>{loadError}</p><button className="button button-secondary" type="button" onClick={() => setReloadKey((value) => value + 1)}>Réessayer</button></div></div>;
  }

  if (talents.length === 0 && !hasActiveSearch) {
    return <div className="talents-empty-state"><span>{archived ? <Archive size={30} /> : <UserRound size={30} />}</span><div><small>{archived ? "Archives vides" : "Votre première étape utile"}</small><h2>{archived ? "Aucun profil archivé." : "Transformez votre premier CV en profil."}</h2><p>{archived ? "Les profils archivés restent récupérables et apparaîtront ici." : "Déposez plusieurs documents ou collez un texte. ZeRecruit crée un profil distinct pour chaque personne."}</p>{canCreate && !archived ? <Link className="button button-primary" href="/dashboard/talents/nouveau"><Plus size={18} /> Importer mes premiers CV</Link> : !archived && <p className="talents-viewer-note">Votre accès est en lecture seule. Un recruteur de l’organisation peut créer le premier profil.</p>}</div></div>;
  }

  return (
    <section className="talent-pool-explorer" aria-label={archived ? "Profils archivés" : "Tous les profils"} aria-busy={refreshing}>
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
          <span>Les filtres recherchent dans l’ensemble du vivier.</span>
        </div>
      </details>

      <div className="talent-pool-results-heading">
        <div><strong>{totalCount}</strong><span>profil{totalCount > 1 ? "s" : ""} trouvé{totalCount > 1 ? "s" : ""}{talents.length < totalCount ? ` · ${talents.length} affichés` : ""}{refreshing ? " · actualisation…" : ""}</span></div>
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
      {loadError && talents.length > 0 && <div className="form-message form-error" role="alert"><AlertCircle size={17} /> {loadError}</div>}
      {talents.length < totalCount && <div className="talent-pool-load-more"><button className="button button-secondary" type="button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? <><LoaderCircle className="spin" size={17} /> Chargement…</> : `Afficher les profils suivants (${totalCount - talents.length})`}</button></div>}
    </section>
  );
}
