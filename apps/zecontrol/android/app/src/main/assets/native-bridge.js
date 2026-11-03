// Runs before the website's code, only on the ZeControl origin.
// Android WebView has no Web Push or system notifications, so the website's
// standard APIs are connected here to the native reminder engine. The website
// keeps working unchanged in browsers, where this file is not present.
(function () {
  "use strict";
  if (window.__zeNativeInstalled) return;
  window.__zeNativeInstalled = true;

  var native = window.ZeControlNative;
  // Injected by a separate script which runs after this one: always read it late.
  function permission() {
    return (window.__ZE_NATIVE_STATE || {}).notificationPermission || "default";
  }
  var ENABLED_KEY = "zecontrol-pwa-reminders-enabled";
  var permissionWaiters = [];

  function send(message) {
    try { native.postMessage(JSON.stringify(message)); } catch (error) { /* page must keep working */ }
  }

  native.onmessage = function (event) {
    var message;
    try { message = JSON.parse(event.data); } catch (error) { return; }
    if (message.type === "state") {
      window.__ZE_NATIVE_STATE = message.state;
      if (permission() !== "default") {
        permissionWaiters.splice(0).forEach(function (resolve) { resolve(permission()); });
      }
    }
  };

  function storedProfile() {
    try { return window.localStorage.getItem(ENABLED_KEY); } catch (error) { return null; }
  }

  // Notifications.
  function NativeNotification(title, options) {
    forward(title, options || {});
  }
  NativeNotification.requestPermission = function () {
    if (permission() !== "default") return Promise.resolve(permission());
    return new Promise(function (resolve) {
      permissionWaiters.push(resolve);
      send({ type: "requestNotificationPermission" });
    });
  };
  Object.defineProperty(NativeNotification, "permission", {
    get: permission,
  });
  window.Notification = NativeNotification;

  function forward(title, options) {
    // The native engine owns reminders, even with the app closed. Its copy of
    // a page-computed reminder would be a duplicate; test messages still pass.
    if (/^zecontrol-[0-9a-f-]{36}-/.test(options.tag || "")) return;
    var data = options.data || {};
    send({
      type: "notify",
      title: String(title),
      body: String(options.body || ""),
      url: typeof data.url === "string" ? data.url : "/dashboard/pointage",
    });
  }

  // Web Push is replaced by local alarms, so no server subscription is created.
  var subscription = {
    endpoint: "https://native.invalid/zecontrol",
    expirationTime: null,
    toJSON: function () { return { keys: { auth: "native-device", p256dh: "native-device-reminders" } }; },
    unsubscribe: function () { return Promise.resolve(true); },
  };
  var pushManager = {
    getSubscription: function () { return Promise.resolve(storedProfile() ? subscription : null); },
    subscribe: function () { return Promise.resolve(subscription); },
  };
  if (!("PushManager" in window)) window.PushManager = function () {};
  if (window.ServiceWorkerRegistration) {
    Object.defineProperty(window.ServiceWorkerRegistration.prototype, "pushManager", {
      configurable: true,
      get: function () { return pushManager; },
    });
    window.ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      forward(title, options || {});
      return Promise.resolve();
    };
  }

  function json(value) {
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();

    if (url.indexOf("/api/notifications/subscription") !== -1) {
      if (method === "POST") {
        send({ type: "setReminders", enabled: true });
        return Promise.resolve(json({ subscribed: true }));
      }
      if (method === "DELETE") {
        // The page also detaches on sign-out: only its owner can turn this off.
        send({ type: "setReminders", enabled: false, profile: storedProfile() });
        return Promise.resolve(json({ subscribed: false }));
      }
      return Promise.resolve(json({ publicKey: "AAAA" }));
    }

    var changesClocking = method !== "GET" && (
      url.indexOf("/rest/v1/events") !== -1 ||
      url.indexOf("/rest/v1/event_change_requests") !== -1 ||
      url.indexOf("/rpc/cancel_own_clocking_event") !== -1
    );
    var result = realFetch.apply(this, arguments);
    if (changesClocking) {
      result.then(function (response) {
        if (response.ok) send({ type: "clockingChanged" });
      }, function () {});
    }
    return result;
  };

  // Exports: WebView cannot download blob: URLs, so they are handed to Android.
  var blobs = new Map();
  var createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (value) {
    var url = createObjectURL(value);
    if (value instanceof Blob) {
      blobs.set(url, value);
      setTimeout(function () { blobs.delete(url); }, 60000);
    }
    return url;
  };

  function saveAnchor(anchor) {
    if (!anchor.download || anchor.protocol !== "blob:") return false;
    var blob = blobs.get(anchor.href);
    if (!blob) return false;
    var reader = new FileReader();
    reader.onload = function () {
      send({
        type: "saveFile",
        name: anchor.download,
        mime: blob.type,
        base64: String(reader.result).split(",")[1] || "",
      });
    };
    reader.readAsDataURL(blob);
    return true;
  }

  var anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!saveAnchor(this)) anchorClick.call(this);
  };
  var dispatchEvent = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (event) {
    if (this instanceof HTMLAnchorElement && event.type === "click" && saveAnchor(this)) return false;
    return dispatchEvent.call(this, event);
  };
})();
