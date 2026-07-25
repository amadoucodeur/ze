"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Building2, ChevronLeft, ChevronRight, Search, Settings2, UsersRound } from "lucide-react";

type TeamDirectoryItem = {
  id: string;
  fullname: string;
  identifiant: string;
  role: "owner" | "admin" | "agent";
  isActive: boolean;
  lastLoginLabel: string;
  poste: string | null;
  service: string | null;
};

const PAGE_SIZE = 25;
const roleLabels = { owner: "Propriétaire", admin: "Administrateur", agent: "Agent" } as const;

export function TeamDirectory({ items }: { items: TeamDirectoryItem[] }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | TeamDirectoryItem["role"]>("all");
  const [service, setService] = useState("all");
  const [access, setAccess] = useState<"all" | "active" | "suspended">("all");
  const [page, setPage] = useState(1);
  const services = useMemo(() => [...new Set(items.map((item) => item.service).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "fr")), [items]);
  const normalized = query.trim().toLocaleLowerCase("fr");
  const filtered = items.filter((item) => {
    const searchable = `${item.fullname} ${item.identifiant} ${item.poste ?? ""} ${item.service ?? ""}`.toLocaleLowerCase("fr");
    return (!normalized || searchable.includes(normalized)) &&
      (role === "all" || item.role === role) &&
      (service === "all" || item.service === service) &&
      (access === "all" || (access === "active" ? item.isActive : !item.isActive));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const displayed = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function resetPage() {
    setPage(1);
  }

  return (
    <section className="team-table-card team-directory">
      <div className="team-table-heading"><div><h2>Accès ZeControl</h2><p>{filtered.length} collaborateur{filtered.length > 1 ? "s" : ""} dans cette vue.</p></div></div>
      <div className="team-directory-filters">
        <label className="team-directory-search"><Search size={17} /><span className="sr-only">Rechercher</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} placeholder="Nom, identifiant, poste ou service" /></label>
        <label><UsersRound size={16} /><span className="sr-only">Rôle</span><select value={role} onChange={(event) => { setRole(event.target.value as typeof role); resetPage(); }}><option value="all">Tous les rôles</option><option value="agent">Agents</option><option value="admin">Administrateurs</option></select></label>
        <label><Building2 size={16} /><span className="sr-only">Service</span><select value={service} onChange={(event) => { setService(event.target.value); resetPage(); }}><option value="all">Tous les services</option>{services.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        <label><span className="team-filter-dot" /><span className="sr-only">État de l’accès</span><select value={access} onChange={(event) => { setAccess(event.target.value as typeof access); resetPage(); }}><option value="all">Tous les accès</option><option value="active">Actifs</option><option value="suspended">Suspendus</option></select></label>
      </div>

      {displayed.length ? <div className="team-table"><div className="team-table-row team-table-header"><span>Collaborateur</span><span>Rôle</span><span>Dernière connexion</span><span>Statut</span><span>Action</span></div>{displayed.map((item) => <div className="team-table-row" key={item.id}><div className="team-member"><span>{item.fullname.slice(0, 2).toUpperCase()}</span><div><strong>{item.fullname}</strong><small>{[item.poste, item.service].filter(Boolean).join(" · ") || item.identifiant}</small></div></div><span className="team-role">{roleLabels[item.role]}</span><span className="team-last-login">{item.lastLoginLabel}</span><span className={`team-status ${item.isActive ? "active" : "inactive"}`}>{item.isActive ? "Actif" : "Suspendu"}</span><Link className="team-manage-link" href={`/dashboard/equipe/${item.id}`}><Settings2 size={15} /> Gérer</Link></div>)}</div> : <div className="team-directory-empty"><Search size={23} /><strong>Aucun collaborateur trouvé</strong><p>Essayez avec moins de filtres.</p><button type="button" onClick={() => { setQuery(""); setRole("all"); setService("all"); setAccess("all"); setPage(1); }}>Effacer les filtres</button></div>}

      {totalPages > 1 && <footer className="team-directory-pagination"><span>{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} sur {filtered.length}</span><div><button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /> Précédent</button><strong>{currentPage} / {totalPages}</strong><button type="button" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Suivant <ChevronRight size={16} /></button></div></footer>}
    </section>
  );
}
