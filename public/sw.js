// Push notifications v1 (2026-08-10) — minimal service worker, the two
// standard Web Push handlers only. Deliberately does NOT intercept fetch/
// cache anything (no offline-app-shell behavior) — this app has no need
// for that yet, and a fetch handler here would be a much bigger surface to
// get wrong than push alone.

self.addEventListener("push", (event) => {
  let data = { title: "Blockchains.Click", body: "" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Non-JSON payload (shouldn't happen — this app always sends JSON via
    // lib/push.ts) — fall back to the default title/empty body rather than
    // letting a malformed payload crash the handler.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === new URL(url, self.location.origin).href && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
