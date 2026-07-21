"use client";

import { useActionState, useState } from "react";
import { AtSign, Building2, Check, FileText, Globe2, ImageIcon, Languages, LoaderCircle, LockKeyhole, Phone, Save, ShieldCheck, Sparkles } from "lucide-react";
import { createOrganisationAction, updateOrganisationAction, type SettingsState } from "@/app/actions/settings";
import type { CurrentOrganisation } from "@/lib/supabase/current-profile";

const initialState: SettingsState = {};

function slugify(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

type OrganisationFormProps = {
  mode: "create" | "update";
  organisation?: CurrentOrganisation;
  defaultEmail?: string | null;
  selectedPlan?: string | null;
  selectedCycle?: string;
};

export function OrganisationForm({ mode, organisation, defaultEmail, selectedPlan, selectedCycle }: OrganisationFormProps) {
  const actionHandler = mode === "create" ? createOrganisationAction : updateOrganisationAction;
  const [state, action, pending] = useActionState(actionHandler, initialState);
  const [identifier, setIdentifier] = useState(organisation?.identifiant ?? "");
  const [identifierEdited, setIdentifierEdited] = useState(mode === "update");
  const settings = organisation?.settings ?? {};
  const defaultLanguage = settings.default_language === "en" ? "en" : "fr";
  const retentionDays = typeof settings.candidate_retention_days === "number" ? settings.candidate_retention_days : 365;
  const aiScoringEnabled = settings.ai_scoring_enabled !== false;
  const automaticCvParsing = settings.automatic_cv_parsing !== false;

  return (
    <form action={action} className="settings-form organisation-settings-form">
      {mode === "create" && <><input type="hidden" name="selectedPlan" value={selectedPlan || ""} /><input type="hidden" name="selectedCycle" value={selectedCycle === "year" ? "year" : "month"} /></>}
      <div className="settings-card settings-card-main">
        <div className="settings-card-heading"><span className="settings-icon"><Building2 size={19} /></span><div><h2>{mode === "create" ? "Identité de votre entreprise" : "Informations de l’organisation"}</h2><p>{mode === "create" ? "Créez l’espace qui accueillera votre équipe et vos candidats." : "Gardez les coordonnées et l’identité de votre espace à jour."}</p></div></div>
        <div className="settings-fields-grid">
          <label className="settings-field"><span>Nom de l’entreprise</span><div className="settings-input"><Building2 size={17} /><input name="name" defaultValue={organisation?.name ?? ""} placeholder="Ex. Horizon Talent" required maxLength={100} onChange={event => { if (mode === "create" && !identifierEdited) setIdentifier(slugify(event.target.value)); }} /></div>{state.errors?.name?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
          {mode === "create" ? <label className="settings-field"><span>Identifiant de l’organisation</span><div className="settings-input"><AtSign size={17} /><input name="identifiant" value={identifier} placeholder="horizon-talent" required maxLength={40} autoCapitalize="none" spellCheck={false} onChange={event => { setIdentifierEdited(true); setIdentifier(slugify(event.target.value)); }} /></div>{state.errors?.identifiant?.map(error => <small className="field-error" key={error}>{error}</small>)}<small className="settings-hint">Il formera les accès de l’équipe, par exemple admin@horizon-talent.</small></label> : <div className="settings-field"><span>Identifiant de l’organisation</span><div className="settings-readonly-value"><AtSign size={17} /><strong>{identifier}</strong><small>Utilisé dans tous les accès de l’équipe</small></div><input type="hidden" name="identifiant" value={identifier} /><small className="settings-hint"><LockKeyhole size={13} /> Permanent pour préserver les identifiants de connexion.</small></div>}
          {mode === "update" ? <>
            <label className="settings-field"><span>Email professionnel</span><div className="settings-input"><AtSign size={17} /><input name="email" type="email" defaultValue={organisation?.email ?? defaultEmail ?? ""} placeholder="contact@entreprise.com" /></div>{state.errors?.email?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field"><span>Téléphone</span><div className="settings-input"><Phone size={17} /><input name="phone" type="tel" defaultValue={organisation?.phone ?? ""} placeholder="+225 07 00 00 00 00" maxLength={30} /></div>{state.errors?.phone?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field"><span>Site web</span><div className="settings-input"><Globe2 size={17} /><input name="websiteUrl" type="url" defaultValue={organisation?.website_url ?? ""} placeholder="https://entreprise.com" /></div>{state.errors?.websiteUrl?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field"><span>URL du logo</span><div className="settings-input"><ImageIcon size={17} /><input name="logoUrl" type="url" defaultValue={organisation?.logo_url ?? ""} placeholder="https://entreprise.com/logo.png" /></div>{state.errors?.logoUrl?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
            <label className="settings-field settings-field-wide"><span>Présentation</span><div className="settings-textarea"><FileText size={17} /><textarea name="description" defaultValue={organisation?.description ?? ""} placeholder="Décrivez en quelques mots votre entreprise et son activité." maxLength={600} rows={4} /></div>{state.errors?.description?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
          </> : <>
            <input type="hidden" name="email" value={defaultEmail ?? ""} />
            <input type="hidden" name="phone" value="" />
            <input type="hidden" name="websiteUrl" value="" />
            <input type="hidden" name="logoUrl" value="" />
            <input type="hidden" name="description" value="" />
          </>}
        </div>
      </div>

      {mode === "update" && <div className="settings-card">
        <div className="settings-card-heading"><span className="settings-icon settings-icon-soft"><Sparkles size={19} /></span><div><h2>Préférences du vivier</h2><p>Définissez le comportement par défaut pour toute l’organisation.</p></div></div>
        <div className="settings-fields-grid">
          <label className="settings-field"><span>Langue par défaut</span><div className="settings-input"><Languages size={17} /><select name="defaultLanguage" defaultValue={defaultLanguage}><option value="fr">Français</option><option value="en">Anglais</option></select></div></label>
          <label className="settings-field"><span>Conservation des candidats</span><div className="settings-input"><ShieldCheck size={17} /><select name="retentionDays" defaultValue={String(retentionDays)}><option value="180">6 mois</option><option value="365">1 an</option><option value="730">2 ans</option><option value="1095">3 ans</option></select></div>{state.errors?.retentionDays?.map(error => <small className="field-error" key={error}>{error}</small>)}</label>
        </div>
        <div className="settings-switch-list">
          <label><input type="checkbox" name="automaticCvParsing" defaultChecked={automaticCvParsing} /><span className="switch-control" /><div><strong>Analyse automatique des CV</strong><small>Structurer les informations dès l’import d’un document.</small></div></label>
          <label><input type="checkbox" name="aiScoringEnabled" defaultChecked={aiScoringEnabled} /><span className="switch-control" /><div><strong>Score de matching assisté par IA</strong><small>Afficher un score explicable entre les profils et les offres.</small></div></label>
        </div>
      </div>}

      {state.message && <div className="form-message form-error" role="alert">{state.message}</div>}
      {state.success && <div className="form-message form-success" role="status"><Check size={16} /> {state.success}</div>}
      <div className="settings-actions settings-actions-sticky"><div><strong>{mode === "create" ? "Deux informations, puis vous pourrez commencer." : "Les changements s’appliquent à toute votre organisation."}</strong><span>{mode === "create" ? "Les coordonnées et préférences restent modifiables plus tard." : "Votre plan et votre statut restent inchangés."}</span></div><button className="button button-primary" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={17} /> Enregistrement...</> : <><Save size={17} /> {mode === "create" ? "Créer et continuer" : "Enregistrer les modifications"}</>}</button></div>
    </form>
  );
}
