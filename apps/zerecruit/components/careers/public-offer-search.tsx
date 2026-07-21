"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, BriefcaseBusiness, Building2, MapPin, RotateCcw, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import type { PublicCareerDirectoryOffer } from "@/lib/careers/public";

const workModes: Record<string, string> = { onsite: "Sur site", hybrid: "Hybride", remote: "À distance" };
const contractTypes: Record<string, string> = { permanent: "CDI", fixed_term: "CDD", internship: "Stage", freelance: "Freelance", temporary: "Intérim", apprenticeship: "Alternance", other: "Autre" };

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function PublicOfferSearch({
  offers,
  initialQuery = "",
  initialLocation = "",
  initialContract = "",
  initialWorkMode = "",
}: {
  offers: PublicCareerDirectoryOffer[];
  initialQuery?: string;
  initialLocation?: string;
  initialContract?: string;
  initialWorkMode?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);
  const [location, setLocation] = useState(initialLocation);
  const [contract, setContract] = useState(initialContract);
  const [workMode, setWorkMode] = useState(initialWorkMode);
  const deferredQuery = useDeferredValue(query);
  const deferredLocation = useDeferredValue(location);

  const filteredOffers = useMemo(() => {
    const queryTerms = normalize(deferredQuery).split(/\s+/).filter(Boolean);
    const locationTerm = normalize(deferredLocation);
    return offers.filter((offer) => {
      const searchable = normalize([
        offer.title,
        offer.organisation_name,
        offer.department,
        offer.summary,
        offer.mission,
        offer.location,
        ...offer.must_have_skills,
        ...offer.nice_to_have_skills,
      ].filter(Boolean).join(" "));
      return queryTerms.every((term) => searchable.includes(term))
        && (!locationTerm || normalize(offer.location || "").includes(locationTerm))
        && (!contract || offer.contract_type === contract)
        && (!workMode || offer.work_mode === workMode);
    });
  }, [contract, deferredLocation, deferredQuery, offers, workMode]);

  function syncUrl(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (location.trim()) params.set("lieu", location.trim());
    if (contract) params.set("contrat", contract);
    if (workMode) params.set("mode", workMode);
    router.replace(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }

  function reset() {
    setQuery("");
    setLocation("");
    setContract("");
    setWorkMode("");
    router.replace(pathname, { scroll: false });
  }

  const hasFilters = Boolean(query || location || contract || workMode);

  return (
    <section className="public-job-search" aria-labelledby="public-jobs-heading">
      <form className="public-job-search-form" onSubmit={syncUrl}>
        <div className="public-job-search-main">
          <label><Search size={20} /><span className="sr-only">Métier ou compétence</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Métier, compétence ou entreprise" /></label>
          <label><MapPin size={20} /><span className="sr-only">Localisation</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Ville ou localisation" /></label>
          <button type="submit"><Sparkles size={18} /> Rechercher</button>
        </div>
        <details className="public-job-filters">
          <summary><SlidersHorizontal size={17} /> Affiner la recherche</summary>
          <div>
            <label><span>Type de contrat</span><select value={contract} onChange={(event) => setContract(event.target.value)}><option value="">Tous les contrats</option>{Object.entries(contractTypes).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label><span>Mode de travail</span><select value={workMode} onChange={(event) => setWorkMode(event.target.value)}><option value="">Tous les modes</option>{Object.entries(workModes).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          </div>
        </details>
      </form>

      <div className="public-job-results-heading">
        <div><span id="public-jobs-heading">Offres ouvertes</span><h2 aria-live="polite">{filteredOffers.length} opportunité{filteredOffers.length > 1 ? "s" : ""}</h2></div>
        {hasFilters && <button type="button" onClick={reset}><RotateCcw size={16} /> Effacer les filtres</button>}
      </div>

      {filteredOffers.length ? <div className="public-job-results">{filteredOffers.map((offer) => (
        <article className="public-job-card" key={offer.id}>
          <div className="public-job-company-mark" aria-hidden="true">{offer.organisation_name.slice(0, 1).toUpperCase()}</div>
          <div className="public-job-card-copy">
            <span><Building2 size={14} /> {offer.organisation_name}</span>
            <h3><Link href={`/carriere/${offer.organisation_identifier}/${offer.public_slug}`}>{offer.title}</Link></h3>
            <p>{offer.summary || offer.mission || "Découvrez la mission et les attentes du poste."}</p>
            <div>
              {offer.contract_type && <small><BriefcaseBusiness size={14} />{contractTypes[offer.contract_type] || offer.contract_type}</small>}
              {offer.location && <small><MapPin size={14} />{offer.location}</small>}
              {offer.work_mode && <small>{workModes[offer.work_mode] || offer.work_mode}</small>}
            </div>
          </div>
          <Link className="public-job-open" href={`/carriere/${offer.organisation_identifier}/${offer.public_slug}`} aria-label={`Voir l’offre ${offer.title} chez ${offer.organisation_name}`}><span>Voir l’offre</span><ArrowRight size={19} /></Link>
        </article>
      ))}</div> : <div className="career-empty public-job-empty"><Search size={28} /><h3>Aucune offre ne correspond.</h3><p>Essayez un métier plus large ou retirez un filtre.</p>{hasFilters && <button type="button" onClick={reset}>Voir toutes les offres</button>}</div>}
    </section>
  );
}
