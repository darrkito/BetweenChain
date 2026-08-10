"use client";

import { useEffect, useState } from "react";

// Push notifications v1 (2026-08-10) — see PLAN.md's "Push notifications —
// feasibility check" for the full scoping this implements. Renders nothing
// at all when VAPID isn't configured (NEXT_PUBLIC_VAPID_PUBLIC_KEY unset)
// or the browser has no Push API (Safari < 16, some in-app browsers) —
// same "don't show a control that can't work" discipline as every other
// conditionally-available feature in this app.
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

// PushManager.subscribe's applicationServerKey wants a raw Uint8Array, not
// the base64url string VAPID keys are normally handed around as — this is
// the standard conversion every Web Push tutorial uses, not app-specific.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushNotificationToggle() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const ok = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
      if (!ok) return;
      const reg = await navigator.serviceWorker.getRegistration("/sw.js").catch(() => null);
      const sub = await reg?.pushManager.getSubscription().catch(() => null);
      if (!cancelled) {
        setSupported(true);
        setSubscribed(Boolean(sub));
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!VAPID_PUBLIC_KEY || !supported) return null;

  async function subscribe() {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Notifications were blocked — enable them in your browser's site settings to turn this on.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // TS 5.9's stricter Uint8Array<ArrayBufferLike> vs BufferSource
        // typing flags this even though it's a real ArrayBuffer-backed
        // array at runtime (Uint8Array.from's output) — cast, not a
        // behavior change.
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as BufferSource,
      });
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) throw new Error("subscribe request failed");
      setSubscribed(true);
    } catch {
      setMessage("Couldn't turn on notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch {
      setMessage("Couldn't turn off notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
      <p className="text-sm font-semibold text-ink">Push notifications</p>
      <p className="text-xs text-ink-faint">
        Get a browser notification when a Trigger Order fills — no need to keep this tab open.
      </p>
      <button
        onClick={subscribed ? unsubscribe : subscribe}
        disabled={busy}
        className={`self-start rounded-full px-4 py-2 text-sm font-semibold transition-all active:scale-[0.98] ${
          subscribed
            ? "border border-hairline text-ink-muted hover:border-danger/40 hover:text-danger"
            : "bg-accent text-accent-ink hover:brightness-110"
        }`}
      >
        {busy ? "…" : subscribed ? "Turn off notifications" : "Turn on notifications"}
      </button>
      {message && <p className="text-xs text-ink-faint">{message}</p>}
    </section>
  );
}
