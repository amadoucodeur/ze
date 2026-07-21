"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, FolderPlus, LoaderCircle, Plus, X } from "lucide-react";
import { trackProductEvent } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";

type Collection = { id: string; name: string; color: string };

export function CollectionPicker({ candidateId, source = "candidate_profile" }: { candidateId: string; source?: string }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    function closeAndRestoreFocus() {
      detailsRef.current?.removeAttribute("open");
      summaryRef.current?.focus();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && detailsRef.current?.open) closeAndRestoreFocus();
    }
    function onPointerDown(event: PointerEvent) {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.removeAttribute("open");
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void Promise.all([
      supabase.from("talent_collections").select("id, name, color").order("updated_at", { ascending: false }),
      supabase.from("talent_collection_items").select("collection_id").eq("candidat_id", candidateId),
    ]).then(([collectionResult, itemResult]) => {
      if (!active) return;
      if (collectionResult.error || itemResult.error) {
        setMessage("Les collections ne sont pas disponibles pour le moment.");
      } else {
        setCollections((collectionResult.data || []) as Collection[]);
        setSelectedIds(new Set((itemResult.data || []).map((item) => item.collection_id)));
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [candidateId]);

  async function toggleCollection(collection: Collection) {
    setPendingId(collection.id);
    setMessage(null);
    const supabase = createClient();
    const selected = selectedIds.has(collection.id);
    const result = selected
      ? await supabase.from("talent_collection_items").delete().eq("collection_id", collection.id).eq("candidat_id", candidateId)
      : await supabase.from("talent_collection_items").insert({ collection_id: collection.id, candidat_id: candidateId });
    if (result.error) {
      setMessage("La collection n’a pas pu être mise à jour. Réessayez.");
    } else {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (selected) next.delete(collection.id); else next.add(collection.id);
        return next;
      });
      setMessage(selected ? `Retiré de « ${collection.name} ».` : `Ajouté à « ${collection.name} ».`);
      if (!selected) void trackProductEvent("candidate_added_to_collection", { collection_id: collection.id, source });
    }
    setPendingId(null);
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (name.length < 2) {
      setMessage("Donnez un nom à la nouvelle collection.");
      return;
    }
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
    const { error: itemError } = await supabase.from("talent_collection_items").insert({ collection_id: data.id, candidat_id: candidateId });
    if (itemError) {
      await supabase.from("talent_collections").delete().eq("id", data.id);
      setMessage("La collection a été créée, mais le profil n’a pas pu y être ajouté.");
    } else {
      setCollections((current) => [data as Collection, ...current]);
      setSelectedIds((current) => new Set(current).add(data.id));
      setNewName("");
      setMessage(`Collection « ${data.name} » créée.`);
      void trackProductEvent("candidate_added_to_collection", { collection_id: data.id, source });
    }
    setCreating(false);
  }

  return (
    <details className="collection-picker" ref={detailsRef}>
      <summary ref={summaryRef}><FolderPlus size={17} /> Enregistrer</summary>
      <div className="collection-picker-popover">
        <div className="collection-picker-heading">
          <div><strong>Ranger ce profil</strong><small>Une collection peut être partagée avec l’équipe.</small></div>
          <button type="button" aria-label="Fermer" onClick={() => { detailsRef.current?.removeAttribute("open"); summaryRef.current?.focus(); }}><X size={17} /></button>
        </div>
        {loading ? (
          <div className="collection-picker-loading"><LoaderCircle className="spin" size={19} /> Chargement…</div>
        ) : collections.length ? (
          <div className="collection-picker-list">
            {collections.map((collection) => {
              const selected = selectedIds.has(collection.id);
              return (
                <button type="button" disabled={pendingId !== null} onClick={() => void toggleCollection(collection)} key={collection.id}>
                  <span className={`collection-color is-${collection.color}`} />
                  <strong>{collection.name}</strong>
                  {pendingId === collection.id ? <LoaderCircle className="spin" size={17} /> : selected ? <Check size={17} /> : <Plus size={17} />}
                </button>
              );
            })}
          </div>
        ) : <p className="collection-picker-empty">Créez votre première collection pour conserver ce profil.</p>}
        <div className="collection-picker-create">
          <label><span className="sr-only">Nom de la nouvelle collection</span><input value={newName} maxLength={80} placeholder="Nouvelle collection…" disabled={creating} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createAndAdd(); } }} /></label>
          <button type="button" disabled={creating || newName.trim().length < 2} onClick={() => void createAndAdd()}>{creating ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} Créer</button>
        </div>
        {message && <p className="collection-picker-message" role="status">{message}</p>}
        <Link href="/dashboard/collections">Gérer les collections</Link>
      </div>
    </details>
  );
}
