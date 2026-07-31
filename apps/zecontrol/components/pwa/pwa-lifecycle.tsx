"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Bell, BellRing, Check, Download, RefreshCw, RotateCcw, Share, Smartphone, WifiOff, X } from "lucide-react";
import {
  currentWorkPolicyReminder,
  type EvaluatedClockingEvent,
} from "@/lib/work-policy-evaluation";
import { isWorkPolicyDefinition } from "@/lib/work-policy";
import { dateKey, zonedDayBoundary } from "@/lib/reports/period";
import { createClient } from "@/lib/supabase/client";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_SNOOZE_KEY = "zecontrol-pwa-install-snoozed-until";
const INSTALL_SNOOZE_DAYS = 30;
const REMINDER_ENABLED_KEY = "zecontrol-pwa-reminders-enabled";
const REMINDER_SNOOZE_KEY = "zecontrol-pwa-reminders-snoozed-until";
const REMINDER_SENT_PREFIX = "zecontrol-pwa-reminder-sent:";

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
}

function isInstallSnoozed() {
  try {
    return Number(window.localStorage.getItem(INSTALL_SNOOZE_KEY) ?? "0") > Date.now();
  } catch {
    return false;
  }
}

function snoozeInstall() {
  try {
    const until = Date.now() + INSTALL_SNOOZE_DAYS * 24 * 60 * 60 * 1000;
    window.localStorage.setItem(INSTALL_SNOOZE_KEY, String(until));
  } catch {
    // Storage can be unavailable in private browsing. Dismissing still works
    // for the current mounted session through React state.
  }
}

function nextDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

function reminderCategory(
  message: { title: string },
  events: EvaluatedClockingEvent[],
) {
  const last = events.at(-1);
  if (!last) {
    return /commence/i.test(message.title) ? "start-soon" : "missing-start";
  }
  if (last.type === "break") return "resume";
  if (/pause/i.test(message.title)) return "take-break";
  return "finish-day";
}

function fallbackClockingReminder(
  events: EvaluatedClockingEvent[],
  now: Date,
) {
  const last = events.at(-1);
  if (!last) return null;
  const elapsed = Math.floor(
    (now.getTime() - new Date(last.pointed_at).getTime()) / 60_000,
  );
  if (last.type === "break" && elapsed >= 60) {
    return {
      tone: "reminder" as const,
      title: `Pause en cours depuis ${elapsed} min`,
      message: "Pensez à enregistrer votre reprise lorsque vous recommencez.",
    };
  }
  if (
    (last.type === "start" || last.type === "resume") &&
    elapsed >= 10 * 60
  ) {
    return {
      tone: "reminder" as const,
      title: "Votre journée est toujours ouverte",
      message: "Si vous avez terminé, pensez à enregistrer votre départ.",
    };
  }
  return null;
}

function subscribeToConnectivity(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function subscribeToBrowserReady() {
  return () => undefined;
}

function isPhoneDevice() {
  const userAgentPhone =
    /iPhone|iPod|Windows Phone|Mobi|Android.+Mobile/i.test(
      window.navigator.userAgent,
    );
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const longSide = Math.max(window.innerWidth, window.innerHeight);
  const compactTouchPhone =
    window.navigator.maxTouchPoints > 0 &&
    shortSide <= 600 &&
    longSide <= 1_100;

  return userAgentPhone || compactTouchPhone;
}

function isPhoneInLandscape() {
  return window.innerWidth > window.innerHeight && isPhoneDevice();
}

function subscribeToPhoneOrientation(callback: () => void) {
  const media = window.matchMedia("(orientation: landscape)");
  window.addEventListener("resize", callback);
  window.addEventListener("orientationchange", callback);
  media.addEventListener?.("change", callback);
  return () => {
    window.removeEventListener("resize", callback);
    window.removeEventListener("orientationchange", callback);
    media.removeEventListener?.("change", callback);
  };
}

export function PwaLifecycle() {
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  const online = useSyncExternalStore(
    subscribeToConnectivity,
    () => window.navigator.onLine,
    () => true,
  );
  const browserReady = useSyncExternalStore(
    subscribeToBrowserReady,
    () => true,
    () => false,
  );
  const phoneInLandscape = useSyncExternalStore(
    subscribeToPhoneOrientation,
    isPhoneInLandscape,
    () => false,
  );
  const previousOnline = useRef(true);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [installEligible, setInstallEligible] = useState(false);
  const [connectionRecovered, setConnectionRecovered] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [reminderEligible, setReminderEligible] = useState(false);
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderMessage, setReminderMessage] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const installSnoozed = browserReady ? isInstallSnoozed() : true;
  const showIosInstall = browserReady &&
    installEligible &&
    !installed &&
    !installDismissed &&
    !installSnoozed &&
    isIosDevice() &&
    !isStandalone();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("portrait-phone-locked", phoneInLandscape);

    if (isPhoneDevice() && isStandalone()) {
      const orientation = window.screen.orientation as
        | (ScreenOrientation & {
            lock?: (value: "portrait-primary") => Promise<void>;
          })
        | undefined;
      void orientation?.lock?.("portrait-primary").catch(() => undefined);
    }
    return () => root.classList.remove("portrait-phone-locked");
  }, [phoneInLandscape]);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (!isStandalone() && !isInstallSnoozed()) {
        setInstallPrompt(event as InstallPromptEvent);
      }
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setInstalled(true);
      setShowIosHelp(false);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      let registration: ServiceWorkerRegistration | null = null;
      let hadController = Boolean(navigator.serviceWorker.controller);

      const checkForUpdate = () => {
        if (document.visibilityState === "visible") {
          void registration?.update().catch(() => undefined);
        }
      };
      const handleControllerChange = () => {
        if (hadController) setUpdateAvailable(true);
        hadController = true;
      };

      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
      document.addEventListener("visibilitychange", checkForUpdate);
      window.addEventListener("online", checkForUpdate);

      void navigator.serviceWorker
        .register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        })
        .then((value) => {
          registration = value;
          return value.update();
        })
        .catch(() => undefined);

      return () => {
        window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
        window.removeEventListener("appinstalled", handleInstalled);
        window.removeEventListener("online", checkForUpdate);
        document.removeEventListener("visibilitychange", checkForUpdate);
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!pathname.startsWith("/dashboard")) return;
    let visits = 1;
    try {
      visits = Number(window.localStorage.getItem("zecontrol-pwa-visits") ?? "0") + 1;
      window.localStorage.setItem("zecontrol-pwa-visits", String(Math.min(visits, 10)));
    } catch {
      // The prompt can still be offered during this session.
    }
    if (visits < 2) return;
    const timer = window.setTimeout(() => setInstallEligible(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (!browserReady || !pathname.startsWith("/dashboard")) return;
    try {
      const enabled =
        window.localStorage.getItem(REMINDER_ENABLED_KEY) === "true" &&
        "Notification" in window &&
        Notification.permission === "granted";
      const snoozedUntil = Number(
        window.localStorage.getItem(REMINDER_SNOOZE_KEY) ?? "0",
      );
      if (enabled) {
        const timer = window.setTimeout(
          () => setRemindersEnabled(true),
          0,
        );
        return () => window.clearTimeout(timer);
      }
      if (
        "Notification" in window &&
        Notification.permission === "default" &&
        snoozedUntil <= Date.now() &&
        (!isIosDevice() || isStandalone())
      ) {
        const timer = window.setTimeout(
          () => setReminderEligible(true),
          18_000,
        );
        return () => window.clearTimeout(timer);
      }
    } catch {
      // Notifications remain optional when browser storage is unavailable.
    }
  }, [browserReady, pathname]);

  useEffect(() => {
    if (
      !remindersEnabled ||
      !online ||
      !pathname.startsWith("/dashboard")
    ) {
      return;
    }

    let active = true;
    let hideTimer: number | undefined;

    async function checkReminder() {
      const { data: authData } = await supabase.auth.getUser();
      const profileId = authData.user?.id;
      if (!profileId || !active) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", profileId)
        .maybeSingle();
      if (!profile?.organisation_id || !active) return;

      const [configResult, productProfileResult] = await Promise.all([
        supabase
          .schema("zecontrol")
          .from("orga_configs")
          .select("timezone")
          .eq("id", profile.organisation_id)
          .maybeSingle(),
        supabase
          .schema("zecontrol")
          .from("profiles_configs")
          .select("role, is_active")
          .eq("id", profileId)
          .maybeSingle(),
      ]);
      if (
        productProfileResult.data?.role === "owner" ||
        productProfileResult.data?.is_active === false ||
        !active
      ) {
        return;
      }
      const config = configResult.data;
      const timeZone = config?.timezone || "Africa/Abidjan";
      const now = new Date();
      const today = dateKey(now, timeZone);

      const [eventsResult, policyResult] = await Promise.all([
        supabase
          .schema("zecontrol")
          .from("events")
          .select("type, event_status, pointed_at")
          .eq("profile_id", profileId)
          .in("event_status", ["accepted", "pending"])
          .gte(
            "pointed_at",
            zonedDayBoundary(today, timeZone).toISOString(),
          )
          .lt(
            "pointed_at",
            zonedDayBoundary(nextDay(today), timeZone).toISOString(),
          )
          .order("pointed_at", { ascending: true }),
        supabase
          .schema("zecontrol")
          .rpc("resolve_work_policy", {
            target_profile_id: profileId,
            target_work_date: today,
          }),
      ]);
      if (!active || eventsResult.error || policyResult.error) return;

      const resolved = policyResult.data as { definition?: unknown } | null;
      const events = (eventsResult.data ?? []) as EvaluatedClockingEvent[];
      const policyReminder = isWorkPolicyDefinition(resolved?.definition)
        ? currentWorkPolicyReminder({
            definition: {
              ...resolved.definition,
              daySchedules: resolved.definition.daySchedules ?? {},
            },
            events,
            now,
            timeZone,
          })
        : null;
      const message =
        policyReminder ??
        (isWorkPolicyDefinition(resolved?.definition)
          ? null
          : fallbackClockingReminder(events, now));
      if (!message) return;

      const category =
        policyReminder?.key ?? reminderCategory(message, events);
      const sentKey = `${REMINDER_SENT_PREFIX}${today}:${category}`;
      try {
        if (window.localStorage.getItem(sentKey)) return;
        window.localStorage.setItem(sentKey, now.toISOString());
      } catch {
        // The service worker tag still prevents visible duplicates.
      }

      setReminderMessage({
        title: message.title,
        message: message.message,
      });
      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setReminderMessage(null), 12_000);

      if ("serviceWorker" in navigator && Notification.permission === "granted") {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          await registration.showNotification(message.title, {
            body: message.message,
            icon: "/pwa/icon-192.png",
            badge: "/pwa/icon-192.png",
            tag: `zecontrol-${today}-${category}`,
            data: { url: "/dashboard" },
          });
        }
      }
    }

    void checkReminder();
    const interval = window.setInterval(() => void checkReminder(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkReminder();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      if (hideTimer) window.clearTimeout(hideTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [online, pathname, remindersEnabled, supabase]);

  useEffect(() => {
    let timer: number | undefined;
    if (online && !previousOnline.current) {
      setConnectionRecovered(true);
      timer = window.setTimeout(() => setConnectionRecovered(false), 3_000);
    }
    previousOnline.current = online;
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [online]);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallPrompt(null);
      setInstalled(true);
    }
  }

  function dismissInstall() {
    snoozeInstall();
    setInstallDismissed(true);
    setInstallPrompt(null);
    setShowIosHelp(false);
  }

  async function enableReminders() {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    setReminderEligible(false);
    if (permission === "granted") {
      try {
        window.localStorage.setItem(REMINDER_ENABLED_KEY, "true");
      } catch {
        // The permission remains valid for the current browser session.
      }
      setRemindersEnabled(true);
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          await registration.showNotification("Rappels activés", {
            body: "ZeControl vous rappellera l’arrivée, la pause, la reprise et le départ au bon moment.",
            icon: "/pwa/icon-192.png",
            badge: "/pwa/icon-192.png",
            tag: "zecontrol-reminders-enabled",
            data: { url: "/dashboard" },
          });
        }
      }
    }
  }

  function dismissReminders() {
    try {
      window.localStorage.setItem(
        REMINDER_SNOOZE_KEY,
        String(Date.now() + 30 * 24 * 60 * 60 * 1000),
      );
    } catch {
      // The prompt is still dismissed for the current session.
    }
    setReminderDismissed(true);
    setReminderEligible(false);
  }

  return (
    <>
      <div
        className={`portrait-orientation-guard ${phoneInLandscape ? "is-visible" : ""}`}
        role="alert"
        aria-live="assertive"
        aria-hidden={!phoneInLandscape}
      >
        <span aria-hidden="true"><Smartphone size={42} /><RotateCcw size={22} /></span>
        <strong>Tournez votre téléphone</strong>
        <small>ZeControl s’utilise en mode portrait.</small>
      </div>

      {!online && (
        <div className="pwa-connectivity-toast is-offline" role="status" aria-live="polite" aria-atomic="true">
          <WifiOff size={16} />
          <span><strong>Hors connexion</strong><small>Le pointage reste indisponible.</small></span>
        </div>
      )}

      {connectionRecovered && (
        <div className="pwa-connectivity-toast is-online" role="status" aria-live="polite" aria-atomic="true">
          <Check size={16} />
          <span><strong>Connexion rétablie</strong><small>ZeControl est de nouveau à jour.</small></span>
        </div>
      )}

      {reminderMessage && online && (
        <div className="pwa-connectivity-toast pwa-reminder-toast" role="status" aria-live="polite">
          <BellRing size={17} />
          <span>
            <strong>{reminderMessage.title}</strong>
            <small>{reminderMessage.message}</small>
          </span>
          <button type="button" aria-label="Fermer" onClick={() => setReminderMessage(null)}><X size={15} /></button>
        </div>
      )}

      {updateAvailable && online && (
        <div className="pwa-install-prompt pwa-update-prompt" role="status" aria-live="polite">
          <span className="pwa-install-icon"><RefreshCw size={18} /></span>
          <span><strong>Mise à jour prête</strong><small>Actualisez pour profiter de la dernière version.</small></span>
          <button className="pwa-install-action" type="button" onClick={() => window.location.reload()}>Actualiser</button>
          <button className="pwa-install-dismiss" type="button" aria-label="Plus tard" onClick={() => setUpdateAvailable(false)}><X size={16} /></button>
        </div>
      )}

      {installPrompt && installEligible && pathname.startsWith("/dashboard") && online && !connectionRecovered && !updateAvailable && (
        <div className="pwa-install-prompt" role="status" aria-live="polite">
          <span className="pwa-install-icon"><Download size={18} /></span>
          <span><strong>Installer ZeControl</strong><small>Ouvrez l’application depuis votre écran d’accueil.</small></span>
          <button className="pwa-install-action" type="button" onClick={() => void install()}>Installer</button>
          <button className="pwa-install-dismiss" type="button" aria-label="Plus tard" onClick={dismissInstall}><X size={16} /></button>
        </div>
      )}

      {showIosInstall && online && !connectionRecovered && !updateAvailable && (
        <div className="pwa-install-prompt pwa-ios-prompt" role="status" aria-live="polite">
          <span className="pwa-install-icon"><Share size={18} /></span>
          <span>
            <strong>Installer ZeControl</strong>
            <small>{showIosHelp ? "Touchez Partager, puis « Sur l’écran d’accueil »." : "Ajoutez l’application à votre écran d’accueil."}</small>
          </span>
          {!showIosHelp && <button className="pwa-install-action" type="button" onClick={() => setShowIosHelp(true)}>Comment ?</button>}
          <button className="pwa-install-dismiss" type="button" aria-label="Plus tard" onClick={dismissInstall}><X size={16} /></button>
        </div>
      )}

      {reminderEligible &&
        !reminderDismissed &&
        !remindersEnabled &&
        pathname.startsWith("/dashboard") &&
        online &&
        !connectionRecovered &&
        !updateAvailable &&
        !installPrompt &&
        !showIosInstall && (
          <div className="pwa-install-prompt pwa-reminder-prompt" role="status" aria-live="polite">
            <span className="pwa-install-icon"><Bell size={18} /></span>
            <span>
              <strong>Ne plus oublier de pointer</strong>
              <small>Recevez les rappels d’arrivée, de pause, de reprise et de départ au bon moment.</small>
            </span>
            <button className="pwa-install-action" type="button" onClick={() => void enableReminders()}>Activer</button>
            <button className="pwa-install-dismiss" type="button" aria-label="Plus tard" onClick={dismissReminders}><X size={16} /></button>
          </div>
        )}
    </>
  );
}
