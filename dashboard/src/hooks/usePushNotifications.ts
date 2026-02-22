// dashboard/src/hooks/usePushNotifications.ts
import { useEffect, useState } from "react";
import { useAuthStore } from "../store/useAuthStore";

export function usePushNotifications() {
  const user = useAuthStore((s) => s.user);
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    setSupported("serviceWorker" in navigator && "PushManager" in window);
  }, []);

  const subscribe = async () => {
    if (!supported || !user?.jwt) return;
    try {
      // Fetch the VAPID public key from backend
      const keyRes = await fetch("/api/chat/vapid-public-key");
      const { publicKey } = await keyRes.json();

      // Register service worker
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Request notification permission
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;

      // Subscribe
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // Save subscription to backend
      await fetch("/api/chat/push-subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.jwt}`,
        },
        body: JSON.stringify(sub.toJSON()),
      });

      setSubscribed(true);
      localStorage.setItem("push_subscribed", "1");
    } catch (err) {
      console.error("[push] subscribe error:", err);
    }
  };

  const unsubscribe = async () => {
    if (!user?.jwt) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe();

      await fetch("/api/chat/push-subscribe", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${user.jwt}` },
      });

      setSubscribed(false);
      localStorage.removeItem("push_subscribed");
    } catch (err) {
      console.error("[push] unsubscribe error:", err);
    }
  };

  // Auto-subscribe once after first message if not yet subscribed
  const autoSubscribeIfNeeded = async () => {
    if (!supported || !user || localStorage.getItem("push_subscribed")) return;
    if (Notification.permission === "default") {
      await subscribe();
    }
  };

  return { supported, subscribed, subscribe, unsubscribe, autoSubscribeIfNeeded };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
