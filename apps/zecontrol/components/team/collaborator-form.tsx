"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  Check,
  Clipboard,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Phone,
  UserPlus,
  UserRound,
} from "lucide-react";
import {
  createCollaboratorAction,
  type CollaboratorState,
} from "@/app/actions/team";
import { PasswordInput } from "@/components/auth/password-input";
import { normalizeIdentifierPart } from "@/lib/identifiers";

const initialState: CollaboratorState = {};

export function CollaboratorForm({
  organisationName,
  organisationIdentifier,
}: {
  organisationName: string;
  organisationIdentifier: string;
}) {
  const [state, action, pending] = useActionState(
    createCollaboratorAction,
    initialState,
  );
  const [identifier, setIdentifier] = useState("");
  const [identifierEdited, setIdentifierEdited] = useState(false);
  const [passwordMode, setPasswordMode] = useState<"generated" | "custom">(
    "generated",
  );
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const formRef = useRef<HTMLFormElement>(null);

  function goToNextStep() {
    const currentSection = formRef.current?.querySelector<HTMLElement>(`[data-team-step="${step}"]`);
    const requiredFields = [...(currentSection?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[required], select[required]") ?? [])];
    const invalid = requiredFields.find((field) => !field.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return;
    }
    setStep((current) => Math.min(3, current + 1) as 1 | 2 | 3);
  }

  async function copyCredentials() {
    if (!state.credentials) return;
    await navigator.clipboard.writeText(
      `Accès ZeControl — ${organisationName}\nIdentifiant : ${state.credentials.identifiant}\nMot de passe de départ : ${state.credentials.temporaryPassword}\nConnexion : ${window.location.origin}/connexion`,
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (state.credentials) {
    return (
      <section className="team-success-card">
        <span><Check size={25} /></span>
        <p className="team-kicker">Compte créé</p>
        <h2>{state.credentials.fullname} peut rejoindre ZeControl.</h2>
        <p>Copiez ces informations avant de quitter cette page.</p>
        <div className="team-credentials">
          <div><small>Identifiant</small><code>{state.credentials.identifiant}</code></div>
          <div><small>Mot de passe de départ</small><code>{state.credentials.temporaryPassword}</code></div>
        </div>
        <div className="team-inline-note"><LockKeyhole size={16} /> Le collaborateur devra choisir un nouveau mot de passe à sa première connexion.</div>
        <div className="team-actions">
          <button className="button button-primary" type="button" onClick={copyCredentials}>
            <Clipboard size={17} /> {copied ? "Accès copiés" : "Copier les accès"}
          </button>
          <Link className="button button-ghost" href="/dashboard/equipe">Retour à l’équipe</Link>
        </div>
      </section>
    );
  }

  return (
    <form action={action} className="team-form" ref={formRef}>
      <nav className="team-form-progress" aria-label="Progression de la création">
        {["Identité", "Accès", "Sécurité"].map((label, index) => <button className={step === index + 1 ? "current" : step > index + 1 ? "complete" : ""} type="button" onClick={() => { if (index + 1 < step) setStep((index + 1) as 1 | 2 | 3); }} key={label}><span>{step > index + 1 ? <Check size={14} /> : index + 1}</span>{label}</button>)}
      </nav>
      <section className="team-panel" data-team-step="1" hidden={step !== 1}>
        <div className="team-panel-heading"><UserPlus size={20} /><div><h2>Identité du collaborateur</h2><p>Comme dans ZeRecruit, le compte appartient à l’organisation et utilise un identifiant dédié.</p></div></div>
        <div className="team-form-grid">
          <label className="team-field team-field-wide"><span>Nom complet</span><div><UserRound size={17} /><input name="fullname" required maxLength={100} placeholder="Ex. Aminata Koné" onChange={(event) => { if (!identifierEdited) setIdentifier(normalizeIdentifierPart(event.target.value)); }} /></div>{state.errors?.fullname?.map((error) => <small className="field-error" key={error}>{error}</small>)}</label>
          <label className="team-field"><span>Email professionnel</span><div><Mail size={17} /><input name="email" type="email" required placeholder="aminata@entreprise.com" /></div>{state.errors?.email?.map((error) => <small className="field-error" key={error}>{error}</small>)}</label>
          <label className="team-field"><span>Téléphone</span><div><Phone size={17} /><input name="phone" type="tel" maxLength={30} placeholder="+225 07 00 00 00 00" /></div></label>
          <label className="team-field"><span>Identifiant utilisateur</span><div className="team-identifier"><AtSign size={17} /><input name="identifiant" value={identifier} required onChange={(event) => { setIdentifierEdited(true); setIdentifier(normalizeIdentifierPart(event.target.value)); }} /><b>@{organisationIdentifier}</b></div>{state.errors?.identifiant?.map((error) => <small className="field-error" key={error}>{error}</small>)}</label>
          <label className="team-field"><span>Poste</span><div><input name="poste" placeholder="Ex. Responsable terrain" /></div></label>
          <label className="team-field"><span>Service</span><div><input name="service" placeholder="Ex. Opérations" /></div></label>
        </div>
      </section>

      <section className="team-panel" data-team-step="2" hidden={step !== 2}>
        <div className="team-panel-heading"><UserRound size={20} /><div><h2>Configuration ZeControl</h2><p>Ces droits restent propres à ZeControl.</p></div></div>
        <div className="team-form-grid">
          <label className="team-field"><span>Rôle</span><div><select name="role" defaultValue="agent"><option value="agent">Agent</option><option value="admin">Administrateur</option></select></div></label>
          <input type="hidden" name="policy" value="strict" />
          <label className="team-check"><input type="checkbox" name="canRemote" /><span><strong>Autoriser le pointage à distance</strong><small>Permet de pointer en dehors du site. La position reste enregistrée.</small></span></label>
        </div>
      </section>

      <section className="team-panel" data-team-step="3" hidden={step !== 3}>
        <div className="team-panel-heading"><LockKeyhole size={20} /><div><h2>Mot de passe de départ</h2><p>Il ne sera affiché qu’une fois.</p></div></div>
        <div className="team-password-modes">
          <label className={passwordMode === "generated" ? "selected" : ""}><input type="radio" name="passwordMode" value="generated" checked={passwordMode === "generated"} onChange={() => setPasswordMode("generated")} /><span><strong>Générer automatiquement</strong><small>Option recommandée</small></span></label>
          <label className={passwordMode === "custom" ? "selected" : ""}><input type="radio" name="passwordMode" value="custom" checked={passwordMode === "custom"} onChange={() => setPasswordMode("custom")} /><span><strong>Définir le mot de passe</strong><small>8 caractères minimum</small></span></label>
        </div>
        {passwordMode === "custom" && <div className="team-field team-password-field"><span>Mot de passe choisi</span><PasswordInput id="team-password" name="password" autoComplete="new-password" placeholder="8 caractères minimum" />{state.errors?.password?.map((error) => <small className="field-error" key={error}>{error}</small>)}</div>}
      </section>

      {state.message && <div className="form-message form-error" role="alert">{state.message}</div>}
      <div className="team-form-footer team-form-wizard-footer">
        <p>{step === 1 ? "Commencez par les informations essentielles." : step === 2 ? "Choisissez uniquement les droits nécessaires." : "Le collaborateur changera son mot de passe à la première connexion."}</p>
        <div>{step > 1 && <button className="button button-ghost" type="button" onClick={() => setStep((current) => Math.max(1, current - 1) as 1 | 2 | 3)}><ArrowLeft size={16} /> Retour</button>}{step < 3 ? <button className="button button-primary" type="button" onClick={goToNextStep}>Continuer <ArrowRight size={16} /></button> : <button className="button button-primary" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={17} /> Création...</> : <><UserPlus size={17} /> Créer le collaborateur</>}</button>}</div>
      </div>
    </form>
  );
}
