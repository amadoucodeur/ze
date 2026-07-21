"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BriefcaseBusiness, CalendarDays, ChevronRight, LoaderCircle, MapPin, Plus, Search, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Offer = { id: string; title: string; department: string | null; status: string; location: string | null; work_mode: string | null; headcount: number; updated_at: string; must_have_skills: string[] };
type Application = { offre_id: string; stage: string };

const statusLabels: Record<string, string> = { draft: "Brouillon", open: "Ouverte", paused: "En pause", closed: "Clôturée" };

export function OfferList({ canManage }: { canManage: boolean }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void Promise.all([
      supabase.from("offres").select("id, title, department, status, location, work_mode, headcount, updated_at, must_have_skills").order("updated_at", { ascending: false }),
      supabase.from("candidatures").select("offre_id, stage"),
    ]).then(([offerResult, applicationResult]) => {
      if (!active) return;
      if (offerResult.error) setError(offerResult.error.code === "PGRST205" ? "Le module Offres doit être activé avant de commencer." : "Les offres n’ont pas pu être chargées.");
      else { setOffers((offerResult.data || []) as Offer[]); setApplications((applicationResult.data || []) as Application[]); }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => offers.filter((offer) => {
    const matchesQuery = !query.trim() || `${offer.title} ${offer.department || ""} ${offer.location || ""} ${offer.must_have_skills.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesStatus = status === "all" || (status === "active" ? ["open", "draft", "paused"].includes(offer.status) : offer.status === status);
    return matchesQuery && matchesStatus;
  }), [offers, query, status]);

  if (loading) return <div className="offer-list-loading" role="status"><LoaderCircle className="spin" size={24} /><p>Chargement des offres…</p></div>;
  if (error) return <div className="offer-list-error" role="alert"><AlertCircle size={22} /><div><strong>Les offres ne sont pas encore disponibles.</strong><p>{error}</p></div></div>;

  return <div className="offer-list-workspace">
    {offers.length === 0 ? <div className="offers-empty"><span><BriefcaseBusiness size={30} /></span><small>Premier recrutement</small><h2>Créez la mission avant de comparer les profils.</h2><p>ZeRecruit structure votre besoin, détecte les critères vraiment importants et prépare le matching avec votre vivier.</p>{canManage && <Link className="button button-primary" href="/dashboard/offres/nouvelle"><Plus size={18} /> Créer ma première offre</Link>}</div> : <>
      <div className="offer-list-toolbar"><label><Search size={19} /><span className="sr-only">Rechercher une offre</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Poste, compétence, équipe…" /></label><label><span className="sr-only">Filtrer par statut</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Offres actives</option><option value="draft">Brouillons</option><option value="open">Ouvertes</option><option value="paused">En pause</option><option value="closed">Clôturées</option><option value="all">Toutes les offres</option></select></label></div>
      <div className="offer-list-summary"><strong>{filtered.length}</strong><span>offre{filtered.length > 1 ? "s" : ""}</span></div>
      {filtered.length ? <div className="offer-card-grid">{filtered.map((offer) => {
        const offerApplications = applications.filter((application) => application.offre_id === offer.id);
        const interviews = offerApplications.filter((application) => application.stage === "interview").length;
        return <Link className="offer-card" href={`/dashboard/offres/${offer.id}`} key={offer.id}><div className="offer-card-head"><span><BriefcaseBusiness size={20} /></span><div><small className={`is-${offer.status}`}>{statusLabels[offer.status] || offer.status}</small><h2>{offer.title}</h2><p>{offer.department || "Équipe à préciser"}</p></div><ChevronRight size={19} /></div><div className="offer-card-meta">{offer.location && <span><MapPin size={14} />{offer.location}</span>}<span><UsersRound size={14} />{offerApplications.length} profil{offerApplications.length > 1 ? "s" : ""}</span>{interviews > 0 && <span><CalendarDays size={14} />{interviews} entretien{interviews > 1 ? "s" : ""}</span>}</div>{offer.must_have_skills.length > 0 && <div className="offer-card-skills">{offer.must_have_skills.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}</div>}</Link>;
      })}</div> : <div className="offer-no-result"><Search size={25} /><h2>Aucune offre ne correspond.</h2><button type="button" onClick={() => { setQuery(""); setStatus("active"); }}>Effacer les filtres</button></div>}
    </>}
  </div>;
}
