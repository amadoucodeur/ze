"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AtSign, Check, Clipboard, Eye, LoaderCircle, LockKeyhole, Mail, Phone, ShieldCheck, UserPlus, UserRound } from "lucide-react";
import { createCollaboratorAction, type CollaboratorState } from "@/app/actions/team";

const initialState: CollaboratorState = {};

function identifierFromName(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 48);
}

export function CollaboratorForm({ organisationName }: { organisationName: string }) {
  const [state, action, pending] = useActionState(createCollaboratorAction, initialState);
  const [identifier, setIdentifier] = useState("");
  const [identifierEdited, setIdentifierEdited] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyCredentials() {
    if (!state.credentials) return;
    const text = `Accès ZeRecruit — ${organisationName}\nIdentifiant : ${state.credentials.identifiant}\nMot de passe temporaire : ${state.credentials.temporaryPassword}\nConnexion : ${window.location.origin}/connexion`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (state.credentials) {
    return (
      <div className="credentials-success-card">
        <span className="credentials-success-icon"><Check size={25} /></span>
        <div className="credentials-success-heading"><span>Compte collaborateur créé</span><h2>{state.credentials.fullname} peut rejoindre {organisationName}.</h2><p>Ces informations ne seront affichées qu’ici. Copiez-les avant de quitter cette page.</p></div>
        <div className="credentials-box">
          <div><small>Identifiant</small><code>{state.credentials.identifiant}</code></div>
          <div><small>Mot de passe temporaire</small><code>{state.credentials.temporaryPassword}</code></div>
        </div>
        <div className="credentials-security-note"><LockKeyhole size={17} /><p>À sa première connexion, le collaborateur devra obligatoirement choisir un nouveau mot de passe.</p></div>
        <div className="credentials-actions"><button className="button button-primary" type="button" onClick={copyCredentials}><Clipboard size={17} /> {copied ? "Accès copiés" : "Copier les accès"}</button><Link className="button button-ghost" href="/dashboard/equipe">Retour à l’équipe</Link></div>
      </div>
    );
  }

  return (
    <form action={action} className="settings-form collaborator-form">
      <div className="settings-card">
        <div className="settings-card-heading"><span className="settings-icon"><UserPlus size={19} /></span><div><h2>Informations du collaborateur</h2><p>Créez son identité de connexion au sein de {organisationName}.</p></div></div>
        <div className="settings-fields-grid">
          <label className="settings-field settings-field-wide"><span>Nom complet</span><div className="settings-input"><UserRound size={17} /><input name="fullname" placeholder="Ex. Aminata Koné" required maxLength={100} onChange={event => { if (!identifierEdited) setIdentifier(identifierFromName(event.target.value)); }} /></div>{state.errors?.fullname?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
          <label className="settings-field"><span>Email professionnel</span><div className="settings-input"><Mail size={17} /><input name="email" type="email" placeholder="aminata@entreprise.com" required /></div>{state.errors?.email?.map(error => <small className="field-error" key={error}>{error}</small>)}<small className="settings-hint">Utilisé en interne pour sécuriser le compte.</small></label>
          <label className="settings-field"><span>Téléphone</span><div className="settings-input"><Phone size={17} /><input name="phone" type="tel" placeholder="+225 07 00 00 00 00" maxLength={30} /></div>{state.errors?.phone?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
          <label className="settings-field"><span>Identifiant de connexion</span><div className="settings-input"><AtSign size={17} /><input name="identifiant" value={identifier} placeholder="aminata.kone" required autoCapitalize="none" spellCheck={false} onChange={event => { setIdentifierEdited(true); setIdentifier(identifierFromName(event.target.value)); }} /></div>{state.errors?.identifiant?.map(error => <small className="field-error" key={error}>{error}</small>)}<small className="settings-hint">Le collaborateur l’utilisera sur la page de connexion.</small></label>
          <label className="settings-field"><span>Rôle dans l’organisation</span><div className="settings-input"><ShieldCheck size={17} /><select name="role" defaultValue="recruiter"><option value="admin">Administrateur</option><option value="recruiter">Recruteur</option><option value="viewer">Lecteur</option></select></div>{state.errors?.role?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
        </div>
      </div>
      <div className="collaborator-role-guide">
        <article><ShieldCheck size={18} /><div><strong>Administrateur</strong><p>Supervise l’espace et les activités de l’équipe.</p></div></article>
        <article><UserRound size={18} /><div><strong>Recruteur</strong><p>Travaille sur les candidats, recherches et offres.</p></div></article>
        <article><Eye size={18} /><div><strong>Lecteur</strong><p>Consulte les informations sans modifier les données.</p></div></article>
      </div>
      {state.message && <div className="form-message form-error" role="alert">{state.message}</div>}
      <div className="settings-actions settings-actions-sticky"><div><strong>Un mot de passe temporaire sera généré.</strong><span>Vous devrez le transmettre au collaborateur après la création.</span></div><button className="button button-primary" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={17} /> Création...</> : <><UserPlus size={17} /> Créer le collaborateur</>}</button></div>
    </form>
  );
}
