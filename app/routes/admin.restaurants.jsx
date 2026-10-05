import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
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
  const cookieHeader =
    request.headers.get("Cookie") || "";

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

  const session =
    cookies[ADMIN_COOKIE];

  if (!session) {
    return false;
  }

  const separator =
    session.lastIndexOf(".");

  if (separator === -1) {
    return false;
  }

  const value =
    session.slice(0, separator);

  const signature =
    session.slice(separator + 1);

  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        getAdminSecret(),
      )
      .update(value)
      .digest("hex");

  if (
    signature.length !==
    expectedSignature.length
  ) {
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

export async function loader({
  request,
}) {
  if (
    !verifyAdminSession(request)
  ) {
    throw redirect(
      "/admin/login",
    );
  }

  const restaurants =
    await db.restaurant.findMany({
      orderBy: {
        name: "asc",
      },

      include: {
        users: {
          select: {
            id: true,
            email: true,
            active: true,
            activated: true,
          },
        },

        _count: {
          select: {
            orderDecisions: true,
            payouts: true,
          },
        },
      },
    });

  return {
    restaurants,
  };
}

export async function action({
  request,
}) {
  if (
    !verifyAdminSession(request)
  ) {
    throw redirect(
      "/admin/login",
    );
  }

  const formData =
    await request.formData();

  const intent =
    String(
      formData.get("intent") ||
        "create-restaurant",
    );

  /*
  ======================================================
  ADMIN LOGOUT
  ======================================================
  */

  if (intent === "logout") {
    throw redirect("/admin/login", {
      headers: {
        "Set-Cookie": [
          `${ADMIN_COOKIE}=`,
          "Path=/",
          "HttpOnly",
          "SameSite=Lax",
          "Max-Age=0",
          process.env.NODE_ENV === "production"
            ? "Secure"
            : "",
        ]
          .filter(Boolean)
          .join("; "),
      },
    });
  }

  /*
  ======================================================
  DEACTIVATE RESTAURANT
  ======================================================
  */

  if (
    intent ===
    "deactivate-restaurant"
  ) {
    const restaurantDbId =
      Number(
        formData.get(
          "restaurantDbId",
        ),
      );

    if (
      !Number.isInteger(
        restaurantDbId,
      ) ||
      restaurantDbId <= 0
    ) {
      return {
        error:
          "Restaurant information is missing.",
      };
    }

    const restaurant =
      await db.restaurant.findUnique({
        where: {
          id: restaurantDbId,
        },
      });

    if (!restaurant) {
      return {
        error:
          "Restaurant could not be found.",
      };
    }

    await db.$transaction([
      db.restaurant.update({
        where: {
          id: restaurantDbId,
        },

        data: {
          active: false,
          acceptingOrders: false,
        },
      }),

      db.restaurantUser.updateMany({
        where: {
          restaurantId:
            restaurantDbId,
        },

        data: {
          active: false,
        },
      }),
    ]);

    return {
      managementSuccess: true,

      message:
        `${restaurant.name} has been deactivated.`,
    };
  }

  /*
  ======================================================
  REACTIVATE RESTAURANT
  ======================================================
  */

  if (
    intent ===
    "reactivate-restaurant"
  ) {
    const restaurantDbId =
      Number(
        formData.get(
          "restaurantDbId",
        ),
      );

    if (
      !Number.isInteger(
        restaurantDbId,
      ) ||
      restaurantDbId <= 0
    ) {
      return {
        error:
          "Restaurant information is missing.",
      };
    }

    const restaurant =
      await db.restaurant.findUnique({
        where: {
          id: restaurantDbId,
        },
      });

    if (!restaurant) {
      return {
        error:
          "Restaurant could not be found.",
      };
    }

    await db.$transaction([
      db.restaurant.update({
        where: {
          id: restaurantDbId,
        },

        data: {
          active: true,
          acceptingOrders: true,
        },
      }),

      db.restaurantUser.updateMany({
        where: {
          restaurantId:
            restaurantDbId,
        },

        data: {
          active: true,
        },
      }),
    ]);

    return {
      managementSuccess: true,

      message:
        `${restaurant.name} has been reactivated.`,
    };
  }

  /*
  ======================================================
  CREATE RESTAURANT
  ======================================================
  */

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

  if (
    !name ||
    !restaurantId ||
    !email
  ) {
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
      error:
        `Restaurant ID "${restaurantId}" is already in use.`,
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

  const activationToken =
    crypto
      .randomBytes(32)
      .toString("hex");

  const activationExpiry =
    new Date(
      Date.now() +
        ACTIVATION_DAYS *
          24 *
          60 *
          60 *
          1000,
    );

  const temporaryPasswordHash =
    crypto
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
            passwordHash:
              temporaryPasswordHash,
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

  const url =
    new URL(request.url);

  const activationLink =
    `${url.origin}/restaurant/activate?token=${activationToken}`;

  return {
    success: true,

    restaurantName:
      restaurant.name,

    restaurantId:
      restaurant.restaurantId,

    email,

    activationLink,
  };
}

export default function AdminRestaurants() {
  const actionData =
    useActionData();

  const loaderData =
    useLoaderData();

  const restaurants =
    loaderData?.restaurants || [];

  return (
    <main style={styles.page}>
      <div style={styles.container}>

        <div style={styles.topBar}>
          <div style={styles.brand}>
            MEAL DEAL HUB
          </div>

          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="logout"
            />

            <button
              type="submit"
              style={styles.logoutButton}
            >
              LOG OUT
            </button>
          </Form>
        </div>

        <h1 style={styles.heading}>
          Restaurant Management
        </h1>

        <p style={styles.intro}>
          Create and manage Meal Deal Hub
          restaurant accounts.
        </p>

        {actionData?.error && (
          <div style={styles.error}>
            {actionData.error}
          </div>
        )}

        {actionData?.managementSuccess && (
          <div
            style={
              styles.managementSuccess
            }
          >
            ✓ {actionData.message}
          </div>
        )}

        {actionData?.success && (
          <div style={styles.success}>
            <div
              style={
                styles.successTitle
              }
            >
              ✓ Restaurant account
              created
            </div>

            <div style={styles.details}>
              <strong>
                {
                  actionData.restaurantName
                }
              </strong>

              <div>
                Restaurant ID:{" "}
                {
                  actionData.restaurantId
                }
              </div>

              <div>
                Email:{" "}
                {actionData.email}
              </div>
            </div>

            <div
              style={
                styles.linkLabel
              }
            >
              ACTIVATION LINK
            </div>

            <div
              style={
                styles.activationLink
              }
            >
              {
                actionData.activationLink
              }
            </div>

            <p style={styles.note}>
              Send this link to the
              restaurant. It expires
              after 7 days.
            </p>
          </div>
        )}

        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>
            Add Restaurant
          </h2>

          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="create-restaurant"
            />

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

        <section
          style={
            styles.restaurantSection
          }
        >
          <div
            style={
              styles.restaurantHeader
            }
          >
            <h2
              style={
                styles.sectionTitle
              }
            >
              Existing Restaurants
            </h2>

            <p
              style={
                styles.sectionIntro
              }
            >
              {restaurants.length}{" "}
              restaurant
              {restaurants.length === 1
                ? ""
                : "s"}{" "}
              registered.
            </p>
          </div>

          {restaurants.length === 0 ? (
            <div style={styles.empty}>
              No restaurants have been
              created yet.
            </div>
          ) : (
            <div
              style={
                styles.restaurantList
              }
            >
              {restaurants.map(
                (restaurant) => {
                  const primaryUser =
                    restaurant
                      .users?.[0];

                  return (
                    <div
                      key={
                        restaurant.id
                      }
                      style={
                        restaurant.active
                          ? styles.restaurantCard
                          : {
                              ...styles.restaurantCard,
                              ...styles.restaurantCardInactive,
                            }
                      }
                    >
                      <div
                        style={
                          styles.restaurantTop
                        }
                      >
                        <div>
                          <div
                            style={
                              styles.restaurantName
                            }
                          >
                            {
                              restaurant.name
                            }
                          </div>

                          <div
                            style={
                              styles.restaurantId
                            }
                          >
                            ID:{" "}
                            {
                              restaurant.restaurantId
                            }
                          </div>
                        </div>

                        <div
                          style={
                            restaurant.active
                              ? styles.activeBadge
                              : styles.inactiveBadge
                          }
                        >
                          {restaurant.active
                            ? "ACTIVE"
                            : "DEACTIVATED"}
                        </div>
                      </div>

                      <div
                        style={
                          styles.restaurantDetails
                        }
                      >
                        <div>
                          <span
                            style={
                              styles.detailLabel
                            }
                          >
                            Email
                          </span>

                          <span>
                            {primaryUser?.email ||
                              "No email"}
                          </span>
                        </div>

                        <div>
                          <span
                            style={
                              styles.detailLabel
                            }
                          >
                            Account
                          </span>

                          <span>
                            {primaryUser?.activated
                              ? "Activated"
                              : "Not activated"}
                          </span>
                        </div>

                        <div>
                          <span
                            style={
                              styles.detailLabel
                            }
                          >
                            Orders
                          </span>

                          <span>
                            {
                              restaurant
                                ._count
                                .orderDecisions
                            }
                          </span>
                        </div>

                        <div>
                          <span
                            style={
                              styles.detailLabel
                            }
                          >
                            Accepting orders
                          </span>

                          <span>
                            {restaurant.acceptingOrders
                              ? "Yes"
                              : "No"}
                          </span>
                        </div>
                      </div>

                      <div
                        style={
                          styles.actions
                        }
                      >
                        <Form
                          method="post"
                          onSubmit={(
                            event,
                          ) => {
                            const message =
                              restaurant.active
                                ? `Deactivate ${restaurant.name}? They will no longer be able to receive orders or access their restaurant account.`
                                : `Reactivate ${restaurant.name}? Their restaurant account and ordering access will be restored.`;

                            if (
                              !window.confirm(
                                message,
                              )
                            ) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <input
                            type="hidden"
                            name="restaurantDbId"
                            value={
                              restaurant.id
                            }
                          />

                          <input
                            type="hidden"
                            name="intent"
                            value={
                              restaurant.active
                                ? "deactivate-restaurant"
                                : "reactivate-restaurant"
                            }
                          />

                          <button
                            type="submit"
                            style={
                              restaurant.active
                                ? styles.deactivateButton
                                : styles.reactivateButton
                            }
                          >
                            {restaurant.active
                              ? "DEACTIVATE RESTAURANT"
                              : "REACTIVATE RESTAURANT"}
                          </button>
                        </Form>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </section>

        <div style={styles.security}>
          🔒 Deactivating a restaurant
          does not delete its previous
          orders or payout history. The
          restaurant can be reactivated
          later.
        </div>
      </div>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f4f4f4",
    fontFamily:
      "Arial, Helvetica, sans-serif",
    padding: 24,
    color: "#171717",
  },

  container: {
    width: "100%",
    maxWidth: 760,
    margin: "30px auto",
  },

  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 20,
    marginBottom: 8,
  },

  brand: {
    color: "#f05a28",
    fontSize: 15,
    fontWeight: 900,
    letterSpacing: 1,
  },

  logoutButton: {
    background: "#171717",
    color: "#ffffff",
    border: 0,
    borderRadius: 8,
    padding: "10px 16px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  },

  heading: {
    fontSize: 34,
    margin: "0 0 8px",
  },

  intro: {
    color: "#666",
    margin: "0 0 25px",
  },

  sectionTitle: {
    fontSize: 22,
    margin: "0 0 8px",
  },

  sectionIntro: {
    color: "#666",
    fontSize: 14,
    margin: 0,
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

  restaurantSection: {
    marginTop: 28,
  },

  restaurantHeader: {
    marginBottom: 14,
  },

  restaurantList: {
    display: "grid",
    gap: 14,
  },

  restaurantCard: {
    background: "#ffffff",
    border: "1px solid #ddd",
    borderRadius: 14,
    padding: 20,
  },

  restaurantCardInactive: {
    background: "#f8f8f8",
    opacity: 0.85,
  },

  restaurantTop: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "flex-start",
    gap: 15,
    marginBottom: 18,
  },

  restaurantName: {
    fontSize: 19,
    fontWeight: 900,
    marginBottom: 5,
  },

  restaurantId: {
    color: "#666",
    fontSize: 13,
    fontWeight: 700,
  },

  activeBadge: {
    background: "#e7f6ec",
    color: "#137333",
    border:
      "1px solid #a9d9b8",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  inactiveBadge: {
    background: "#f2f2f2",
    color: "#666",
    border:
      "1px solid #ccc",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  restaurantDetails: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
    fontSize: 14,
  },

  detailLabel: {
    display: "block",
    color: "#777",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    marginBottom: 4,
  },

  actions: {
    borderTop: "1px solid #eee",
    marginTop: 20,
    paddingTop: 18,
  },

  deactivateButton: {
    width: "100%",
    background: "#ffffff",
    color: "#b42318",
    border:
      "2px solid #b42318",
    borderRadius: 9,
    padding: 13,
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
  },

  reactivateButton: {
    width: "100%",
    background: "#137333",
    color: "#ffffff",
    border:
      "2px solid #137333",
    borderRadius: 9,
    padding: 13,
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
  },

  empty: {
    background: "#ffffff",
    border: "1px solid #ddd",
    borderRadius: 14,
    padding: 24,
    color: "#666",
    textAlign: "center",
  },

  error: {
    background: "#fff0f0",
    border:
      "1px solid #d72c0d",
    color: "#8e1f0b",
    padding: 14,
    borderRadius: 10,
    marginBottom: 20,
  },

  success: {
    background: "#ffffff",
    border:
      "2px solid #137333",
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
  },

  managementSuccess: {
    background: "#e7f6ec",
    border:
      "1px solid #a9d9b8",
    color: "#137333",
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
    fontWeight: 700,
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