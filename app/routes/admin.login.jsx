import { Form, redirect, useActionData } from "react-router";
import crypto from "node:crypto";

const COOKIE_NAME = "mdh_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function getAdminSecret() {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    "development-admin-secret-change-before-production"
  );
}

function createAdminSession() {
  const value = "meal-deal-hub-admin";

  const signature = crypto
    .createHmac("sha256", getAdminSecret())
    .update(value)
    .digest("hex");

  return `${value}.${signature}`;
}

export async function loader({ request }) {
  const cookie = request.headers.get("Cookie") || "";

  if (cookie.includes(`${COOKIE_NAME}=`)) {
    throw redirect("/admin/restaurants");
  }

  return null;
}

export async function action({ request }) {
  const formData = await request.formData();

  const password = String(
    formData.get("password") || "",
  );

  const correctPassword =
    process.env.MDH_ADMIN_PASSWORD;

  if (!correctPassword) {
    return {
      error:
        "Admin password has not been configured yet.",
    };
  }

  if (password !== correctPassword) {
    return {
      error: "Incorrect admin password.",
    };
  }

  const sessionValue = createAdminSession();

  throw redirect("/admin/restaurants", {
    headers: {
      "Set-Cookie": [
        `${COOKIE_NAME}=${sessionValue}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${SESSION_MAX_AGE}`,
        process.env.NODE_ENV === "production"
          ? "Secure"
          : "",
      ]
        .filter(Boolean)
        .join("; "),
    },
  });
}

export default function AdminLogin() {
  const actionData = useActionData();

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>
          MEAL DEAL HUB
        </div>

        <h1 style={styles.heading}>
          Admin Login
        </h1>

        <p style={styles.text}>
          Meal Deal Hub management access.
        </p>

        {actionData?.error && (
          <div style={styles.error}>
            {actionData.error}
          </div>
        )}

        <Form method="post">
          <label style={styles.label}>
            Admin password
          </label>

          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            style={styles.input}
          />

          <button
            type="submit"
            style={styles.button}
          >
            SIGN IN
          </button>
        </Form>
      </div>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#171717",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    fontFamily: "Arial, Helvetica, sans-serif",
  },

  card: {
    width: "100%",
    maxWidth: 420,
    background: "#ffffff",
    borderRadius: 18,
    padding: 36,
  },

  brand: {
    color: "#f05a28",
    fontWeight: 900,
    letterSpacing: 1,
    marginBottom: 8,
  },

  heading: {
    margin: "0 0 8px",
    fontSize: 30,
  },

  text: {
    color: "#666",
    marginBottom: 25,
  },

  label: {
    display: "block",
    fontWeight: 700,
    marginBottom: 7,
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: 14,
    border: "1px solid #bbb",
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 20,
  },

  button: {
    width: "100%",
    background: "#f05a28",
    color: "#ffffff",
    border: 0,
    borderRadius: 8,
    padding: 15,
    fontWeight: 900,
    fontSize: 16,
    cursor: "pointer",
  },

  error: {
    background: "#fff0f0",
    border: "1px solid #d72c0d",
    color: "#8e1f0b",
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
};