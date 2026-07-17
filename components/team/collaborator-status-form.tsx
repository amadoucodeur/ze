"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle, PauseCircle, PlayCircle } from "lucide-react";
import { setCollaboratorStatusAction } from "@/app/actions/team";

function StatusButton({ active }: { active: boolean }) {
  const { pending } = useFormStatus();
  return <button className={`team-status-button ${active ? "danger" : "success"}`} type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15} /> : active ? <PauseCircle size={15} /> : <PlayCircle size={15} />}{active ? "Suspendre" : "Réactiver"}</button>;
}

export function CollaboratorStatusForm({ id, active, name }: { id: string; active: boolean; name: string }) {
  const action = setCollaboratorStatusAction.bind(null, id, !active);
  return <form action={action} onSubmit={event => { if (active && !window.confirm(`Suspendre l’accès de ${name} ?`)) event.preventDefault(); }}><StatusButton active={active} /></form>;
}
