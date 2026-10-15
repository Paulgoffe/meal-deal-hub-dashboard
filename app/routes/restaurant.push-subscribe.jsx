/*
=========================================================
MEAL DEAL HUB
REMOVE PHONE PUSH NOTIFICATION SUBSCRIPTION
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

  if (!user) {
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

    if (
      typeof endpoint !== "string" ||
      !endpoint.startsWith("https://") ||
      endpoint.length > 2048
    ) {
      return Response.json(
        {
          success: false,
          message: "Invalid notification subscription.",
        },
        { status: 400 },
      );
    }

    await db.pushSubscription.deleteMany({
      where: {
        endpoint,
        restaurantId: user.Restaurant.id,
      },
    });

    return Response.json({
      success: true,
      message: "Notifications disabled on this device.",
    });
  } catch (error) {
    console.error(
      "PUSH UNSUBSCRIBE ERROR:",
      error,
    );

    return Response.json(
      {
        success: false,
        message: "Could not disable notifications.",
      },
      { status: 500 },
    );
  }
}