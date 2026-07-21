"use client";

import { useRef, useState } from "react";
import { Check, FileText, LoaderCircle, Send, UploadCloud, X } from "lucide-react";
import { ACCEPTED_CV_EXTENSIONS, extractCvFile, type ExtractedCvFile } from "@/lib/cv/client-extraction";

export function PublicApplicationForm({ organisation, offerSlug }: { organisation: string; offerSlug: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [document, setDocument] = useState<ExtractedCvFile | null>(null);
  const [reading, setReading] = useState(false);
  const [readingMessage, setReadingMessage] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function chooseFile(file?: File) {
    if (!file) return;
    setFileError(null); setDocument(null); setReading(true); setReadingMessage("Lecture du document…");
    try {
      const extracted = await extractCvFile(file, (progress) => setReadingMessage(progress.message));
      setDocument(extracted);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Ce document n’a pas pu être lu.");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!document || submitting) return;
    setSubmitting(true); setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/public/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisation,
          offerSlug,
          fullname: form.get("fullname"),
          email: form.get("email"),
          phone: form.get("phone"),
          coverNote: form.get("coverNote"),
          consent: form.get("consent") === "on",
          item: { clientId: crypto.randomUUID(), sourceName: document.sourceName, sourceType: document.sourceType, text: document.text },
        }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string; received?: boolean };
      if (!response.ok && !payload.received) throw new Error(payload.message || "La candidature n’a pas pu être envoyée.");
      setMessage({ kind: "success", text: payload.message || "Votre candidature a bien été envoyée." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "La candidature n’a pas pu être envoyée." });
    } finally {
      setSubmitting(false);
    }
  }

  if (message?.kind === "success") {
    return <div className="career-application-success" role="status"><span><Check size={26} /></span><h2>Candidature reçue</h2><p>{message.text} L’équipe de recrutement pourra maintenant étudier votre profil.</p></div>;
  }

  return <form className="career-application-form" onSubmit={submit}>
    <div className="career-form-heading"><span>Candidater</span><h2>Présentez votre profil</h2><p>Quelques informations suffisent. Vous pourrez vérifier le document avant de l’envoyer.</p></div>
    <div className="career-form-grid">
      <label><span>Nom complet</span><input name="fullname" autoComplete="name" required maxLength={140} /></label>
      <label><span>Email</span><input name="email" type="email" autoComplete="email" required maxLength={240} /></label>
      <label className="is-wide"><span>Téléphone <small>facultatif</small></span><input name="phone" type="tel" autoComplete="tel" maxLength={50} /></label>
      <label className="is-wide"><span>Un mot pour l’équipe <small>facultatif</small></span><textarea name="coverNote" rows={4} maxLength={5000} placeholder="Votre motivation, votre disponibilité ou une information utile…" /></label>
    </div>
    <div className={`career-file-picker${document ? " is-ready" : ""}`}>
      <input ref={inputRef} className="sr-only" id="career-cv" type="file" accept={ACCEPTED_CV_EXTENSIONS} onChange={(event) => void chooseFile(event.target.files?.[0])} />
      {reading ? <><LoaderCircle className="spin" size={24} /><div><strong>Préparation de votre CV</strong><p>{readingMessage}</p></div></> : document ? <><FileText size={24} /><div><strong>{document.sourceName}</strong><p>{document.ocrUsed ? "Document reconnu et prêt à envoyer" : "Document prêt à envoyer"}</p></div><button type="button" aria-label="Retirer le CV" onClick={() => setDocument(null)}><X size={19} /></button></> : <><UploadCloud size={25} /><div><strong>Ajouter votre CV</strong><p>PDF, image, DOCX, TXT ou MD · 10 Mo maximum</p></div><label htmlFor="career-cv">Choisir</label></>}
    </div>
    {fileError && <div className="career-form-message is-error" role="alert">{fileError}</div>}
    <label className="career-consent"><input name="consent" type="checkbox" required /><span>J’accepte que mes informations soient utilisées pour traiter cette candidature.</span></label>
    {message?.kind === "error" && <div className="career-form-message is-error" role="alert">{message.text}</div>}
    <button className="button button-primary career-submit" type="submit" disabled={!document || reading || submitting}>{submitting ? <><LoaderCircle className="spin" size={18} /> Envoi sécurisé…</> : <><Send size={18} /> Envoyer ma candidature</>}</button>
  </form>;
}
