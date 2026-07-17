"use client";

import { useActionState } from "react";
import { AtSign, BriefcaseBusiness, LoaderCircle, MapPin, Phone, Save, UserRound } from "lucide-react";
import { createTalentAction, type TalentState } from "@/app/actions/talents";

const initialState: TalentState = {};

export function TalentForm() {
  const [state, action, pending] = useActionState(createTalentAction, initialState);

  return (
    <form action={action} className="settings-form talent-form">
      <div className="settings-card">
        <div className="settings-card-heading"><span className="settings-icon"><UserRound size={20} /></span><div><h2>Informations essentielles</h2><p>Commencez avec ce que vous savez. Le profil pourra être enrichi plus tard.</p></div></div>
        <div className="settings-fields-grid">
          <label className="settings-field settings-field-wide"><span>Nom complet</span><div className="settings-input"><UserRound size={18} /><input name="fullname" placeholder="Ex. Aminata Koné" required maxLength={120} autoFocus /></div>{state.errors?.fullname?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
          <label className="settings-field"><span>Poste ou expertise</span><div className="settings-input"><BriefcaseBusiness size={18} /><input name="posteType" placeholder="Ex. Product designer" maxLength={120} /></div>{state.errors?.posteType?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
          <label className="settings-field"><span>Localisation</span><div className="settings-input"><MapPin size={18} /><input name="localisation" placeholder="Ex. Abidjan" maxLength={120} /></div>{state.errors?.localisation?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
          <label className="settings-field"><span>Email</span><div className="settings-input"><AtSign size={18} /><input name="email" type="email" placeholder="talent@exemple.com" /></div>{state.errors?.email?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
          <label className="settings-field"><span>Téléphone</span><div className="settings-input"><Phone size={18} /><input name="phone" type="tel" placeholder="+225 07 00 00 00 00" maxLength={30} /></div>{state.errors?.phone?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
          <label className="settings-field settings-field-wide"><span>Résumé</span><div className="settings-textarea"><BriefcaseBusiness size={18} /><textarea name="summary" placeholder="Expérience, points forts ou contexte utile…" maxLength={1200} rows={5} /></div>{state.errors?.summary?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
        </div>
      </div>
      {state.message && <div className="form-message form-error" role="alert">{state.message}</div>}
      <div className="settings-actions settings-actions-sticky"><div><strong>Seul le nom est obligatoire.</strong><span>Vous pourrez compléter ce profil à tout moment.</span></div><button className="button button-primary" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={18} /> Ajout en cours…</> : <><Save size={18} /> Ajouter au vivier</>}</button></div>
    </form>
  );
}
