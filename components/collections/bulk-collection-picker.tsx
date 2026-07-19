"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FolderPlus, LoaderCircle, Plus, X } from "lucide-react";
import { trackProductEvent } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";

type Collection = { id: string; name: string; color: string };

export function BulkCollectionPicker({
  candidateIds,
  onComplete,
}: {
  candidateIds: string[];
  onComplete: (message: string) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !detailsRef.current?.open) return;
      detailsRef.current.removeAttribute("open");
      summaryRef.current?.focus();
    }

    function onPointerDown(event: PointerEvent) {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        details.removeAttribute("open");
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  async function loadCollections() {
    if (loaded || loading) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("talent_collections")
      .select("id, name, color")
      .order("updated_at", { ascending: false });
    if (error) setMessage("Les collections ne sont pas disponibles pour le moment.");
    else {
      setCollections((data || []) as Collection[]);
      setLoaded(true);
    }
    setLoading(false);
  }

  async function addToCollection(collection: Collection) {
    if (!candidateIds.length) return;
    setPendingId(collection.id);
    setMessage(null);
    const supabase = createClient();
    const rows = candidateIds.map((candidateId) => ({ collection_id: collection.id, candidat_id: candidateId }));
    const { error } = await supabase
      .from("talent_collection_items")
      .upsert(rows, { onConflict: "collection_id,candidat_id", ignoreDuplicates: true });

    if (error) {
      setMessage("Les profils n’ont pas pu être ajoutés. Réessayez.");
    } else {
      const label = `${candidateIds.length} profil${candidateIds.length > 1 ? "s ajoutés" : " ajouté"} à « ${collection.name} ».`;
      onComplete(label);
      detailsRef.current?.removeAttribute("open");
      void trackProductEvent("candidate_added_to_collection", {
        collection_id: collection.id,
        source: "talent_search_bulk",
        candidate_count: candidateIds.length,
      });
    }
    setPendingId(null);
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (name.length < 2 || !candidateIds.length) return;
    setCreating(true);
    setMessage(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("talent_collections")
      .insert({ name, color: "forest" })
      .select("id, name, color")
      .single();

    if (error || !data) {
      setMessage(error?.code === "23505" ? "Une collection porte déjà ce nom." : "La collection n’a pas pu être créée.");
      setCreating(false);
      return;
    }

    setCollections((current) => [data as Collection, ...current]);
    setNewName("");
    await addToCollection(data as Collection);
    setCreating(false);
  }

  return (
    <details className="bulk-collection-picker" ref={detailsRef} onToggle={(event) => { if (event.currentTarget.open) void loadCollections(); }}>
      <summary ref={summaryRef} className="button button-primary">
        <FolderPlus size={17} /> Ajouter à une collection <ChevronDown size={16} />
      </summary>
      <div className="bulk-collection-popover">
        <div className="collection-picker-heading">
          <div><strong>Organiser la sélection</strong><small>{candidateIds.length} profil{candidateIds.length > 1 ? "s sélectionnés" : " sélectionné"}</small></div>
          <button type="button" aria-label="Fermer" onClick={() => { detailsRef.current?.removeAttribute("open"); summaryRef.current?.focus(); }}><X size={17} /></button>
        </div>

        {loading ? <div className="collection-picker-loading"><LoaderCircle className="spin" size={18} /> Chargement…</div> : collections.length ? (
          <div className="collection-picker-list">
            {collections.map((collection) => (
              <button type="button" disabled={pendingId !== null || creating} onClick={() => void addToCollection(collection)} key={collection.id}>
                <span className={`collection-color is-${collection.color}`} />
                <strong>{collection.name}</strong>
                {pendingId === collection.id ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}
              </button>
            ))}
          </div>
        ) : <p className="collection-picker-empty">Créez une première collection pour organiser ces profils.</p>}

        <div className="collection-picker-create">
          <label><span className="sr-only">Nom de la nouvelle collection</span><input value={newName} maxLength={80} placeholder="Nouvelle collection…" disabled={creating} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createAndAdd(); } }} /></label>
          <button type="button" disabled={creating || newName.trim().length < 2} onClick={() => void createAndAdd()}>{creating ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} Créer</button>
        </div>
        {message && <p className="collection-picker-message" role="status">{message}</p>}
        <Link href="/dashboard/collections"><Check size={15} /> Gérer les collections</Link>
      </div>
    </details>
  );
}
