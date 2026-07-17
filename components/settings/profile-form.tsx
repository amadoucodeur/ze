"use client";

import { useActionState } from "react";
import { AtSign, Check, LoaderCircle, LockKeyhole, Phone, Save, UserRound } from "lucide-react";
import { updateProfileAction, type SettingsState } from "@/app/actions/settings";
import type { CurrentProfile } from "@/lib/supabase/current-profile";

const initialState: SettingsState = {};

export function ProfileForm({ profile }: { profile: CurrentProfile }) {
  const [state, action, pending] = useActionState(updateProfileAction, initialState);

  return (
    <form action={action} className="settings-form">
      <div className="settings-card settings-card-main">
        <div className="settings-card-heading"><span className="settings-icon"><UserRound size={19} /></span><div><h2>Informations personnelles</h2><p>Ces informations permettent à votre équipe de vous identifier.</p></div></div>
        <div className="settings-fields-grid">
          <label className="settings-field settings-field-wide"><span>Nom complet</span><div className="settings-input"><UserRound size={17} /><input name="fullname" defaultValue={profile.fullname} required maxLength={100} /></div>{state.errors?.fullname?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
          <label className="settings-field"><span>Téléphone</span><div className="settings-input"><Phone size={17} /><input name="phone" type="tel" defaultValue={profile.phone ?? ""} placeholder="+225 07 00 00 00 00" maxLength={30} /></div>{state.errors?.phone?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
          <label className="settings-field"><span>Email du compte</span><div className="settings-input settings-input-readonly"><AtSign size={17} /><input value={profile.email ?? "Non renseigné"} readOnly /></div><small className="settings-hint"><LockKeyhole size={12} /> Géré par votre méthode de connexion</small></label>
          <label className="settings-field settings-field-wide"><span>Identifiant ZeRecruit</span><div className="settings-input settings-input-readonly"><AtSign size={17} /><input value={profile.identifiant} readOnly /></div><small className="settings-hint">Votre identifiant permanent au sein de ZeRecruit.</small></label>
        </div>
        {state.message && <div className="form-message form-error" role="alert">{state.message}</div>}
        {state.success && <div className="form-message form-success" role="status"><Check size={16} /> {state.success}</div>}
        <div className="settings-actions"><button className="button button-primary" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={17} /> Enregistrement...</> : <><Save size={17} /> Enregistrer le profil</>}</button></div>
      </div>
    </form>
  );
}
