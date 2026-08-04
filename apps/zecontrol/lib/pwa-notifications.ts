const SERVICE_WORKER_READY_TIMEOUT = 5_000;

export const REMINDER_ENABLED_KEY = "zecontrol-pwa-reminders-enabled";
export const REMINDER_SNOOZE_KEY = "zecontrol-pwa-reminders-snoozed-until";

export function isPwaStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

export function isIosBrowser() {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
}

export async function getZeControlServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration("/");
    if (existing) return existing;
    if (process.env.NODE_ENV !== "production") return null;

    await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    return await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), SERVICE_WORKER_READY_TIMEOUT);
      }),
    ]);
  } catch {
    return null;
  }
}

export async function showZeControlNotification(
  title: string,
  options: NotificationOptions = {},
) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return false;
  }

  const notificationOptions: NotificationOptions = {
    icon: "/pwa/icon-192.png",
    badge: "/pwa/icon-192.png",
    ...options,
  };

  const registration = await getZeControlServiceWorkerRegistration();
  if (registration) {
    try {
      await registration.showNotification(title, notificationOptions);
      return true;
    } catch {
      // Fall back to a window notification on compatible desktop browsers.
    }
  }

  try {
    const notification = new Notification(title, notificationOptions);
    notification.onclick = () => {
      window.focus();
      const target = notificationOptions.data?.url;
      if (typeof target === "string") window.location.assign(target);
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

export function setRemindersEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(REMINDER_ENABLED_KEY, String(enabled));
    if (enabled) window.localStorage.removeItem(REMINDER_SNOOZE_KEY);
  } catch {
    // Permission can still remain valid for the current browser session.
  }
  window.dispatchEvent(
    new CustomEvent("zecontrol:reminders-changed", { detail: { enabled } }),
  );
}
