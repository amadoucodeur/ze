"use client";

import { useActionState } from "react";
import { ArrowRight, LoaderCircle, UserRound } from "lucide-react";
import { PasswordInput } from "@/components/auth/password-input";
import {
  requestPasswordResetAction,
  updatePasswordAction,
  type AuthState,
} from "@/app/actions/auth";

const initialState: AuthState = {};

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, initialState);
  return <><div className="auth-form-heading"><span>Récupération sécurisée</span><h2>Mot de passe oublié&nbsp;?</h2><p>Votre organisation gère vos accès. Indiquez votre identifiant pour obtenir la marche à suivre.</p></div><form action={action} className="auth-form"><div className="field-label"><label htmlFor="reset-identifiant">Identifiant complet</label><div className="input-wrap"><UserRound size={18} aria-hidden="true" /><input id="reset-identifiant" name="identifiant" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="amadou@trabad" required /></div><small className="field-hint">Format : utilisateur@organisation</small>{state.errors?.identifiant?.map((error) => <small className="field-error" key={error}>{error}</small>)}</div>{state.success && <div className="form-message form-success" role="status">{state.success}</div>}<button className="button button-primary auth-submit" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={18} /> Vérification...</> : <>Continuer <ArrowRight size={18} /></>}</button></form></>;
}

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, initialState);
  return <><div className="auth-form-heading"><span>Dernière étape</span><h2>Choisissez un nouveau mot de passe</h2><p>Utilisez au moins 8 caractères et évitez un mot de passe déjà utilisé ailleurs.</p></div><form action={action} className="auth-form"><div className="field-label"><label htmlFor="new-password">Nouveau mot de passe</label><PasswordInput id="new-password" name="password" autoComplete="new-password" />{state.errors?.password?.map((error) => <small className="field-error" key={error}>{error}</small>)}</div><div className="field-label"><label htmlFor="confirm-password">Confirmez le mot de passe</label><PasswordInput id="confirm-password" name="confirmPassword" autoComplete="new-password" />{state.errors?.confirmPassword?.map((error) => <small className="field-error" key={error}>{error}</small>)}</div>{state.message && <div className="form-message form-error">{state.message}</div>}<button className="button button-primary auth-submit" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={18} /> Mise à jour...</> : <>Enregistrer le mot de passe <ArrowRight size={18} /></>}</button></form></>;
}
