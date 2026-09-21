import { Form, redirect, useActionData, useLoaderData } from "react-router";
import bcrypt from "bcryptjs";
import db from "../db.server";

function getToken(request) {
  const url = new URL(request.url);
  return url.searchParams.get("token") || "";
}

async function findValidUser(token) {
  if (!token) return null;

  return db.restaurantUser.findFirst({
    where: {
      activationToken: token,
      active: true,
      activationExpiry: {
        gt: new Date(),
      },
    },
    include: {
      restaurant: true,
    },
  });
}

export async function loader({ request }) {
  const token = getToken(request);
  const user = await findValidUser(token);

  if (!user) {
    return {
      valid: false,
      restaurantName: null,
      email: null,
      token: "",
    };
  }

  return {
    valid: true,
    restaurantName: user.restaurant.name,
    email: user.email,
    token,
  };
}

export async function action({ request }) {
  const formData = await request.formData();

  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  const confirmPassword = String(
    formData.get("confirmPassword") || "",
  );

  const user = await findValidUser(token);

  if (!user) {
    return {
      error:
        "This activation link is invalid or has expired. Please contact Meal Deal Hub.",
    };
  }

  if (password.length < 8) {
    return {
      error: "Your password must be at least 8 characters.",
    };
  }

  if (password !== confirmPassword) {
    return {
      error: "The passwords do not match.",
    };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await db.restaurantUser.update({
    where: {
      id: user.id,
    },
    data: {
      passwordHash,
      activated: true,
      activationToken: null,
      activationExpiry: null,
    },
  });

  throw redirect("/restaurant/login?activated=1");
}

export default function RestaurantActivate() {
  const data = useLoaderData();
  const actionData = useActionData();

  if (!data.valid) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <div style={styles.brand}>MEAL DEAL HUB</div>

          <h1 style={styles.heading}>
            Activation Link Expired
          </h1>

          <p style={styles.text}>
            This restaurant activation link is invalid or has
            expired.
          </p>

          <p style={styles.text}>
            Please contact Meal Deal Hub for a new activation
            link.
          </p>

          <a href="/restaurant/login" style={styles.linkButton}>
            RESTAURANT LOGIN
          </a>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>MEAL DEAL HUB</div>

        <h1 style={styles.heading}>
          Activate Your Account
        </h1>

        <p style={styles.text}>
          Create your password for:
        </p>

        <div style={styles.restaurantBox}>
          <strong style={styles.restaurantName}>
            {data.restaurantName}
          </strong>

          <div style={styles.email}>{data.email}</div>
        </div>

        {actionData?.error && (
          <div style={styles.error}>
            {actionData.error}
          </div>
        )}

        <Form method="post">
          <input
            type="hidden"
            name="token"
            value={data.token}
          />

          <label style={styles.label}>
            Create password
          </label>

          <input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={8}
            required
            style={styles.input}
          />

          <label style={styles.label}>
            Confirm password
          </label>

          <input
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            minLength={8}
            required
            style={styles.input}
          />

          <button type="submit" style={styles.button}>
            ACTIVATE ACCOUNT
          </button>
        </Form>

        <p style={styles.help}>
          Need help? Contact Meal Deal Hub.
        </p>
      </div>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#fff4ef",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    fontFamily: "Arial, Helvetica, sans-serif",
  },

  card: {
    width: "100%",
    maxWidth: 460,
    background: "#ffffff",
    borderRadius: 18,
    padding: 36,
    boxShadow: "0 8px 30px rgba(0,0,0,0.10)",
  },

  brand: {
    color: "#f05a28",
    fontSize: 15,
    fontWeight: 900,
    letterSpacing: 1,
    marginBottom: 8,
  },

  heading: {
    margin: "0 0 12px",
    fontSize: 30,
    color: "#171717",
  },

  text: {
    color: "#666",
    lineHeight: 1.5,
  },

  restaurantBox: {
    background: "#f7f7f7",
    borderRadius: 10,
    padding: 16,
    margin: "20px 0 24px",
  },

  restaurantName: {
    display: "block",
    fontSize: 18,
    color: "#171717",
  },

  email: {
    color: "#666",
    fontSize: 14,
    marginTop: 5,
  },

  error: {
    background: "#fff0f0",
    border: "1px solid #d72c0d",
    color: "#8e1f0b",
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
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
    padding: 15,
    border: 0,
    borderRadius: 8,
    background: "#f05a28",
    color: "#ffffff",
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer",
  },

  help: {
    textAlign: "center",
    color: "#777",
    fontSize: 14,
    marginTop: 22,
    marginBottom: 0,
  },

  linkButton: {
    display: "block",
    background: "#f05a28",
    color: "#ffffff",
    textDecoration: "none",
    textAlign: "center",
    padding: 15,
    borderRadius: 8,
    fontWeight: 800,
    marginTop: 24,
  },
};