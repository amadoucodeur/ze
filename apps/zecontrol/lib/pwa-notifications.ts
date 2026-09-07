const SERVICE_WORKER_READY_TIMEOUT = 5_000;

export const REMINDER_ENABLED_KEY = "zecontrol-pwa-reminders-enabled";
export const REMINDER_SNOOZE_KEY = "zecontrol-pwa-reminders-snoozed-until";

type PushSubscriptionSnapshot = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
};

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

function decodeApplicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = window.atob(base64);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

function subscriptionSnapshot(
  subscription: PushSubscription,
): PushSubscriptionSnapshot | null {
  const serialized = subscription.toJSON();
  const auth = serialized.keys?.auth;
  const p256dh = serialized.keys?.p256dh;
  if (!auth || !p256dh) return null;
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: { auth, p256dh },
  };
}

export function remindersEnabledFor(profileId: string) {
  try {
    return window.localStorage.getItem(REMINDER_ENABLED_KEY) === profileId;
  } catch {
    return false;
  }
}

export async function subscribeToZeControlPush() {
  if (!("PushManager" in window)) return false;
  const registration = await getZeControlServiceWorkerRegistration();
  if (!registration) return false;

  const configurationResponse = await fetch("/api/notifications/subscription", {
    cache: "no-store",
  });
  if (!configurationResponse.ok) return false;
  const configuration = await configurationResponse.json() as {
    publicKey?: string | null;
  };
  if (!configuration.publicKey) return false;

  let subscription = await registration.pushManager.getSubscription();
  let created = false;
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(configuration.publicKey),
    });
    created = true;
  }

  const snapshot = subscriptionSnapshot(subscription);
  if (!snapshot) {
    if (created) await subscription.unsubscribe().catch(() => false);
    return false;
  }

  const response = await fetch("/api/notifications/subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });
  if (!response.ok) {
    if (created) await subscription.unsubscribe().catch(() => false);
    throw new Error("push_subscription_save_failed");
  }
  return true;
}

export async function unsubscribeFromZeControlPush() {
  if (!("serviceWorker" in navigator)) return true;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return true;
  const snapshot = subscriptionSnapshot(subscription);
  if (!snapshot) return false;

  const response = await fetch("/api/notifications/subscription", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: snapshot.endpoint,
      auth: snapshot.keys.auth,
    }),
  });
  if (!response.ok) return false;
  await subscription.unsubscribe();
  return true;
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

export function setRemindersEnabled(enabled: boolean, profileId?: string) {
  try {
    if (enabled && profileId) {
      window.localStorage.setItem(REMINDER_ENABLED_KEY, profileId);
      window.localStorage.removeItem(REMINDER_SNOOZE_KEY);
    } else {
      window.localStorage.removeItem(REMINDER_ENABLED_KEY);
    }
  } catch {
    // Permission can still remain valid for the current browser session.
  }
  window.dispatchEvent(
    new CustomEvent("zecontrol:reminders-changed", {
      detail: { enabled, profileId },
    }),
  );
}
