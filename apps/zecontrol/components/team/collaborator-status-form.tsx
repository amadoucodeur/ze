"use client";

import { useState } from "react";
import { AlertTriangle, LoaderCircle, PauseCircle, PlayCircle, X } from "lucide-react";
import { useFormStatus } from "react-dom";
import { setCollaboratorStatusAction } from "@/app/actions/team";

function StatusButton({ active }: { active: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className={`team-status-button ${active ? "danger" : "success"}`} type="submit" disabled={pending}>
      {pending ? <LoaderCircle className="spin" size={16} /> : active ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
      {active ? "Suspendre dans ZeControl" : "Réactiver dans ZeControl"}
    </button>
  );
}

export function CollaboratorStatusForm({ id, active, name }: { id: string; active: boolean; name: string }) {
  const action = setCollaboratorStatusAction.bind(null, id, !active);
  const [confirming, setConfirming] = useState(false);

  if (!active) return <form action={action}><StatusButton active={active} /></form>;

  return (
    <>
      <button className="team-status-button danger" type="button" onClick={() => setConfirming(true)}><PauseCircle size={16} /> Suspendre dans ZeControl</button>
      {confirming && <div className="team-confirm-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirming(false); }}>
        <section className="team-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="team-confirm-title">
          <button className="team-confirm-close" type="button" aria-label="Fermer" onClick={() => setConfirming(false)}><X size={18} /></button>
          <span><AlertTriangle size={22} /></span>
          <h2 id="team-confirm-title">Suspendre l’accès de {name}&nbsp;?</h2>
          <p>Cette personne ne pourra plus utiliser ZeControl. Son compte ZeSuite et ses autres produits resteront actifs.</p>
          <footer><button type="button" onClick={() => setConfirming(false)}>Annuler</button><form action={action}><StatusButton active={active} /></form></footer>
        </section>
      </div>}
    </>
  );
}
