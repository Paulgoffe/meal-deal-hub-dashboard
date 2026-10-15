/*
=========================================================
MEAL DEAL HUB
PUSH NOTIFICATION SERVICE WORKER
=========================================================
*/

self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    console.error("Push notification error:", error);
  }

  const title = data.title || "🔔 Meal Deal Hub - New Order!";

  const options = {
    body: data.body || "A new order is waiting for your response.",
    icon: "/meal-deal-hub-logo.png",
    badge: "/meal-deal-hub-logo.png",
    tag: data.tag || "mdh-new-order",
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 150, 300, 150, 500],
    data: {
      url: data.url || "/restaurant/dashboard",
    },
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/*
=========================================================
OPEN DASHBOARD WHEN NOTIFICATION IS TAPPED
=========================================================
*/

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    event.notification.data?.url ||
    "/restaurant/dashboard";

  const url = new URL(targetUrl, self.location.origin);

  if (url.origin !== self.location.origin) {
    return;
  }

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    }).then(async (windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(url.origin)) {
          await client.focus();
          await client.navigate(url.href);
          return;
        }
      }

      return clients.openWindow(url.href);
    })
  );
});