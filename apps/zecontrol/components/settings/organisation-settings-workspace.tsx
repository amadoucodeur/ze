"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  AtSign,
  Building2,
  Check,
  Crosshair,
  Globe2,
  ImageIcon,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Save,
  Upload,
} from "lucide-react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { LocationRadiusMap } from "./location-radius-map";

type OrganisationIdentity = {
  name: string;
  email: string;
  phone: string;
  websiteUrl: string;
  description: string;
  logoUrl: string;
};

type LocationConfig = {
  lat: string;
  long: string;
  radius: string;
  timezone: string;
};

type Feedback = { type: "error" | "success"; message: string } | null;

const identitySchema = z.object({
  name: z.string().trim().min(2, "Saisissez le nom de l’organisation.").max(100),
  email: z.union([z.literal(""), z.string().trim().email("Saisissez une adresse email valide.")]),
  phone: z.string().trim().max(30, "Ce numéro est trop long."),
  websiteUrl: z.string().trim().max(2048).refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
    } catch {
      return false;
    }
  }, "Saisissez une adresse valide, par exemple entreprise.com."),
  description: z.string().trim().max(600, "La description ne doit pas dépasser 600 caractères."),
  logoUrl: z.union([z.literal(""), z.string().trim().url("Utilisez une URL complète pour le logo.")]),
});

const locationSchema = z.object({
  lat: z.coerce.number().min(-90, "Latitude invalide.").max(90, "Latitude invalide."),
  long: z.coerce.number().min(-180, "Longitude invalide.").max(180, "Longitude invalide."),
  radius: z.coerce.number().min(10, "Utilisez un rayon d’au moins 10 mètres.").max(50000, "Le rayon ne peut pas dépasser 50 km."),
  timezone: z.string().trim().min(1, "Choisissez le fuseau horaire de l’organisation."),
});

const commonTimezones = [
  "Africa/Abidjan",
  "Africa/Accra",
  "Africa/Bamako",
  "Africa/Dakar",
  "Africa/Lagos",
  "Africa/Casablanca",
  "Africa/Algiers",
  "Africa/Tunis",
  "Africa/Douala",
  "Africa/Kinshasa",
  "Africa/Nairobi",
  "Europe/Paris",
  "UTC",
];

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizedWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function displayedWebsite(value: string | null) {
  return (value ?? "").replace(/^https:\/\//i, "");
}

export function OrganisationSettingsWorkspace({
  organisationId,
  organisationIdentifier,
}: {
  organisationId: string;
  organisationIdentifier: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [locationSaving, setLocationSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [timezoneSupported, setTimezoneSupported] = useState(true);
  const [locating, setLocating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [identityFeedback, setIdentityFeedback] = useState<Feedback>(null);
  const [locationFeedback, setLocationFeedback] = useState<Feedback>(null);
  const [identity, setIdentity] = useState<OrganisationIdentity>({
    name: "",
    email: "",
    phone: "",
    websiteUrl: "",
    description: "",
    logoUrl: "",
  });
  const [location, setLocation] = useState<LocationConfig>({
    lat: "",
    long: "",
    radius: "100",
    timezone: "Africa/Abidjan",
  });

  useEffect(() => {
    let active = true;

    async function loadSettings() {
      const [identityResult, configResult] = await Promise.all([
        supabase
          .from("organisations")
          .select("name, email, phone, website_url, description, logo_url")
          .eq("id", organisationId)
          .single(),
        (async () => {
          const result = await supabase
            .schema("zecontrol")
            .from("orga_configs")
            .select("lat, long, radius, timezone")
            .eq("id", organisationId)
            .single();
          if (
            result.error &&
            /timezone|column .* does not exist/i.test(result.error.message)
          ) {
            const fallback = await supabase
              .schema("zecontrol")
              .from("orga_configs")
              .select("lat, long, radius")
              .eq("id", organisationId)
              .single();
            return { ...fallback, supportsTimezone: false };
          }
          return { ...result, supportsTimezone: true };
        })(),
      ]);

      if (!active) return;
      if (identityResult.error || configResult.error) {
        setLoadError("Les paramètres de l’organisation ne sont pas accessibles pour le moment.");
        setLoading(false);
        return;
      }

      setIdentity({
        name: identityResult.data.name ?? "",
        email: identityResult.data.email ?? "",
        phone: identityResult.data.phone ?? "",
        websiteUrl: displayedWebsite(identityResult.data.website_url),
        description: identityResult.data.description ?? "",
        logoUrl: identityResult.data.logo_url ?? "",
      });
      setLocation({
        lat: configResult.data.lat == null ? "" : String(configResult.data.lat),
        long: configResult.data.long == null ? "" : String(configResult.data.long),
        radius: configResult.data.radius == null ? "100" : String(configResult.data.radius),
        timezone: "timezone" in configResult.data && typeof configResult.data.timezone === "string"
          ? configResult.data.timezone
          : "Africa/Abidjan",
      });
      setTimezoneSupported(configResult.supportsTimezone);
      setLoading(false);
    }

    void loadSettings();
    return () => { active = false; };
  }, [organisationId, supabase]);

  async function saveIdentity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIdentityFeedback(null);
    const parsed = identitySchema.safeParse(identity);
    if (!parsed.success) {
      setIdentityFeedback({ type: "error", message: parsed.error.issues[0]?.message ?? "Vérifiez les informations saisies." });
      return;
    }

    setIdentitySaving(true);
    const { error } = await supabase
      .from("organisations")
      .update({
        name: parsed.data.name,
        email: nullable(parsed.data.email),
        phone: nullable(parsed.data.phone),
        website_url: normalizedWebsite(parsed.data.websiteUrl),
        description: nullable(parsed.data.description),
        logo_url: nullable(parsed.data.logoUrl),
        updated_at: new Date().toISOString(),
      })
      .eq("id", organisationId);
    setIdentitySaving(false);

    if (error) {
      setIdentityFeedback({ type: "error", message: "L’identité de l’organisation n’a pas pu être enregistrée." });
      return;
    }
    setIdentityFeedback({ type: "success", message: "L’identité de l’organisation a été mise à jour." });
    router.refresh();
  }

  async function saveLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocationFeedback(null);
    const parsed = locationSchema.safeParse(location);
    if (!parsed.success) {
      setLocationFeedback({ type: "error", message: parsed.error.issues[0]?.message ?? "Vérifiez la zone de pointage." });
      return;
    }

    setLocationSaving(true);
    const locationUpdate = {
      lat: parsed.data.lat,
      long: parsed.data.long,
      radius: parsed.data.radius,
      updated_at: new Date().toISOString(),
      ...(timezoneSupported ? { timezone: parsed.data.timezone } : {}),
    };
    const { error } = await supabase
      .schema("zecontrol")
      .from("orga_configs")
      .update(locationUpdate)
      .eq("id", organisationId);
    setLocationSaving(false);

    setLocationFeedback(error
      ? { type: "error", message: "La zone de pointage n’a pas pu être enregistrée." }
      : { type: "success", message: "La zone de pointage a été mise à jour." });
  }

  function useCurrentLocation() {
    setLocationFeedback(null);
    if (!navigator.geolocation) {
      setLocationFeedback({ type: "error", message: "La géolocalisation n’est pas disponible sur cet appareil." });
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (position.coords.accuracy > 150) {
          setLocating(false);
          setLocationFeedback({
            type: "error",
            message: "La position obtenue est trop imprécise pour définir un site fiable. Activez la localisation précise ou recommencez depuis un téléphone.",
          });
          return;
        }
        setLocation((current) => ({
          ...current,
          lat: position.coords.latitude.toFixed(7),
          long: position.coords.longitude.toFixed(7),
        }));
        setLocating(false);
        setLocationFeedback({ type: "success", message: "Position précise récupérée. Vérifiez le rayon puis enregistrez." });
      },
      () => {
        setLocating(false);
        setLocationFeedback({ type: "error", message: "La position n’a pas pu être récupérée. Autorisez la localisation ou saisissez les coordonnées." });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }

  async function uploadLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setIdentityFeedback(null);
    if (!["image/jpeg", "image/png", "image/webp", "image/svg+xml"].includes(file.type)) {
      setIdentityFeedback({ type: "error", message: "Choisissez une image PNG, JPG, WebP ou SVG." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setIdentityFeedback({ type: "error", message: "Le logo ne doit pas dépasser 2 Mo." });
      return;
    }
    setLogoUploading(true);
    const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const path = `${organisationId}/logo-${Date.now()}.${extension}`;
    const { error } = await supabase.storage
      .from("organisation-logos")
      .upload(path, file, { cacheControl: "3600", upsert: false });
    setLogoUploading(false);
    if (error) {
      setIdentityFeedback({ type: "error", message: "Le logo n’a pas pu être envoyé. Réessayez." });
      return;
    }
    const { data } = supabase.storage.from("organisation-logos").getPublicUrl(path);
    setIdentity((current) => ({ ...current, logoUrl: data.publicUrl }));
    setIdentityFeedback({ type: "success", message: "Logo prêt. Enregistrez l’identité pour confirmer." });
  }

  const mapPreview = useMemo(() => {
    if (!location.lat.trim() || !location.long.trim() || !location.radius.trim()) {
      return null;
    }
    const lat = Number(location.lat);
    const long = Number(location.long);
    const radius = Number(location.radius);
    if (
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(long) ||
      long < -180 ||
      long > 180 ||
      !Number.isFinite(radius) ||
      radius < 10 ||
      radius > 50_000
    ) {
      return null;
    }
    return {
      lat,
      long,
      radius,
      radiusLabel: new Intl.NumberFormat("fr-FR").format(Math.round(radius)),
    };
  }, [location.lat, location.long, location.radius]);

  if (loading) return <div className="settings-loading"><LoaderCircle className="spin" size={22} /> Chargement de l’espace de travail...</div>;
  if (loadError) return <div className="settings-error-state" role="alert"><AlertTriangle size={24} /><strong>{loadError}</strong><p>Vérifiez votre connexion puis rechargez les paramètres.</p><button className="button button-ghost" type="button" onClick={() => window.location.reload()}>Réessayer</button></div>;

  return (
    <div className="organisation-settings-workspace">
      <form className="settings-form" onSubmit={saveIdentity}>
        <section className="settings-card">
          <div className="settings-card-heading"><span className="settings-icon"><Building2 size={19} /></span><div><h2>Identité de l’organisation</h2><p>Ces informations sont partagées avec les autres produits ZeSuite.</p></div></div>
          <div className="settings-fields-grid">
            <label className="settings-field settings-field-wide"><span>Nom de l’organisation</span><div className="settings-input"><Building2 size={17} /><input value={identity.name} onChange={(event) => setIdentity({ ...identity, name: event.target.value })} required maxLength={100} /></div></label>
            <label className="settings-field"><span>Email professionnel</span><div className="settings-input"><Mail size={17} /><input type="email" value={identity.email} onChange={(event) => setIdentity({ ...identity, email: event.target.value })} /></div></label>
            <label className="settings-field"><span>Téléphone</span><div className="settings-input"><Phone size={17} /><input type="tel" value={identity.phone} onChange={(event) => setIdentity({ ...identity, phone: event.target.value })} maxLength={30} /></div></label>
            <label className="settings-field settings-field-wide"><span>Site web</span><div className="settings-input"><Globe2 size={17} /><input type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" value={identity.websiteUrl} onChange={(event) => setIdentity({ ...identity, websiteUrl: event.target.value })} placeholder="entreprise.com" /></div><small className="settings-hint">https:// sera ajouté automatiquement si nécessaire.</small></label>
            <label className="settings-field settings-field-wide"><span>Description</span><div className="settings-textarea"><Building2 size={17} /><textarea value={identity.description} onChange={(event) => setIdentity({ ...identity, description: event.target.value })} rows={4} maxLength={600} placeholder="Présentez brièvement votre organisation." /></div></label>
            <div className="settings-field settings-field-wide">
              <span>Logo de l’organisation</span>
              <div className="organisation-logo-uploader">
                <span className="organisation-logo-large">
                  {identity.logoUrl ? <Image src={identity.logoUrl} alt="" width={58} height={58} unoptimized /> : <ImageIcon size={24} />}
                </span>
                <div><strong>{identity.logoUrl ? "Logo sélectionné" : "Ajoutez votre logo"}</strong><small>PNG, JPG, WebP ou SVG · 2 Mo maximum</small></div>
                <label className="button button-ghost">
                  {logoUploading ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}
                  {logoUploading ? "Envoi..." : identity.logoUrl ? "Remplacer" : "Choisir une image"}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void uploadLogo(event)} disabled={logoUploading} />
                </label>
              </div>
            </div>
            <div className="settings-field settings-field-wide"><span>Identifiant de l’organisation</span><div className="settings-readonly-value"><AtSign size={17} /><strong>{organisationIdentifier}</strong><small>Protégé pour conserver les identifiants de connexion existants</small></div></div>
          </div>
          {identityFeedback && <div className={`form-message form-${identityFeedback.type}`} role={identityFeedback.type === "error" ? "alert" : "status"}>{identityFeedback.type === "success" && <Check size={16} />} {identityFeedback.message}</div>}
          <div className="settings-actions"><button className="button button-primary" type="submit" disabled={identitySaving}>{identitySaving ? <><LoaderCircle className="spin" size={17} /> Enregistrement...</> : <><Save size={17} /> Enregistrer l’identité</>}</button></div>
        </section>
      </form>

      <form className="settings-form" onSubmit={saveLocation}>
        <section className="settings-card">
          <div className="settings-card-heading"><span className="settings-icon settings-icon-soft"><MapPin size={19} /></span><div><h2>Zone principale de pointage</h2><p>Définissez le centre et le rayon dans lesquels un pointage sur site est accepté.</p></div></div>
          <div className="location-toolbar"><button className="button button-ghost" type="button" onClick={useCurrentLocation} disabled={locating}>{locating ? <LoaderCircle className="spin" size={17} /> : <Crosshair size={17} />} Utiliser ma position actuelle</button><p>Faites cette opération depuis le site, idéalement à l’extérieur ou près d’une fenêtre.</p></div>
          {mapPreview && (
            <div className="location-map-preview">
              <LocationRadiusMap
                latitude={mapPreview.lat}
                longitude={mapPreview.long}
                radius={mapPreview.radius}
              />
              <div className="location-map-caption" aria-live="polite">
                <MapPin size={16} />
                <span>
                  <strong>Zone autorisée · {mapPreview.radiusLabel} m</strong>
                  <small>Le cercle suit instantanément le rayon saisi.</small>
                </span>
              </div>
            </div>
          )}
          <div className="settings-fields-grid location-fields-grid">
            <label className="settings-field"><span>Latitude</span><div className="settings-input"><MapPin size={17} /><input inputMode="decimal" value={location.lat} onChange={(event) => setLocation({ ...location, lat: event.target.value })} placeholder="5.359952" required /></div></label>
            <label className="settings-field"><span>Longitude</span><div className="settings-input"><MapPin size={17} /><input inputMode="decimal" value={location.long} onChange={(event) => setLocation({ ...location, long: event.target.value })} placeholder="-4.008256" required /></div></label>
            <label className="settings-field settings-field-wide"><span>Rayon autorisé en mètres</span><div className="settings-input"><Crosshair size={17} /><input type="number" min={10} max={50000} step={1} value={location.radius} onChange={(event) => setLocation({ ...location, radius: event.target.value })} required /></div><small className="settings-hint">Commencez autour de 100 mètres, puis ajustez selon la précision GPS observée sur le site.</small></label>
            <label className="settings-field settings-field-wide"><span>Fuseau horaire de l’organisation</span><div className="settings-input"><Globe2 size={17} /><select value={location.timezone} disabled={!timezoneSupported} onChange={(event) => setLocation({ ...location, timezone: event.target.value })}>{!commonTimezones.includes(location.timezone) && <option value={location.timezone}>{location.timezone}</option>}{commonTimezones.map((timezone) => <option value={timezone} key={timezone}>{timezone.replace("_", " ")}</option>)}</select></div><small className="settings-hint">{timezoneSupported ? "Toutes les journées et les heures des rapports utiliseront cette référence." : "Le fuseau sera disponible après l’application de la dernière migration ZeControl."}</small></label>
          </div>
          {location.lat && location.long && <a className="location-preview-link" href={`https://www.google.com/maps?q=${encodeURIComponent(`${location.lat},${location.long}`)}`} target="_blank" rel="noreferrer"><MapPin size={16} /> Vérifier le centre sur la carte</a>}
          {locationFeedback && <div className={`form-message form-${locationFeedback.type}`} role={locationFeedback.type === "error" ? "alert" : "status"}>{locationFeedback.type === "success" && <Check size={16} />} {locationFeedback.message}</div>}
          <div className="settings-actions"><button className="button button-primary" type="submit" disabled={locationSaving}>{locationSaving ? <><LoaderCircle className="spin" size={17} /> Enregistrement...</> : <><Save size={17} /> Enregistrer la zone</>}</button></div>
        </section>
      </form>
    </div>
  );
}
