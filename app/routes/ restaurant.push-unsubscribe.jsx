/*
=========================================================
MEAL DEAL HUB
REGISTER PHONE PUSH NOTIFICATION SUBSCRIPTION
=========================================================
*/

import { getAuthenticatedUser } from "../restaurant-auth.server";
import db from "../db.server";

export async function action({ request }) {
  if (request.method !== "POST") {
    return Response.json(
      {
        success: false,
        message: "Method not allowed.",
      },
      { status: 405 },
    );
  }

  const user = await getAuthenticatedUser(request);

  if (!user?.Restaurant?.id) {
    return Response.json(
      {
        success: false,
        message: "Please log in to your restaurant account.",
      },
      { status: 401 },
    );
  }

  const origin = request.headers.get("Origin");

  if (!origin || origin !== new URL(request.url).origin) {
    return Response.json(
      {
        success: false,
        message: "Invalid request origin.",
      },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();

    const endpoint = body?.endpoint;
    const p256dh = body?.keys?.p256dh;
    const auth = body?.keys?.auth;

    if (
      typeof endpoint !== "string" ||
      !endpoint.startsWith("https://") ||
      endpoint.length > 2048 ||
      typeof p256dh !== "string" ||
      !p256dh ||
      p256dh.length > 512 ||
      typeof auth !== "string" ||
      !auth ||
      auth.length > 512
    ) {
      return Response.json(
        {
          success: false,
          message: "Invalid notification subscription.",
        },
        { status: 400 },
      );
    }

    await db.pushSubscription.upsert({
      where: {
        endpoint,
      },
      update: {
        restaurantId: user.Restaurant.id,
        p256dh,
        auth,
      },
      create: {
        restaurantId: user.Restaurant.id,
        endpoint,
        p256dh,
        auth,
      },
    });

    return Response.json({
      success: true,
      message: "Phone notifications enabled.",
    });
  } catch (error) {
    console.error("PUSH SUBSCRIBE ERROR:", error);

    return Response.json(
      {
        success: false,
        message: "Could not enable phone notifications.",
      },
      { status: 500 },
    );
  }
}