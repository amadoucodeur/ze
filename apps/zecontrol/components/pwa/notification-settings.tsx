"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Check, LoaderCircle } from "lucide-react";
import {
  isIosBrowser,
  isPwaStandalone,
  REMINDER_ENABLED_KEY,
  setRemindersEnabled,
  showZeControlNotification,
} from "@/lib/pwa-notifications";

type NotificationState =
  | "loading"
  | "unsupported"
  | "install-required"
  | "blocked"
  | "available"
  | "enabled";

function currentState(): NotificationState {
  if (!("Notification" in window)) return "unsupported";
  if (isIosBrowser() && !isPwaStandalone()) return "install-required";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "available";
  try {
    return window.localStorage.getItem(REMINDER_ENABLED_KEY) === "true"
      ? "enabled"
      : "available";
  } catch {
    return "enabled";
  }
}

export function NotificationSettings() {
  const [state, setState] = useState<NotificationState>("loading");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setState(currentState()), 0);
    return () => window.clearTimeout(timer);
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
        setFeedback("L’autorisation n’a pas été accordée.");
        return;
      }

      setRemindersEnabled(true);
      const displayed = await showZeControlNotification(
        "Les rappels ZeControl fonctionnent",
        {
          body: "Vous recevrez les rappels de pointage prévus par votre organisation.",
          tag: "zecontrol-notification-test",
          data: { url: "/dashboard" },
        },
      );
      setState("enabled");
      setFeedback(
        displayed
          ? "Notification de test envoyée."
          : "L’autorisation est active, mais ce navigateur n’a pas affiché le test.",
      );
    } catch {
      setFeedback("Le test n’a pas pu être envoyé. Vérifiez les autorisations du navigateur.");
      setState(currentState());
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
    enabled: ["Rappels activés", "Les horaires configurés déterminent les rappels affichés lorsque ZeControl est ouvert."],
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
        {feedback && <small role="status"><Check size={13} />{feedback}</small>}
      </div>
      {canAct && (
        <button type="button" onClick={() => void activateOrTest()} disabled={pending}>
          {pending
            ? <LoaderCircle className="spin" size={15} />
            : state === "enabled"
              ? "Tester"
              : "Activer"}
        </button>
      )}
    </section>
  );
}
