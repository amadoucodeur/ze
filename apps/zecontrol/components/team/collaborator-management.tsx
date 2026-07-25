"use client";

import { useActionState, useState } from "react";
import { Check, Clipboard, KeyRound, LoaderCircle, Save, ShieldCheck, UserRound } from "lucide-react";
import {
  resetCollaboratorPasswordAction,
  updateCollaboratorAction,
  type PasswordState,
  type TeamFormState,
} from "@/app/actions/team";
import { PasswordInput } from "@/components/auth/password-input";
import { CollaboratorStatusForm } from "./collaborator-status-form";
import { normalizeIdentifierPart } from "@/lib/identifiers";

type Collaborator = {
  id: string;
  fullname: string;
  email: string | null;
  phone: string | null;
  identifiant: string;
  is_active: boolean;
  must_change_password: boolean;
  role: "admin" | "agent";
  policy: "strict" | "flexible" | "free";
  can_remote: boolean;
  poste: string | null;
  service: string | null;
};

const updateInitial: TeamFormState = {};
const passwordInitial: PasswordState = {};

export function CollaboratorManagement({ collaborator, organisationIdentifier }: { collaborator: Collaborator; organisationIdentifier: string }) {
  const [updateState, updateAction, updatePending] = useActionState(updateCollaboratorAction.bind(null, collaborator.id), updateInitial);
  const [passwordState, passwordAction, passwordPending] = useActionState(resetCollaboratorPasswordAction.bind(null, collaborator.id), passwordInitial);
  const [identifier, setIdentifier] = useState(collaborator.identifiant.split("@")[0] ?? "");
  const [passwordMode, setPasswordMode] = useState<"generated" | "custom">("generated");
  const [policy, setPolicy] = useState<Collaborator["policy"]>(collaborator.policy);
  const [copied, setCopied] = useState(false);

  async function copyCredentials() {
    if (!passwordState.credentials) return;
    await navigator.clipboard.writeText(`Identifiant : ${passwordState.credentials.identifiant}\nMot de passe de départ : ${passwordState.credentials.temporaryPassword}\nConnexion : ${window.location.origin}/connexion`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="team-management-grid">
      <form action={updateAction} className="team-form">
        <section className="team-panel">
          <div className="team-panel-heading"><UserRound size={20} /><div><h2>Informations et configuration</h2><p>Les informations d’identité sont partagées dans ZeSuite ; les droits ci-dessous restent propres à ZeControl.</p></div></div>
          <div className="team-form-grid">
            <label className="team-field team-field-wide"><span>Nom complet</span><div><input name="fullname" defaultValue={collaborator.fullname} required /></div></label>
            <label className="team-field"><span>Email professionnel</span><div><input name="email" type="email" defaultValue={collaborator.email ?? ""} required /></div></label>
            <label className="team-field"><span>Téléphone</span><div><input name="phone" type="tel" defaultValue={collaborator.phone ?? ""} /></div></label>
            <label className="team-field"><span>Identifiant</span><div className="team-identifier"><input name="identifiant" value={identifier} onChange={(event) => setIdentifier(normalizeIdentifierPart(event.target.value))} required /><b>@{organisationIdentifier}</b></div></label>
            <label className="team-field"><span>Poste</span><div><input name="poste" defaultValue={collaborator.poste ?? ""} /></div></label>
            <label className="team-field"><span>Service</span><div><input name="service" defaultValue={collaborator.service ?? ""} /></div></label>
            <label className="team-field"><span>Rôle ZeControl</span><div><select name="role" defaultValue={collaborator.role}><option value="agent">Agent</option><option value="admin">Administrateur</option></select></div></label>
            <label className="team-field"><span>Politique</span><div><select name="policy" value={policy} onChange={(event) => setPolicy(event.target.value as typeof policy)}><option value="strict">Stricte</option><option value="flexible">Flexible</option><option value="free">Libre</option></select></div></label>
            <div className={`team-policy-explanation policy-${policy}`}><strong>{policy === "strict" ? "Hors zone : refusé" : policy === "flexible" ? "Hors zone : validation requise" : "Accepté partout"}</strong><small>{policy === "strict" ? "La présence sur site est obligatoire." : policy === "flexible" ? "Un administrateur prend la décision." : "La zone ne bloque jamais le pointage."}</small></div>
            <label className="team-check"><input type="checkbox" name="canRemote" defaultChecked={collaborator.can_remote} /><span><strong>Travail à distance autorisé</strong><small>Autorise le pointage distant selon les contrôles prévus.</small></span></label>
          </div>
          {updateState.message && <div className="form-message form-error">{updateState.message}</div>}
          {updateState.success && <div className="form-message form-success"><Check size={16} /> {updateState.success}</div>}
          <button className="button button-primary" type="submit" disabled={updatePending}>{updatePending ? <><LoaderCircle className="spin" size={17} /> Enregistrement...</> : <><Save size={17} /> Enregistrer</>}</button>
        </section>
      </form>

      <aside className="team-security-column">
        <section className="team-panel">
          <div className="team-panel-heading"><ShieldCheck size={20} /><div><h2>État de l’accès</h2><p>La suspension concerne uniquement ZeControl.</p></div></div>
          <div className="team-access-state"><span className={`team-status ${collaborator.is_active ? "active" : "inactive"}`}>{collaborator.is_active ? "Actif" : "Suspendu"}</span><strong>{collaborator.must_change_password ? "Nouveau mot de passe requis" : "Mot de passe configuré"}</strong></div>
          <CollaboratorStatusForm id={collaborator.id} active={collaborator.is_active} name={collaborator.fullname} />
        </section>

        <form action={passwordAction} className="team-panel">
          <div className="team-panel-heading"><KeyRound size={20} /><div><h2>Réinitialiser le mot de passe</h2><p>Ce changement concerne le compte ZeSuite partagé.</p></div></div>
          {passwordState.credentials ? <div className="team-reset-result"><small>Identifiant</small><code>{passwordState.credentials.identifiant}</code><small>Mot de passe de départ</small><code>{passwordState.credentials.temporaryPassword}</code><button className="button button-ghost" type="button" onClick={copyCredentials}><Clipboard size={16} /> {copied ? "Copié" : "Copier les accès"}</button></div> : <>
            <div className="team-password-modes compact">
              <label className={passwordMode === "generated" ? "selected" : ""}><input type="radio" name="passwordMode" value="generated" checked={passwordMode === "generated"} onChange={() => setPasswordMode("generated")} /><span><strong>Générer</strong><small>Recommandé</small></span></label>
              <label className={passwordMode === "custom" ? "selected" : ""}><input type="radio" name="passwordMode" value="custom" checked={passwordMode === "custom"} onChange={() => setPasswordMode("custom")} /><span><strong>Définir</strong><small>8 caractères minimum</small></span></label>
            </div>
            {passwordMode === "custom" && <div className="team-field team-password-field"><span>Nouveau mot de passe</span><PasswordInput id="reset-team-password" name="password" autoComplete="new-password" placeholder="8 caractères minimum" /></div>}
            {passwordState.message && <div className="form-message form-error">{passwordState.message}</div>}
            <button className="button button-ghost team-reset-button" type="submit" disabled={passwordPending}>{passwordPending ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} Réinitialiser</button>
          </>}
        </form>
      </aside>
    </div>
  );
}
