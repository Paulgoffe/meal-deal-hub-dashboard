import {
  Form,
  redirect,
  useActionData,
} from "react-router";
import crypto from "node:crypto";
import db from "../db.server";

const ADMIN_COOKIE = "mdh_admin_session";
const ACTIVATION_DAYS = 7;

function getAdminSecret() {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    "development-admin-secret-change-before-production"
  );
}

function verifyAdminSession(request) {
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

  const session = cookies[ADMIN_COOKIE];

  if (!session) {
    return false;
  }

  const separator = session.lastIndexOf(".");

  if (separator === -1) {
    return false;
  }

  const value = session.slice(0, separator);
  const signature = session.slice(separator + 1);

  const expectedSignature = crypto
    .createHmac("sha256", getAdminSecret())
    .update(value)
    .digest("hex");

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );
  } catch {
    return false;
  }
}

export async function loader({ request }) {
  if (!verifyAdminSession(request)) {
    throw redirect("/admin/login");
  }

  return null;
}

export async function action({ request }) {
  if (!verifyAdminSession(request)) {
    throw redirect("/admin/login");
  }

  const formData = await request.formData();

  const name = String(
    formData.get("name") || "",
  ).trim();

  const restaurantId = String(
    formData.get("restaurantId") || "",
  ).trim();

  const email = String(
    formData.get("email") || "",
  )
    .trim()
    .toLowerCase();

  if (!name || !restaurantId || !email) {
    return {
      error:
        "Please enter the restaurant name, Restaurant ID and email address.",
    };
  }

  const existingRestaurant =
    await db.restaurant.findUnique({
      where: {
        restaurantId,
      },
    });

  if (existingRestaurant) {
    return {
      error: `Restaurant ID "${restaurantId}" is already in use.`,
    };
  }

  const existingUser =
    await db.restaurantUser.findUnique({
      where: {
        email,
      },
    });

  if (existingUser) {
    return {
      error:
        "That email address already has a restaurant account.",
    };
  }

  const activationToken = crypto
    .randomBytes(32)
    .toString("hex");

  const activationExpiry = new Date(
    Date.now() +
      ACTIVATION_DAYS * 24 * 60 * 60 * 1000,
  );

  const temporaryPasswordHash = crypto
    .randomBytes(48)
    .toString("hex");

  const restaurant =
    await db.restaurant.create({
      data: {
        name,
        restaurantId,
        active: true,
        acceptingOrders: true,

        users: {
          create: {
            email,
            passwordHash: temporaryPasswordHash,
            active: true,
            activated: false,
            activationToken,
            activationExpiry,
          },
        },
      },

      include: {
        users: true,
      },
    });

  const url = new URL(request.url);

  const activationLink =
    `${url.origin}/restaurant/activate?token=${activationToken}`;

  return {
    success: true,
    restaurantName: restaurant.name,
    restaurantId: restaurant.restaurantId,
    email,
    activationLink,
  };
}

export default function AdminRestaurants() {
  const actionData = useActionData();

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <div style={styles.brand}>
          MEAL DEAL HUB
        </div>

        <h1 style={styles.heading}>
          Add Restaurant
        </h1>

        <p style={styles.intro}>
          Create a Meal Deal Hub account for a restaurant
          location.
        </p>

        {actionData?.error && (
          <div style={styles.error}>
            {actionData.error}
          </div>
        )}

        {actionData?.success && (
          <div style={styles.success}>
            <div style={styles.successTitle}>
              ✓ Restaurant account created
            </div>

            <div style={styles.details}>
              <strong>
                {actionData.restaurantName}
              </strong>

              <div>
                Restaurant ID:{" "}
                {actionData.restaurantId}
              </div>

              <div>
                Email: {actionData.email}
              </div>
            </div>

            <div style={styles.linkLabel}>
              ACTIVATION LINK
            </div>

            <div style={styles.activationLink}>
              {actionData.activationLink}
            </div>

            <p style={styles.note}>
              Send this link to the restaurant. It expires
              after 7 days.
            </p>
          </div>
        )}

        <section style={styles.card}>
          <Form method="post">
            <label style={styles.label}>
              Restaurant name
            </label>

            <input
              type="text"
              name="name"
              placeholder="e.g. Peters Restaurant"
              required
              style={styles.input}
            />

            <label style={styles.label}>
              Restaurant ID
            </label>

            <input
              type="text"
              name="restaurantId"
              placeholder="e.g. PETERS 1"
              required
              style={styles.input}
            />

            <label style={styles.label}>
              Restaurant email
            </label>

            <input
              type="email"
              name="email"
              placeholder="restaurant@example.com"
              autoComplete="email"
              required
              style={styles.input}
            />

            <button
              type="submit"
              style={styles.button}
            >
              CREATE RESTAURANT ACCOUNT
            </button>
          </Form>
        </section>

        <div style={styles.security}>
          🔒 Restaurant accounts are automatically linked
          to the Restaurant ID entered above. Restaurants
          cannot select or change their Restaurant ID when
          signing in.
        </div>
      </div>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f4f4f4",
    fontFamily: "Arial, Helvetica, sans-serif",
    padding: 24,
    color: "#171717",
  },

  container: {
    width: "100%",
    maxWidth: 650,
    margin: "30px auto",
  },

  brand: {
    color: "#f05a28",
    fontSize: 15,
    fontWeight: 900,
    letterSpacing: 1,
    marginBottom: 8,
  },

  heading: {
    fontSize: 34,
    margin: "0 0 8px",
  },

  intro: {
    color: "#666",
    margin: "0 0 25px",
  },

  card: {
    background: "#ffffff",
    border: "1px solid #ddd",
    borderRadius: 16,
    padding: 28,
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
    borderRadius: 9,
    padding: 16,
    fontSize: 16,
    fontWeight: 900,
    cursor: "pointer",
  },

  error: {
    background: "#fff0f0",
    border: "1px solid #d72c0d",
    color: "#8e1f0b",
    padding: 14,
    borderRadius: 10,
    marginBottom: 20,
  },

  success: {
    background: "#ffffff",
    border: "2px solid #137333",
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
  },

  successTitle: {
    color: "#137333",
    fontSize: 19,
    fontWeight: 900,
    marginBottom: 15,
  },

  details: {
    lineHeight: 1.7,
    marginBottom: 20,
  },

  linkLabel: {
    fontSize: 12,
    fontWeight: 900,
    color: "#666",
    marginBottom: 6,
  },

  activationLink: {
    background: "#f4f4f4",
    padding: 12,
    borderRadius: 8,
    overflowWrap: "anywhere",
    fontSize: 14,
  },

  note: {
    color: "#666",
    fontSize: 13,
    marginBottom: 0,
  },

  security: {
    background: "#fff4ef",
    borderRadius: 10,
    padding: 16,
    marginTop: 18,
    fontSize: 14,
    lineHeight: 1.5,
  },
};