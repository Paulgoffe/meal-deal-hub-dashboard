/*
=========================================================
MEAL DEAL HUB
RESTAURANT AUTHENTICATION
=========================================================
*/

import crypto from "node:crypto";

import db from "./db.server";

const COOKIE_NAME = "mdh_restaurant_session";

/*
=========================================================
SESSION SECRET
=========================================================
*/

function getSessionSecret() {
  return (
    process.env.RESTAURANT_SESSION_SECRET ||
    "development-only-change-before-production"
  );
}

/*
=========================================================
SIGN SESSION
=========================================================
*/

function sign(value) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("hex");
}

/*
=========================================================
READ COOKIE
=========================================================
*/

function readCookie(request) {
  const cookieHeader = request.headers.get("Cookie") || "";

  const cookies = Object.fromEntries(
    cookieHeader
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const index = cookie.indexOf("=");

        if (index === -1) {
          return [cookie, ""];
        }

        return [
          cookie.slice(0, index),
          cookie.slice(index + 1),
        ];
      }),
  );

  return cookies[COOKIE_NAME] || null;
}

/*
=========================================================
VERIFY SESSION
=========================================================
*/

function verifySession(sessionValue) {
  if (!sessionValue) {
    return null;
  }

  const [userId, signature] = sessionValue.split(".");

  if (!userId || !signature) {
    return null;
  }

  const expectedSignature = sign(userId);

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  const parsedUserId = Number(userId);

  return Number.isInteger(parsedUserId) &&
    parsedUserId > 0
    ? parsedUserId
    : null;
}

/*
=========================================================
AUTHENTICATE RESTAURANT USER
=========================================================
*/

export async function getAuthenticatedUser(request) {
  const userId = verifySession(readCookie(request));

  if (!userId) {
    return null;
  }

  const user = await db.restaurantUser.findUnique({
    where: {
      id: userId,
    },
    include: {
      Restaurant: true,
    },
  });

  if (
    !user ||
    !user.active ||
    !user.Restaurant ||
    !user.Restaurant.active
  ) {
    return null;
  }

  return user;
}