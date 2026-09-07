"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Bell, BellOff, BellRing, Check, LoaderCircle } from "lucide-react";
import {
  isIosBrowser,
  isPwaStandalone,
  remindersEnabledFor,
  setRemindersEnabled,
  showZeControlNotification,
  subscribeToZeControlPush,
  unsubscribeFromZeControlPush,
} from "@/lib/pwa-notifications";
import { createClient } from "@/lib/supabase/client";

type NotificationState =
  | "loading"
  | "unsupported"
  | "install-required"
  | "blocked"
  | "available"
  | "enabled";

function currentState(profileId: string | null): NotificationState {
  if (!("Notification" in window)) return "unsupported";
  if (isIosBrowser() && !isPwaStandalone()) return "install-required";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "available";
  return profileId && remindersEnabledFor(profileId) ? "enabled" : "available";
}

export function NotificationSettings() {
  const [state, setState] = useState<NotificationState>("loading");
  const [pending, setPending] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [backgroundActive, setBackgroundActive] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    async function refresh() {
      if (document.visibilityState === "hidden") return;
      const { data } = await createClient().auth.getUser();
      const currentProfileId = data.user?.id ?? null;
      const registration = "serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistration("/")
        : undefined;
      const subscription = await registration?.pushManager.getSubscription();
      if (!active) return;
      setProfileId(currentProfileId);
      setBackgroundActive(Boolean(subscription));
      setState(currentState(currentProfileId));
    }
    void refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  async function activateOrTest() {
    if (!("Notification" in window)) return;
    setPending(true);
    setFeedback(null);
    try {
      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "available");
        setFeedback({
          tone: "error",
          message: "L’autorisation n’a pas été accordée.",
        });
        return;
      }

      const { data } = await createClient().auth.getUser();
      const currentProfileId = data.user?.id;
      if (!currentProfileId) throw new Error("notification_session_missing");
      const backgroundEnabled = await subscribeToZeControlPush();
      setRemindersEnabled(true, currentProfileId);
      setProfileId(currentProfileId);
      setBackgroundActive(backgroundEnabled);
      const displayed = await showZeControlNotification(
        "Les rappels ZeControl fonctionnent",
        {
          body: "Vous recevrez les rappels de pointage prévus par votre organisation.",
          tag: "zecontrol-notification-test",
          data: { url: "/dashboard/pointage" },
        },
      );
      setState("enabled");
      setFeedback({
        tone: displayed ? "success" : "error",
        message: displayed
          ? backgroundEnabled
            ? "Notification de test envoyée. Les rappels fonctionneront aussi en arrière-plan."
            : "Notification de test envoyée. Le mode arrière-plan n’est pas encore configuré."
          : "L’autorisation est active, mais ce navigateur n’a pas affiché le test.",
      });
    } catch {
      setFeedback({
        tone: "error",
        message: "L’activation n’a pas abouti. Vérifiez votre connexion et les autorisations.",
      });
      setState(currentState(profileId));
    } finally {
      setPending(false);
    }
  }

  async function disable() {
    setPending(true);
    setFeedback(null);
    try {
      const disabled = await unsubscribeFromZeControlPush();
      if (!disabled) throw new Error("push_unsubscribe_failed");
      setRemindersEnabled(false, profileId ?? undefined);
      setBackgroundActive(false);
      setState("available");
      setFeedback({
        tone: "success",
        message: "Les rappels sont désactivés sur cet appareil.",
      });
    } catch {
      setFeedback({
        tone: "error",
        message: "La désactivation n’a pas abouti. Réessayez avec une connexion active.",
      });
    } finally {
      setPending(false);
    }
  }

  const copy = {
    loading: ["Vérification…", "Lecture des autorisations du navigateur."],
    unsupported: ["Non disponible", "Ce navigateur ne prend pas en charge les notifications."],
    "install-required": ["Installation nécessaire", "Sur iPhone, installez ZeControl sur l’écran d’accueil, puis ouvrez l’application."],
    blocked: ["Notifications bloquées", "Autorisez ZeControl dans les réglages du navigateur ou du téléphone."],
    available: ["Rappels à activer", "Activez-les une fois, puis vérifiez-les avec une notification de test."],
    enabled: [
      "Rappels activés",
      backgroundActive
        ? "Ils restent disponibles même lorsque ZeControl est fermé."
        : "Ils sont actifs tant que ZeControl reste ouvert.",
    ],
  } satisfies Record<NotificationState, [string, string]>;
  const canAct = state === "available" || state === "enabled";

  return (
    <section className={`notification-settings-card is-${state}`}>
      <span className="notification-settings-icon" aria-hidden="true">
        {state === "blocked" || state === "unsupported"
          ? <BellOff size={19} />
          : state === "enabled"
            ? <BellRing size={19} />
            : <Bell size={19} />}
      </span>
      <div className="notification-settings-copy">
        <strong>{copy[state][0]}</strong>
        <p>{copy[state][1]}</p>
        {feedback && (
          <small className={`is-${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>
            {feedback.tone === "success" ? <Check size={13} /> : <AlertCircle size={13} />}
            {feedback.message}
          </small>
        )}
      </div>
      {canAct && (
        <div className="notification-settings-actions">
          <button type="button" onClick={() => void activateOrTest()} disabled={pending}>
            {pending
              ? <LoaderCircle className="spin" size={15} />
              : state === "enabled"
                ? "Tester"
                : "Activer"}
          </button>
          {state === "enabled" && (
            <button className="is-secondary" type="button" onClick={() => void disable()} disabled={pending}>
              Désactiver
            </button>
          )}
        </div>
      )}
    </section>
  );
}
