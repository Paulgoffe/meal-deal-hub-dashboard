import { Form, redirect, useActionData } from "react-router";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import db from "../db.server";

const COOKIE_NAME = "mdh_restaurant_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

function getSessionSecret() {
  return (
    process.env.RESTAURANT_SESSION_SECRET ||
    "development-only-change-before-production"
  );
}

function sign(value) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("hex");
}

function createSessionValue(userId) {
  const value = String(userId);
  return `${value}.${sign(value)}`;
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  return {
    next: url.searchParams.get("next") || "/restaurant/dashboard",
  };
};

export const action = async ({ request }) => {
  const formData = await request.formData();

  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();

  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return {
      error: "Please enter your email address and password.",
    };
  }

  const user = await db.restaurantUser.findUnique({
    where: { email },
    include: {
      restaurant: true,
    },
  });

  if (
    !user ||
    !user.active ||
    !user.restaurant.active
  ) {
    return {
      error: "Email or password is incorrect.",
    };
  }

  const passwordCorrect = await bcrypt.compare(
    password,
    user.passwordHash,
  );

  if (!passwordCorrect) {
    return {
      error: "Email or password is incorrect.",
    };
  }

  const sessionValue = createSessionValue(user.id);

  throw redirect("/restaurant/dashboard", {
    headers: {
      "Set-Cookie": [
        `${COOKIE_NAME}=${sessionValue}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${SESSION_MAX_AGE}`,
        process.env.NODE_ENV === "production" ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; "),
    },
  });
};

export default function RestaurantLogin() {
  const actionData = useActionData();

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#fff4ef",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "440px",
          background: "#ffffff",
          borderRadius: "18px",
          padding: "36px",
          boxShadow: "0 8px 30px rgba(0,0,0,0.10)",
        }}
      >
        <div
          style={{
            fontSize: "15px",
            fontWeight: "700",
            letterSpacing: "1px",
            color: "#f05a28",
            marginBottom: "8px",
          }}
        >
          MEAL DEAL HUB
        </div>

        <h1
          style={{
            margin: "0 0 8px",
            fontSize: "30px",
          }}
        >
          Restaurant Login
        </h1>

        <p
          style={{
            margin: "0 0 28px",
            color: "#666",
          }}
        >
          Sign in to manage your orders and payouts.
        </p>

        {actionData?.error && (
          <div
            style={{
              background: "#fff0f0",
              border: "1px solid #d72c0d",
              padding: "12px",
              borderRadius: "8px",
              marginBottom: "20px",
              color: "#8e1f0b",
            }}
          >
            {actionData.error}
          </div>
        )}

        <Form method="post">
          <label
            style={{
              display: "block",
              fontWeight: "600",
              marginBottom: "7px",
            }}
          >
            Email address
          </label>

          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "14px",
              border: "1px solid #bbb",
              borderRadius: "8px",
              fontSize: "16px",
              marginBottom: "20px",
            }}
          />

          <label
            style={{
              display: "block",
              fontWeight: "600",
              marginBottom: "7px",
            }}
          >
            Password
          </label>

          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "14px",
              border: "1px solid #bbb",
              borderRadius: "8px",
              fontSize: "16px",
              marginBottom: "24px",
            }}
          />

          <button
            type="submit"
            style={{
              width: "100%",
              padding: "15px",
              border: "0",
              borderRadius: "8px",
              background: "#f05a28",
              color: "#ffffff",
              fontSize: "16px",
              fontWeight: "700",
              cursor: "pointer",
            }}
          >
            SIGN IN
          </button>
        </Form>

        <p
          style={{
            textAlign: "center",
            color: "#777",
            fontSize: "14px",
            marginTop: "22px",
            marginBottom: "0",
          }}
        >
          Need help? Contact Meal Deal Hub.
        </p>
      </div>
    </main>
  );
}