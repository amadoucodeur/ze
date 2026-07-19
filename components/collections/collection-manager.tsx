"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  FolderHeart,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Save,
  StickyNote,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Collection = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  updated_at: string;
  created_by: string;
};

type CollectionItem = {
  collection_id: string;
  candidat_id: string;
  created_at: string;
  note: string | null;
  position: number;
  added_by: string;
  candidat: {
    id: string;
    fullname: string;
    poste_type: string | null;
    localisation: string | null;
    performance_score: number | null;
    statut: string;
  } | null;
};

const colors = ["forest", "lime", "blue", "amber", "rose", "violet"];
const colorLabels: Record<string, string> = { forest: "Forêt", lime: "Citron vert", blue: "Bleu", amber: "Ambre", rose: "Rose", violet: "Violet" };

async function fetchCollectionData() {
  const supabase = createClient();
  const [collectionResult, memberResult] = await Promise.all([
    supabase.from("talent_collections").select("id, name, description, color, created_at, updated_at, created_by").order("updated_at", { ascending: false }),
    supabase.from("profiles").select("id, fullname").order("fullname"),
  ]);
  let supportsOrdering = true;
  let itemResult = await supabase.from("talent_collection_items").select("collection_id, candidat_id, created_at, note, position, added_by, candidat:candidats(id, fullname, poste_type, localisation, performance_score, statut)").order("position", { ascending: true });
  if (itemResult.error?.code === "42703" || itemResult.error?.code === "PGRST204") {
    supportsOrdering = false;
    const legacyResult = await supabase.from("talent_collection_items").select("collection_id, candidat_id, created_at, note, added_by, candidat:candidats(id, fullname, poste_type, localisation, performance_score, statut)").order("created_at", { ascending: true });
    itemResult = {
      ...legacyResult,
      data: (legacyResult.data || []).map((item, index) => ({ ...item, position: index + 1 })),
    } as typeof itemResult;
  }
  return { collectionResult, itemResult, memberResult, supportsOrdering };
}

export function CollectionManager({ canManage }: { canManage: boolean }) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [memberNames, setMemberNames] = useState<Map<string, string>>(new Map());
  const [orderingAvailable, setOrderingAvailable] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("forest");
  const [editingName, setEditingName] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function loadCollections(preferredId?: string) {
    const { collectionResult, itemResult, memberResult, supportsOrdering } = await fetchCollectionData();
    if (collectionResult.error || itemResult.error) {
      setMessage({ type: "error", text: "Les collections n’ont pas pu être chargées. Actualisez la page." });
    } else {
      const nextCollections = (collectionResult.data || []) as Collection[];
      setCollections(nextCollections);
      setItems((itemResult.data || []) as unknown as CollectionItem[]);
      setMemberNames(new Map((memberResult.data || []).map((member) => [member.id, member.fullname])));
      setOrderingAvailable(supportsOrdering);
      const nextActiveId = preferredId && nextCollections.some((collection) => collection.id === preferredId)
        ? preferredId
        : activeId && nextCollections.some((collection) => collection.id === activeId)
          ? activeId
          : nextCollections[0]?.id || null;
      setActiveId(nextActiveId);
      const active = nextCollections.find((collection) => collection.id === nextActiveId);
      setEditingName(active?.name || "");
      setEditingDescription(active?.description || "");
    }
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    void fetchCollectionData().then(({ collectionResult, itemResult, memberResult, supportsOrdering }) => {
      if (!active) return;
      if (collectionResult.error || itemResult.error) {
        setMessage({ type: "error", text: "Les collections n’ont pas pu être chargées. Actualisez la page." });
      } else {
        const nextCollections = (collectionResult.data || []) as Collection[];
        setCollections(nextCollections);
        setItems((itemResult.data || []) as unknown as CollectionItem[]);
        setMemberNames(new Map((memberResult.data || []).map((member) => [member.id, member.fullname])));
        setOrderingAvailable(supportsOrdering);
        const nextActiveId = nextCollections[0]?.id || null;
        setActiveId(nextActiveId);
        setEditingName(nextCollections[0]?.name || "");
        setEditingDescription(nextCollections[0]?.description || "");
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const activeCollection = collections.find((collection) => collection.id === activeId) || null;
  const activeItems = items
    .filter((item) => item.collection_id === activeId && item.candidat)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

  function selectCollection(collection: Collection) {
    setActiveId(collection.id);
    setEditingName(collection.name);
    setEditingDescription(collection.description || "");
    setMessage(null);
  }

  async function createCollection(event: FormEvent) {
    event.preventDefault();
    if (!canManage || name.trim().length < 2) return;
    setPending(true);
    setMessage(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("talent_collections")
      .insert({ name: name.trim(), description: description.trim() || null, color })
      .select("id")
      .single();
    if (error || !data) {
      setMessage({ type: "error", text: error?.code === "23505" ? "Une collection porte déjà ce nom." : "La collection n’a pas pu être créée." });
    } else {
      setName("");
      setDescription("");
      setColor("forest");
      setMessage({ type: "success", text: "Collection créée. Vous pouvez maintenant y ajouter des profils depuis la recherche." });
      await loadCollections(data.id);
    }
    setPending(false);
  }

  async function updateCollection(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !activeCollection || editingName.trim().length < 2) return;
    setPending(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.from("talent_collections").update({ name: editingName.trim(), description: editingDescription.trim() || null }).eq("id", activeCollection.id);
    if (error) {
      setMessage({ type: "error", text: error.code === "23505" ? "Une collection porte déjà ce nom." : "Les modifications n’ont pas été enregistrées." });
    } else {
      setMessage({ type: "success", text: "Collection mise à jour." });
      await loadCollections(activeCollection.id);
    }
    setPending(false);
  }

  async function deleteCollection() {
    if (!canManage || !activeCollection) return;
    setPending(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.from("talent_collections").delete().eq("id", activeCollection.id);
    if (error) {
      setMessage({ type: "error", text: "La collection n’a pas pu être supprimée." });
    } else {
      setMessage({ type: "success", text: `La collection « ${activeCollection.name} » a été supprimée.` });
      await loadCollections();
    }
    setPending(false);
  }

  async function removeCandidate(candidateId: string) {
    if (!canManage || !activeCollection) return;
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.from("talent_collection_items").delete().eq("collection_id", activeCollection.id).eq("candidat_id", candidateId);
    if (error) {
      setMessage({ type: "error", text: "Le profil n’a pas pu être retiré de la collection." });
    } else {
      setItems((current) => current.filter((item) => !(item.collection_id === activeCollection.id && item.candidat_id === candidateId)));
      setMessage({ type: "success", text: "Profil retiré de la collection." });
    }
    setPending(false);
  }

  async function saveCandidateNote(event: FormEvent<HTMLFormElement>, item: CollectionItem) {
    event.preventDefault();
    if (!canManage || !activeCollection) return;
    const note = String(new FormData(event.currentTarget).get("note") || "").trim().slice(0, 1000);
    setPending(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("talent_collection_items")
      .update({ note: note || null })
      .eq("collection_id", activeCollection.id)
      .eq("candidat_id", item.candidat_id);
    if (error) {
      setMessage({ type: "error", text: "La note n’a pas pu être enregistrée." });
    } else {
      setItems((current) => current.map((candidateItem) => candidateItem.collection_id === item.collection_id && candidateItem.candidat_id === item.candidat_id ? { ...candidateItem, note: note || null } : candidateItem));
      setMessage({ type: "success", text: "Note enregistrée pour l’équipe." });
    }
    setPending(false);
  }

  async function moveCandidate(index: number, direction: -1 | 1) {
    if (!canManage || !activeCollection) return;
    const current = activeItems[index];
    const target = activeItems[index + direction];
    if (!current || !target) return;
    setPending(true);
    setMessage(null);
    const supabase = createClient();
    const [currentResult, targetResult] = await Promise.all([
      supabase.from("talent_collection_items").update({ position: target.position }).eq("collection_id", activeCollection.id).eq("candidat_id", current.candidat_id),
      supabase.from("talent_collection_items").update({ position: current.position }).eq("collection_id", activeCollection.id).eq("candidat_id", target.candidat_id),
    ]);
    if (currentResult.error || targetResult.error) {
      setMessage({ type: "error", text: "L’ordre n’a pas pu être modifié. Réessayez." });
      await loadCollections(activeCollection.id);
    } else {
      setItems((allItems) => allItems.map((item) => {
        if (item.collection_id !== activeCollection.id) return item;
        if (item.candidat_id === current.candidat_id) return { ...item, position: target.position };
        if (item.candidat_id === target.candidat_id) return { ...item, position: current.position };
        return item;
      }));
      setMessage({ type: "success", text: "Priorité mise à jour." });
    }
    setPending(false);
  }

  if (loading) return <div className="collection-manager-loading"><LoaderCircle className="spin" size={24} /><strong>Chargement des collections…</strong></div>;

  return (
    <div className="collection-manager">
      <aside className="collection-sidebar">
        <div className="collection-sidebar-heading"><div><strong>Collections</strong><small>{collections.length} collection{collections.length > 1 ? "s" : ""}</small></div></div>
        {collections.length > 0 && <label className="collection-mobile-select"><span>Collection affichée</span><select value={activeId || ""} onChange={(event) => { const collection = collections.find((candidate) => candidate.id === event.target.value); if (collection) selectCollection(collection); }}>{collections.map((collection) => <option value={collection.id} key={collection.id}>{collection.name}</option>)}</select></label>}
        {collections.length ? <div className="collection-list">{collections.map((collection) => {
          const count = items.filter((item) => item.collection_id === collection.id).length;
          return <button className={collection.id === activeId ? "is-active" : ""} type="button" onClick={() => selectCollection(collection)} key={collection.id}><span className={`collection-color is-${collection.color}`} /><span><strong>{collection.name}</strong><small>{count} profil{count > 1 ? "s" : ""}</small></span><ChevronRight size={17} /></button>;
        })}</div> : <div className="collection-sidebar-empty"><FolderHeart size={24} /><p>Aucune collection pour le moment.</p></div>}

        {canManage && <details className="collection-create-card" open={collections.length === 0}>
          <summary><Plus size={17} /> Nouvelle collection</summary>
          <form onSubmit={createCollection}>
            <label><span>Nom</span><input value={name} maxLength={80} required placeholder="Ex. Finalistes produit" onChange={(event) => setName(event.target.value)} /></label>
            <label><span>Description <small>facultative</small></span><textarea value={description} maxLength={500} rows={3} placeholder="À quoi servira cette collection ?" onChange={(event) => setDescription(event.target.value)} /></label>
            <fieldset><legend>Couleur</legend><div>{colors.map((value) => <label title={colorLabels[value]} key={value}><input type="radio" name="color" value={value} aria-label={colorLabels[value]} checked={color === value} onChange={() => setColor(value)} /><span className={`collection-color is-${value}`} /></label>)}</div></fieldset>
            <button className="button button-primary" type="submit" disabled={pending || name.trim().length < 2}>{pending ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} Créer la collection</button>
          </form>
        </details>}
      </aside>

      <main className="collection-content">
        {message && <div className={`collection-message is-${message.type}`} role={message.type === "error" ? "alert" : "status"}>{message.type === "success" ? <Check size={18} /> : <AlertCircle size={18} />}{message.text}<button type="button" aria-label="Fermer" onClick={() => setMessage(null)}><X size={16} /></button></div>}
        {!activeCollection ? (
          <div className="collection-empty-state"><FolderHeart size={31} /><h2>Créez une collection utile.</h2><p>Regroupez les profils par mission, poste ou campagne de recrutement.</p>{canManage && <span>Utilisez « Nouvelle collection » pour commencer.</span>}</div>
        ) : (
          <>
            <header className="collection-content-header">
              <div><span className={`collection-color is-${activeCollection.color}`} /><div><small>Collection partagée · créée par {memberNames.get(activeCollection.created_by) || "un membre de l’équipe"}</small><h2>{activeCollection.name}</h2><p>{activeCollection.description || `${activeItems.length} profil${activeItems.length > 1 ? "s enregistrés" : " enregistré"}.`}</p></div></div>
              <Link className="button button-primary" href="/dashboard/recherche"><Search size={17} /> Rechercher des profils</Link>
            </header>

            {canManage && <details className="collection-settings">
              <summary><Pencil size={16} /> Modifier la collection</summary>
              <form onSubmit={updateCollection}><label><span>Nom</span><input value={editingName} maxLength={80} required onChange={(event) => setEditingName(event.target.value)} /></label><label><span>Description</span><textarea value={editingDescription} maxLength={500} rows={3} onChange={(event) => setEditingDescription(event.target.value)} /></label><button className="button button-secondary" type="submit" disabled={pending || editingName.trim().length < 2}>Enregistrer</button></form>
              <details className="collection-delete"><summary><Trash2 size={16} /> Supprimer la collection</summary><div><p>Les profils resteront dans le vivier. Seul ce regroupement sera supprimé.</p><button type="button" disabled={pending} onClick={() => void deleteCollection()}><Trash2 size={16} /> Supprimer définitivement</button></div></details>
            </details>}

            {activeItems.length ? <div className="collection-candidate-list">{activeItems.map((item, index) => {
              const candidate = item.candidat!;
              return <article key={candidate.id}>
                <div className="collection-candidate-avatar"><UserRound size={20} /></div>
                <div className="collection-candidate-copy"><span>{candidate.statut === "available" ? "Disponible" : candidate.statut === "employed" ? "En poste" : "Profil professionnel"}</span><h3>{candidate.fullname}</h3><p>{candidate.poste_type || "Expertise à compléter"}{candidate.localisation ? ` · ${candidate.localisation}` : ""}</p><small>Ajouté par {memberNames.get(item.added_by) || "un membre de l’équipe"}</small></div>
                {candidate.performance_score !== null && <strong>{candidate.performance_score}%</strong>}
                <div className="collection-candidate-actions">
                  {canManage && <>{orderingAvailable && <><button type="button" disabled={pending || index === 0} aria-label={`Monter ${candidate.fullname}`} onClick={() => void moveCandidate(index, -1)}><ArrowUp size={16} /></button><button type="button" disabled={pending || index === activeItems.length - 1} aria-label={`Descendre ${candidate.fullname}`} onClick={() => void moveCandidate(index, 1)}><ArrowDown size={16} /></button></>}<button type="button" disabled={pending} aria-label={`Retirer ${candidate.fullname}`} onClick={() => void removeCandidate(candidate.id)}><X size={17} /></button></>}
                  <Link href={`/dashboard/talents/${candidate.id}`} aria-label={`Ouvrir ${candidate.fullname}`}><ChevronRight size={19} /></Link>
                </div>
                {(canManage || item.note) && <details className="collection-candidate-note"><summary><StickyNote size={15} /> {item.note ? "Voir la note d’équipe" : "Ajouter une note"}</summary>{canManage ? <form onSubmit={(event) => void saveCandidateNote(event, item)}><label><span className="sr-only">Note sur {candidate.fullname}</span><textarea name="note" maxLength={1000} rows={3} defaultValue={item.note || ""} placeholder="Contexte, prochaine étape ou point à vérifier…" /></label><button className="button button-secondary" type="submit" disabled={pending}><Save size={15} /> Enregistrer la note</button></form> : <p>{item.note}</p>}</details>}
              </article>;
            })}</div> : <div className="collection-empty-state is-compact"><FolderHeart size={27} /><h2>Cette collection est vide.</h2><p>Lancez une recherche puis utilisez « Collection » sur un résultat.</p><Link className="button button-secondary" href="/dashboard/recherche"><Search size={17} /> Rechercher des profils</Link></div>}
          </>
        )}
      </main>
    </div>
  );
}
