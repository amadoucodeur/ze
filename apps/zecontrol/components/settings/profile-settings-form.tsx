"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AtSign,
  BriefcaseBusiness,
  Building2,
  Check,
  LoaderCircle,
  LockKeyhole,
  Phone,
  Save,
  UserRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ProfileSettingsFormProps = {
  profile: {
    fullname: string;
    email: string | null;
    phone: string | null;
    identifiant: string;
  };
  config: {
    poste: string | null;
    service: string | null;
  };
  showProfessional?: boolean;
};

export function ProfileSettingsForm({
  profile,
  config,
  showProfessional = true,
}: ProfileSettingsFormProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [fullname, setFullname] = useState(profile.fullname);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [poste, setPoste] = useState(config.poste ?? "");
  const [service, setService] = useState(config.service ?? "");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; message: string } | null>(null);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (fullname.trim().length < 2) {
      setFeedback({ type: "error", message: "Saisissez votre nom complet." });
      return;
    }
    if (fullname.trim().length > 100 || phone.trim().length > 30 || poste.trim().length > 100 || service.trim().length > 100) {
      setFeedback({ type: "error", message: "Une des informations saisies est trop longue." });
      return;
    }

    setPending(true);
    try {
      const { error } = await supabase
        .schema("zecontrol")
        .rpc("update_own_profile_settings", {
          new_fullname: fullname.trim(),
          new_phone: phone.trim(),
          new_poste: poste.trim(),
          new_service: service.trim(),
        });

      if (error) {
        const accessExpired = /authentication_required|access_denied|jwt|session/i.test(error.message);
        setFeedback({
          type: "error",
          message: accessExpired
            ? "Votre session ou votre accès ZeControl a expiré. Reconnectez-vous."
            : "Votre profil n’a pas pu être enregistré. Réessayez.",
        });
        return;
      }

      setFeedback({
        type: "success",
        message: showProfessional
          ? "Votre profil et votre configuration ont été mis à jour."
          : "Votre profil a été mis à jour.",
      });
      router.refresh();
    } catch {
      setFeedback({
        type: "error",
        message: "La connexion a été interrompue. Vérifiez votre réseau puis réessayez.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={saveProfile} className="settings-form profile-settings-form">
      <section className="settings-card settings-card-main">
        <div className="settings-card-heading">
          <span className="settings-icon"><UserRound size={19} /></span>
          <div>
            <h2>Identité ZeSuite</h2>
            <p>Ces informations sont partagées avec les autres produits ZeSuite.</p>
          </div>
        </div>
        <div className="settings-fields-grid">
          <label className="settings-field settings-field-wide">
            <span>Nom complet</span>
            <div className="settings-input"><UserRound size={17} /><input value={fullname} onChange={(event) => setFullname(event.target.value)} required maxLength={100} /></div>
          </label>
          <label className="settings-field">
            <span>Téléphone</span>
            <div className="settings-input"><Phone size={17} /><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+225 07 00 00 00 00" maxLength={30} /></div>
          </label>
          <div className="settings-field">
            <span>Email du compte</span>
            <div className="settings-readonly-value"><AtSign size={17} /><strong>{profile.email ?? "Non renseigné"}</strong><small>Identité partagée et protégée</small></div>
          </div>
          <div className="settings-field settings-field-wide">
            <span>Identifiant de connexion</span>
            <div className="settings-readonly-value"><LockKeyhole size={17} /><strong>{profile.identifiant}</strong><small>Permanent dans votre organisation</small></div>
          </div>
        </div>
      </section>

      {showProfessional && <section className="settings-card">
        <div className="settings-card-heading">
          <span className="settings-icon settings-icon-soft"><BriefcaseBusiness size={19} /></span>
          <div>
            <h2>Profil professionnel ZeControl</h2>
            <p>Ces éléments restent propres à votre espace de temps et de présence.</p>
          </div>
        </div>
        <div className="settings-fields-grid">
          <label className="settings-field">
            <span>Poste</span>
            <div className="settings-input"><BriefcaseBusiness size={17} /><input value={poste} onChange={(event) => setPoste(event.target.value)} placeholder="Ex. Responsable terrain" maxLength={100} /></div>
          </label>
          <label className="settings-field">
            <span>Service</span>
            <div className="settings-input"><Building2 size={17} /><input value={service} onChange={(event) => setService(event.target.value)} placeholder="Ex. Opérations" maxLength={100} /></div>
          </label>
        </div>
      </section>}

      {feedback && <div className={`form-message form-${feedback.type}`} role={feedback.type === "error" ? "alert" : "status"}>{feedback.type === "success" && <Check size={16} />} {feedback.message}</div>}
      <div className="settings-actions settings-actions-sticky">
        <div><strong>Profil personnel</strong><span>Les changements seront visibles dans votre espace de travail.</span></div>
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? <><LoaderCircle className="spin" size={17} /> Enregistrement...</> : <><Save size={17} /> Enregistrer le profil</>}
        </button>
      </div>
    </form>
  );
}
