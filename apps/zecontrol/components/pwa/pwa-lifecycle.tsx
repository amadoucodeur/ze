"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Download, Share, WifiOff, X } from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
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
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [iosDismissed, setIosDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [installEligible, setInstallEligible] = useState(false);
  const showIosInstall = browserReady &&
    installEligible &&
    !installed &&
    !iosDismissed &&
    isIosDevice() &&
    !isStandalone() &&
    window.sessionStorage.getItem("zecontrol-pwa-ios-dismissed") !== "1";

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (!isStandalone() && window.sessionStorage.getItem("zecontrol-pwa-install-dismissed") !== "1") {
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
      void navigator.serviceWorker
        .register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        })
        .catch(() => undefined);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!pathname.startsWith("/dashboard")) return;
    const visits = Number(window.localStorage.getItem("zecontrol-pwa-visits") ?? "0") + 1;
    window.localStorage.setItem("zecontrol-pwa-visits", String(Math.min(visits, 10)));
    if (visits < 2) return;
    const timer = window.setTimeout(() => setInstallEligible(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }

  function dismissInstall() {
    window.sessionStorage.setItem("zecontrol-pwa-install-dismissed", "1");
    setInstallPrompt(null);
  }

  function dismissIosInstall() {
    window.sessionStorage.setItem("zecontrol-pwa-ios-dismissed", "1");
    setIosDismissed(true);
    setShowIosHelp(false);
  }

  return (
    <>
      {!online && (
        <div className="pwa-offline-banner" role="status">
          <WifiOff size={16} />
          <span><strong>Vous êtes hors connexion.</strong> Le pointage nécessite internet.</span>
        </div>
      )}

      {installPrompt && installEligible && pathname.startsWith("/dashboard") && online && (
        <div className="pwa-install-prompt" role="status">
          <span className="pwa-install-icon"><Download size={18} /></span>
          <span><strong>Installer ZeControl</strong><small>Accédez plus vite à votre pointage.</small></span>
          <button className="pwa-install-action" type="button" onClick={() => void install()}>Installer</button>
          <button className="pwa-install-dismiss" type="button" aria-label="Fermer" onClick={dismissInstall}><X size={16} /></button>
        </div>
      )}

      {showIosInstall && online && (
        <div className="pwa-install-prompt pwa-ios-prompt" role="status">
          <span className="pwa-install-icon"><Share size={18} /></span>
          <span>
            <strong>Installer ZeControl</strong>
            <small>{showIosHelp ? "Touchez Partager, puis « Sur l’écran d’accueil »." : "Ajoutez l’application à votre écran d’accueil."}</small>
          </span>
          {!showIosHelp && <button className="pwa-install-action" type="button" onClick={() => setShowIosHelp(true)}>Voir</button>}
          <button className="pwa-install-dismiss" type="button" aria-label="Fermer" onClick={dismissIosInstall}><X size={16} /></button>
        </div>
      )}
    </>
  );
}
