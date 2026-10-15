import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat(
    (4 - (base64String.length % 4)) % 4
  );

  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);

  return Uint8Array.from(rawData, (character) =>
    character.charCodeAt(0)
  );
}

export default function PhoneNotifications() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const supported =
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  useEffect(() => {
    if (!supported) return;

    async function checkSubscription() {
      try {
        const registration =
          await navigator.serviceWorker.register("/sw.js");

        const subscription =
          await registration.pushManager.getSubscription();

        setEnabled(Boolean(subscription));
      } catch (error) {
        console.error("Notification check failed:", error);
      }
    }

    checkSubscription();
  }, [supported]);

  async function enableNotifications() {
    setLoading(true);
    setMessage("");

    try {
      if (!supported) {
        throw new Error(
          "Push notifications are not supported in this browser."
        );
      }

      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        throw new Error(
          "Notification permission was not granted."
        );
      }

      const registration =
        await navigator.serviceWorker.ready;

      const response = await fetch("/restaurant/push-key", {
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error("Notification settings unavailable.");
      }

      const { publicKey } = await response.json();

      if (!publicKey) {
        throw new Error("Notification public key is missing.");
      }

      let subscription =
        await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey:
            urlBase64ToUint8Array(publicKey),
        });
      }

      const saveResponse = await fetch(
        "/restaurant/push-subscribe",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(subscription.toJSON()),
        }
      );

      if (!saveResponse.ok) {
        throw new Error(
          "Could not save notification registration."
        );
      }

      setEnabled(true);
      setMessage("Phone notifications enabled.");
    } catch (error) {
      setMessage(error.message || "Could not enable notifications.");
    } finally {
      setLoading(false);
    }
  }

  async function disableNotifications() {
    setLoading(true);
    setMessage("");

    try {
      const registration =
        await navigator.serviceWorker.ready;

      const subscription =
        await registration.pushManager.getSubscription();

      if (subscription) {
        const response = await fetch(
          "/restaurant/push-unsubscribe",
          {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              endpoint: subscription.endpoint,
            }),
          }
        );

        if (!response.ok) {
          throw new Error(
            "Could not remove notification registration."
          );
        }

        await subscription.unsubscribe();
      }

      setEnabled(false);
      setMessage("Phone notifications disabled.");
    } catch (error) {
      setMessage(error.message || "Could not disable notifications.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ flex: "1 1 150px" }}>
      <button
        type="button"
        disabled={loading || !supported}
        onClick={
          enabled
            ? disableNotifications
            : enableNotifications
        }
        style={{
          width: "100%",
          minHeight: 52,
          padding: "13px 14px",
          background: enabled ? "#111111" : "#FFD400",
          color: enabled ? "#FFD400" : "#111111",
          border: "1px solid #111111",
          borderRadius: 13,
          fontWeight: 900,
          fontSize: 12,
          cursor: loading ? "wait" : "pointer",
        }}
      >
        {loading
          ? "PLEASE WAIT..."
          : enabled
            ? "🔔 PHONE ALERTS ON"
            : "🔔 ENABLE PHONE ALERTS"}
      </button>

      {!supported && (
        <p style={{ fontSize: 11, color: "#777777" }}>
          Phone alerts are unavailable in this browser.
          On iPhone, add the dashboard to your Home Screen
          and open it from there.
        </p>
      )}

      {message && (
        <p
          role="status"
          style={{
            fontSize: 11,
            color: "#333333",
            marginTop: 8,
          }}
        >
          {message}
        </p>
      )}
    </div>
  );
}