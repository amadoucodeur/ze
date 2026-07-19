"use client";

import { useActionState, useState } from "react";
import { Check, Clipboard, KeyRound, LoaderCircle, Mail, Phone, Save, ShieldCheck, UserRound } from "lucide-react";
import {
  resetCollaboratorPasswordAction,
  updateCollaboratorAction,
  type CollaboratorPasswordState,
  type CollaboratorUpdateState,
} from "@/app/actions/team";
import { PasswordInput } from "@/components/auth/password-input";
import { CollaboratorStatusForm } from "@/components/team/collaborator-status-form";
import { normalizeIdentifierPart } from "@/lib/identifiers";

type ManagedCollaborator = {
  id: string;
  fullname: string;
  email: string | null;
  phone: string | null;
  identifiant: string;
  role: "admin" | "recruiter" | "viewer";
  is_active: boolean;
  must_change_password: boolean;
};

const initialUpdateState: CollaboratorUpdateState = {};
const initialPasswordState: CollaboratorPasswordState = {};

export function CollaboratorManagement({ collaborator, organisationIdentifier }: { collaborator: ManagedCollaborator; organisationIdentifier: string }) {
  const updateAction = updateCollaboratorAction.bind(null, collaborator.id);
  const resetAction = resetCollaboratorPasswordAction.bind(null, collaborator.id);
  const [updateState, updateFormAction, updatePending] = useActionState(updateAction, initialUpdateState);
  const [passwordState, passwordFormAction, passwordPending] = useActionState(resetAction, initialPasswordState);
  const [identifier, setIdentifier] = useState(collaborator.identifiant.split("@")[0] ?? "");
  const [passwordMode, setPasswordMode] = useState<"generated" | "custom">("generated");
  const [copied, setCopied] = useState(false);

  async function copyCredentials() {
    if (!passwordState.credentials) return;
    await navigator.clipboard.writeText(`Identifiant : ${passwordState.credentials.identifiant}\nMot de passe de départ : ${passwordState.credentials.temporaryPassword}\nConnexion : ${window.location.origin}/connexion`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="collaborator-management-grid">
      <form action={updateFormAction} className="settings-form collaborator-edit-form">
        <div className="settings-card">
          <div className="settings-card-heading"><span className="settings-icon"><UserRound size={19} /></span><div><h2>Informations et rôle</h2><p>Mettez à jour les informations visibles et les permissions du collaborateur.</p></div></div>
          <div className="settings-fields-grid">
            <label className="settings-field settings-field-wide"><span>Nom complet</span><div className="settings-input"><UserRound size={17} /><input name="fullname" defaultValue={collaborator.fullname} required maxLength={100} /></div>{updateState.errors?.fullname?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field"><span>Email professionnel</span><div className="settings-input"><Mail size={17} /><input name="email" type="email" defaultValue={collaborator.email ?? ""} required /></div>{updateState.errors?.email?.map(error => <small className="field-error" key={error}>{error}</small>)}<small className="settings-hint">Adresse de contact uniquement, jamais utilisée pour la connexion.</small></label>
            <label className="settings-field"><span>Téléphone</span><div className="settings-input"><Phone size={17} /><input name="phone" type="tel" defaultValue={collaborator.phone ?? ""} maxLength={30} /></div>{updateState.errors?.phone?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field"><span>Identifiant utilisateur</span><div className="settings-input identifier-composer"><UserRound size={17} /><input name="identifiant" value={identifier} required autoCapitalize="none" spellCheck={false} onChange={event => setIdentifier(normalizeIdentifierPart(event.target.value))} /><b>@{organisationIdentifier}</b></div>{updateState.errors?.identifiant?.map(error => <small className="field-error" key={error}>{error}</small>)}<small className="settings-hint">Nouvelle connexion : {identifier || "utilisateur"}@{organisationIdentifier}</small></label>
            <label className="settings-field"><span>Rôle dans l’organisation</span><div className="settings-input"><ShieldCheck size={17} /><select name="role" defaultValue={collaborator.role}><option value="admin">Administrateur</option><option value="recruiter">Recruteur</option><option value="viewer">Lecteur</option></select></div>{updateState.errors?.role?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
          </div>
        </div>
        {updateState.message && <div className="form-message form-error" role="alert">{updateState.message}</div>}
        {updateState.success && <div className="form-message form-success" role="status"><Check size={16} /> {updateState.success}</div>}
        <div className="settings-actions"><button className="button button-primary" type="submit" disabled={updatePending}>{updatePending ? <><LoaderCircle className="spin" size={17} /> Enregistrement...</> : <><Save size={17} /> Enregistrer les modifications</>}</button></div>
      </form>

      <aside className="collaborator-security-panel">
        <section className="settings-card collaborator-access-card">
          <div className="settings-card-heading"><span className="settings-icon"><ShieldCheck size={19} /></span><div><h2>État de l’accès</h2><p>Une suspension bloque immédiatement les prochaines connexions.</p></div></div>
          <div className="collaborator-access-status"><span className={`team-status ${collaborator.is_active ? "active" : "inactive"}`}>{collaborator.is_active ? "Actif" : "Suspendu"}</span><strong>{collaborator.must_change_password ? "Nouveau mot de passe requis" : "Mot de passe configuré"}</strong></div>
          <CollaboratorStatusForm id={collaborator.id} active={collaborator.is_active} name={collaborator.fullname} />
        </section>

        <form action={passwordFormAction} className="settings-card collaborator-password-card">
          <div className="settings-card-heading"><span className="settings-icon"><KeyRound size={19} /></span><div><h2>Réinitialiser le mot de passe</h2><p>Le collaborateur devra remplacer ce mot de passe à sa prochaine connexion.</p></div></div>
          {passwordState.credentials ? <div className="password-reset-result"><div><small>Identifiant</small><code>{passwordState.credentials.identifiant}</code></div><div><small>Mot de passe de départ</small><code>{passwordState.credentials.temporaryPassword}</code></div><button className="button button-secondary" type="button" onClick={copyCredentials}><Clipboard size={16} /> {copied ? "Accès copiés" : "Copier les accès"}</button></div> : <>
            <div className="password-mode-grid compact" role="radiogroup" aria-label="Choix du nouveau mot de passe de départ">
              <label className={passwordMode === "generated" ? "selected" : ""}><input type="radio" name="passwordMode" value="generated" checked={passwordMode === "generated"} onChange={() => setPasswordMode("generated")} /><span><strong>Générer</strong><small>Option recommandée</small></span></label>
              <label className={passwordMode === "custom" ? "selected" : ""}><input type="radio" name="passwordMode" value="custom" checked={passwordMode === "custom"} onChange={() => setPasswordMode("custom")} /><span><strong>Définir</strong><small>8 caractères minimum</small></span></label>
            </div>
            {passwordMode === "custom" && <div className="settings-field password-custom-field"><span>Nouveau mot de passe de départ</span><PasswordInput id="reset-collaborator-password" name="password" autoComplete="new-password" placeholder="8 caractères minimum" />{passwordState.errors?.password?.map(error => <small className="field-error" key={error}>{error}</small>)}</div>}
            {passwordState.message && <div className="form-message form-error" role="alert">{passwordState.message}</div>}
            <button className="button button-secondary collaborator-reset-button" type="submit" disabled={passwordPending}>{passwordPending ? <><LoaderCircle className="spin" size={16} /> Réinitialisation...</> : <><KeyRound size={16} /> Réinitialiser le mot de passe</>}</button>
          </>}
        </form>
      </aside>
    </div>
  );
}
