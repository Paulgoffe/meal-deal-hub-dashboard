/*
=========================================================
MEAL DEAL HUB
SHOPIFY NEW ORDER PHONE NOTIFICATIONS
=========================================================
*/

import { authenticate } from "../shopify.server";
import db from "../db.server";
import webpush from "web-push";

/*
=========================================================
SET UP WEB PUSH
=========================================================
*/

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    console.error("Push notification VAPID settings are missing.");
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  return true;
}

/*
=========================================================
FIND RESTAURANT ID IN SHOPIFY ORDER
=========================================================
*/

function getRestaurantId(order) {
  const orderAttributes = order.note_attributes || [];

  const orderRestaurantId = orderAttributes.find(
    (attribute) => attribute.name === "_Restaurant ID"
  )?.value;

  if (orderRestaurantId) {
    return String(orderRestaurantId);
  }

  for (const item of order.line_items || []) {
    const restaurantId = (item.properties || []).find(
      (property) => property.name === "_Restaurant ID"
    )?.value;

    if (restaurantId) {
      return String(restaurantId);
    }
  }

  return null;
}

/*
=========================================================
RECEIVE NEW SHOPIFY ORDER
=========================================================
*/

export async function action({ request }) {
  const { topic, shop, payload } =
    await authenticate.webhook(request);

  if (topic !== "ORDERS_CREATE") {
    return new Response("Ignored", { status: 200 });
  }

  console.log("New Shopify order webhook received:", {
    shop,
    orderId: payload?.id,
  });

  if (!configureWebPush()) {
    return new Response("Push not configured", {
      status: 503,
    });
  }

  const restaurantExternalId = getRestaurantId(payload);

  if (!restaurantExternalId) {
    console.warn(
      "Order has no restaurant ID. No notifications sent.",
      payload?.id
    );

    return new Response("Restaurant ID missing", {
      status: 200,
    });
  }

  const restaurant = await db.restaurant.findUnique({
    where: {
      restaurantId: restaurantExternalId,
    },
  });

  if (!restaurant || !restaurant.active) {
    console.warn(
      "Restaurant not found or inactive:",
      restaurantExternalId
    );

    return new Response("Restaurant not found", {
      status: 200,
    });
  }

  const subscriptions = await db.pushSubscription.findMany({
    where: {
      restaurantId: restaurant.id,
    },
  });

  if (subscriptions.length === 0) {
    console.log(
      "No phones registered for restaurant:",
      restaurant.name
    );

    return new Response("No subscriptions", {
      status: 200,
    });
  }

  const orderNumber =
    payload?.order_number || payload?.name || "";

  const notification = JSON.stringify({
    title: "🔔 MEAL DEAL HUB — NEW ORDER!",
    body: `New order #${orderNumber} for ${restaurant.name}. Tap to respond.`,
    url: "/restaurant/dashboard",
    tag: `mdh-order-${payload.id}`,
  });

  const results = await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          notification
        );
      } catch (error) {
        if (
          error.statusCode === 404 ||
          error.statusCode === 410
        ) {
          await db.pushSubscription.delete({
            where: {
              id: subscription.id,
            },
          });
        } else {
          throw error;
        }
      }
    })
  );

  const failures = results.filter(
    (result) => result.status === "rejected"
  );

  if (failures.length > 0) {
    console.error(
      "Some push notifications failed:",
      failures
    );
  }

  console.log(
    `Push notifications processed for ${restaurant.name}: ${subscriptions.length} device(s)`
  );

  return new Response("OK", { status: 200 });
}