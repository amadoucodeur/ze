"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Check, Download, RefreshCw, Share, WifiOff, X } from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_SNOOZE_KEY = "zecontrol-pwa-install-snoozed-until";
const INSTALL_SNOOZE_DAYS = 30;

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

export function PwaLifecycle() {
  const pathname = usePathname();
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
  const previousOnline = useRef(true);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [installEligible, setInstallEligible] = useState(false);
  const [connectionRecovered, setConnectionRecovered] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const installSnoozed = browserReady ? isInstallSnoozed() : true;
  const showIosInstall = browserReady &&
    installEligible &&
    !installed &&
    !installDismissed &&
    !installSnoozed &&
    isIosDevice() &&
    !isStandalone();

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

  return (
    <>
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
    </>
  );
}
