import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useEffect, useState } from "react";
import crypto from "node:crypto";
import db from "../db.server";

const ADMIN_COOKIE = "mdh_admin_session";
const ACTIVATION_DAYS = 7;

const BLACK = "#111111";
const YELLOW = "#FFD400";
const WHITE = "#FFFFFF";
const GREY = "#666666";

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

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

        if (index === -1) return [cookie, ""];

        return [
          cookie.slice(0, index),
          cookie.slice(index + 1),
        ];
      }),
  );

  const session = cookies[ADMIN_COOKIE];

  if (!session) return false;

  const separator = session.lastIndexOf(".");

  if (separator === -1) return false;

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

// ======================================================
// LOADER
// ======================================================

export async function loader({ request }) {
  if (!verifyAdminSession(request)) {
    throw redirect("/admin/login");
  }

  const restaurants = await db.restaurant.findMany({
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
        orderBy: {
          id: "asc",
        },
      },

      payouts: {
        orderBy: {
          weekStart: "desc",
        },
        take: 52,
        select: {
          id: true,
          weekStart: true,
          weekEnd: true,
          payoutDate: true,
          foodSales: true,
          deliveryIncome: true,
          commission: true,
          serviceFees: true,
          restaurantEarnings: true,
          acceptedOrderCount: true,
          status: true,
          updatedAt: true,
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

  const allPayouts = await db.restaurantPayout.findMany({
    select: {
      restaurantEarnings: true,
      status: true,
    },
  });

  const outstandingTotal = allPayouts
    .filter(
      (payout) =>
        payout.status !== "paid" &&
        payout.status !== "completed",
    )
    .reduce(
      (total, payout) =>
        total + Number(payout.restaurantEarnings),
      0,
    );

  const paidTotal = allPayouts
    .filter(
      (payout) =>
        payout.status === "paid" ||
        payout.status === "completed",
    )
    .reduce(
      (total, payout) =>
        total + Number(payout.restaurantEarnings),
      0,
    );

  return {
    restaurants,
    outstandingTotal,
    paidTotal,
    payoutCount: allPayouts.length,
  };
}

// ======================================================
// ACTION
// ======================================================

export async function action({ request }) {
  if (!verifyAdminSession(request)) {
    throw redirect("/admin/login");
  }

  const formData = await request.formData();

  const intent = String(
    formData.get("intent") || "create-restaurant",
  );

  // ====================================================
  // LOG OUT
  // ====================================================

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

  // ====================================================
  // MARK PAYOUT AS PAID
  // ====================================================

  if (intent === "mark-payout-paid") {
    const payoutId = Number(formData.get("payoutId"));

    if (!Number.isInteger(payoutId) || payoutId <= 0) {
      return {
        error: "Invalid payout information.",
      };
    }

    const payout = await db.restaurantPayout.findUnique({
      where: {
        id: payoutId,
      },
      include: {
        restaurant: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!payout) {
      return {
        error: "Payout could not be found.",
      };
    }

    if (
      payout.status === "paid" ||
      payout.status === "completed"
    ) {
      return {
        error: "This payout has already been marked as paid.",
      };
    }

    try {
      const updated = await db.restaurantPayout.updateMany({
        where: {
          id: payoutId,
          status: payout.status,
        },
        data: {
          status: "paid",
          payoutDate: new Date(),
        },
      });

      if (updated.count !== 1) {
        return {
          error:
            "This payout has already changed. Please refresh the page.",
        };
      }

      return {
        managementSuccess: true,
        message:
          `${money(payout.restaurantEarnings)} has been marked as paid ` +
          `for ${payout.restaurant.name}.`,
      };
    } catch (error) {
      console.error("MARK PAYOUT PAID FAILED:", error);

      return {
        error:
          "The payout could not be updated. Please try again.",
      };
    }
  }

  // ====================================================
  // EDIT RESTAURANT
  // ====================================================

  if (intent === "edit-restaurant") {
    const restaurantDbId = Number(
      formData.get("restaurantDbId"),
    );

    const restaurantUserId = Number(
      formData.get("restaurantUserId"),
    );

    const name = String(
      formData.get("name") || "",
    ).trim();

    const email = String(
      formData.get("email") || "",
    )
      .trim()
      .toLowerCase();

    if (
      !Number.isInteger(restaurantDbId) ||
      restaurantDbId <= 0 ||
      !Number.isInteger(restaurantUserId) ||
      restaurantUserId <= 0
    ) {
      return {
        error: "Restaurant information is missing.",
      };
    }

    if (!name || !email) {
      return {
        error:
          "Please enter the restaurant name and email address.",
      };
    }

    if (name.length > 150) {
      return {
        error:
          "Restaurant name must be 150 characters or fewer.",
      };
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return {
        error: "Please enter a valid email address.",
      };
    }

    const restaurant = await db.restaurant.findUnique({
      where: {
        id: restaurantDbId,
      },
      include: {
        users: {
          where: {
            id: restaurantUserId,
          },
          select: {
            id: true,
            email: true,
            activated: true,
          },
        },
      },
    });

    if (!restaurant) {
      return {
        error: "Restaurant could not be found.",
      };
    }

    const restaurantUser = restaurant.users[0];

    if (!restaurantUser) {
      return {
        error: "Restaurant account could not be found.",
      };
    }

    const existingUser =
      await db.restaurantUser.findUnique({
        where: {
          email,
        },
      });

    if (
      existingUser &&
      existingUser.id !== restaurantUserId
    ) {
      return {
        error:
          "That email address is already being used by another restaurant account.",
      };
    }

    try {
      await db.$transaction([
        db.restaurant.update({
          where: {
            id: restaurantDbId,
          },
          data: {
            name,
          },
        }),

        db.restaurantUser.update({
          where: {
            id: restaurantUserId,
          },
          data: {
            email,
          },
        }),
      ]);

      return {
        managementSuccess: true,
        message: `${name}'s details have been updated successfully.`,
        editedRestaurantId: restaurantDbId,
      };
    } catch (error) {
      console.error("EDIT RESTAURANT FAILED:", error);

      return {
        error:
          "Restaurant details could not be saved. Please check that the email address is not already in use.",
      };
    }
  }

  // ====================================================
  // DEACTIVATE RESTAURANT
  // ====================================================

  if (intent === "deactivate-restaurant") {
    const restaurantDbId = Number(
      formData.get("restaurantDbId"),
    );

    if (
      !Number.isInteger(restaurantDbId) ||
      restaurantDbId <= 0
    ) {
      return {
        error: "Restaurant information is missing.",
      };
    }

    const restaurant = await db.restaurant.findUnique({
      where: {
        id: restaurantDbId,
      },
    });

    if (!restaurant) {
      return {
        error: "Restaurant could not be found.",
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
          restaurantId: restaurantDbId,
        },
        data: {
          active: false,
        },
      }),
    ]);

    return {
      managementSuccess: true,
      message: `${restaurant.name} has been deactivated.`,
    };
  }

  // ====================================================
  // REACTIVATE RESTAURANT
  // ====================================================

  if (intent === "reactivate-restaurant") {
    const restaurantDbId = Number(
      formData.get("restaurantDbId"),
    );

    if (
      !Number.isInteger(restaurantDbId) ||
      restaurantDbId <= 0
    ) {
      return {
        error: "Restaurant information is missing.",
      };
    }

    const restaurant = await db.restaurant.findUnique({
      where: {
        id: restaurantDbId,
      },
    });

    if (!restaurant) {
      return {
        error: "Restaurant could not be found.",
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
          restaurantId: restaurantDbId,
        },
        data: {
          active: true,
        },
      }),
    ]);

    return {
      managementSuccess: true,
      message: `${restaurant.name} has been reactivated.`,
    };
  }

  // ====================================================
  // CREATE RESTAURANT
  // ====================================================

  if (intent !== "create-restaurant") {
    return {
      error: "Unknown action.",
    };
  }

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

  const restaurant = await db.restaurant.create({
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

// ======================================================
// COMPONENT
// ======================================================

export default function AdminRestaurants() {
  const actionData = useActionData();
  const loaderData = useLoaderData();
  const navigation = useNavigation();

  const restaurants = loaderData?.restaurants || [];

  const [editingRestaurantId, setEditingRestaurantId] =
    useState(null);

  const [expandedPayoutRestaurantId, setExpandedPayoutRestaurantId] =
    useState(null);

  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (
      actionData?.managementSuccess &&
      actionData?.editedRestaurantId
    ) {
      setEditingRestaurantId(null);
    }
  }, [actionData]);

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        {/* HEADER */}

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

        <div style={styles.headingSection}>
          <h1 style={styles.heading}>
            Restaurant Management
          </h1>

          <p style={styles.intro}>
            Create and manage restaurant accounts,
            weekly payouts and bank transfers.
          </p>
        </div>

        {actionData?.error && (
          <div style={styles.error}>
            {actionData.error}
          </div>
        )}

        {actionData?.managementSuccess && (
          <div style={styles.managementSuccess}>
            ✓ {actionData.message}
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
              Send this link to the restaurant.
              It expires after 7 days.
            </p>
          </div>
        )}

        {/* PAYOUT SUMMARY */}

        <section style={styles.summaryGrid}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>
              OUTSTANDING PAYOUTS
            </div>

            <div style={styles.summaryValue}>
              {money(loaderData?.outstandingTotal)}
            </div>
          </div>

          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>
              TOTAL MARKED PAID
            </div>

            <div style={styles.summaryValue}>
              {money(loaderData?.paidTotal)}
            </div>
          </div>

          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>
              PAYOUT RECORDS
            </div>

            <div style={styles.summaryValue}>
              {loaderData?.payoutCount || 0}
            </div>
          </div>
        </section>

        {/* ADD RESTAURANT */}

        <section style={styles.card}>
          <div style={styles.sectionTitleBar}>
            <h2 style={styles.sectionTitle}>
              Add Restaurant
            </h2>
          </div>

          <div style={styles.cardContent}>
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
                disabled={isSubmitting}
              >
                CREATE RESTAURANT ACCOUNT
              </button>
            </Form>
          </div>
        </section>

        {/* EXISTING RESTAURANTS */}

        <section style={styles.restaurantSection}>
          <div style={styles.restaurantHeader}>
            <h2 style={styles.sectionTitle}>
              Existing Restaurants
            </h2>

            <p style={styles.sectionIntro}>
              {restaurants.length} restaurant
              {restaurants.length === 1 ? "" : "s"}{" "}
              registered.
            </p>
          </div>

          {restaurants.length === 0 ? (
            <div style={styles.empty}>
              No restaurants have been created yet.
            </div>
          ) : (
            <div style={styles.restaurantList}>
              {restaurants.map((restaurant) => {
                const primaryUser = restaurant.users?.[0];

                const canEdit = Boolean(primaryUser);

                const isEditing =
                  editingRestaurantId === restaurant.id;

                const showPayouts =
                  expandedPayoutRestaurantId ===
                  restaurant.id;

                const payouts = restaurant.payouts || [];

                const unpaidPayouts = payouts.filter(
                  (payout) =>
                    payout.status !== "paid" &&
                    payout.status !== "completed",
                );

                const paidPayouts = payouts.filter(
                  (payout) =>
                    payout.status === "paid" ||
                    payout.status === "completed",
                );

                const unpaidAmount = unpaidPayouts.reduce(
                  (total, payout) =>
                    total + Number(payout.restaurantEarnings),
                  0,
                );

                return (
                  <div
                    key={restaurant.id}
                    style={
                      restaurant.active
                        ? styles.restaurantCard
                        : {
                            ...styles.restaurantCard,
                            ...styles.restaurantCardInactive,
                          }
                    }
                  >
                    <div style={styles.restaurantTop}>
                      <div>
                        <div style={styles.restaurantName}>
                          {restaurant.name}
                        </div>

                        <div style={styles.restaurantId}>
                          ID: {restaurant.restaurantId}
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

                    <div style={styles.restaurantDetails}>
                      <div>
                        <span style={styles.detailLabel}>
                          Email
                        </span>
                        <span>
                          {primaryUser?.email || "No email"}
                        </span>
                      </div>

                      <div>
                        <span style={styles.detailLabel}>
                          Account
                        </span>
                        <span>
                          {primaryUser?.activated
                            ? "Activated"
                            : "Not activated"}
                        </span>
                      </div>

                      <div>
                        <span style={styles.detailLabel}>
                          Orders
                        </span>
                        <span>
                          {restaurant._count.orderDecisions}
                        </span>
                      </div>

                      <div>
                        <span style={styles.detailLabel}>
                          Accepting orders
                        </span>
                        <span>
                          {restaurant.acceptingOrders
                            ? "Yes"
                            : "No"}
                        </span>
                      </div>
                    </div>

                    {/* PAYOUT MANAGEMENT */}

                    <div style={styles.payoutSection}>
                      <div style={styles.payoutHeadingRow}>
                        <div>
                          <div style={styles.payoutHeading}>
                            Weekly Payouts
                          </div>

                          <div style={styles.payoutSubtext}>
                            Manual bank transfer management
                          </div>
                        </div>

                        <div style={styles.payoutOutstanding}>
                          {money(unpaidAmount)} outstanding
                        </div>
                      </div>

                      <div style={styles.payoutStats}>
                        <div>
                          <strong>{unpaidPayouts.length}</strong>
                          <span> Awaiting payment</span>
                        </div>

                        <div>
                          <strong>{paidPayouts.length}</strong>
                          <span> Paid</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        style={styles.viewPayoutsButton}
                        onClick={() =>
                          setExpandedPayoutRestaurantId(
                            showPayouts
                              ? null
                              : restaurant.id,
                          )
                        }
                      >
                        {showPayouts
                          ? "HIDE PAYOUTS"
                          : "VIEW PAYOUTS"}
                      </button>

                      {showPayouts && (
                        <div style={styles.payoutList}>
                          {payouts.length === 0 ? (
                            <div style={styles.noPayouts}>
                              No payout records yet.
                              Weekly payouts will appear
                              here once they have been
                              created in the database.
                            </div>
                          ) : (
                            payouts.map((payout) => {
                              const isPaid =
                                payout.status === "paid" ||
                                payout.status === "completed";

                              return (
                                <div
                                  key={payout.id}
                                  style={styles.payoutItem}
                                >
                                  <div style={styles.payoutItemTop}>
                                    <div>
                                      <strong>
                                        {formatDate(
                                          payout.weekStart,
                                        )}
                                        {" – "}
                                        {formatDate(
                                          payout.weekEnd,
                                        )}
                                      </strong>

                                      <div style={styles.payoutSmall}>
                                        {payout.acceptedOrderCount}{" "}
                                        accepted orders
                                      </div>
                                    </div>

                                    <span
                                      style={
                                        isPaid
                                          ? styles.paidBadge
                                          : styles.expectedBadge
                                      }
                                    >
                                      {isPaid
                                        ? "PAID"
                                        : "AWAITING PAYMENT"}
                                    </span>
                                  </div>

                                  <div style={styles.payoutBreakdown}>
                                    <div>
                                      <span>Food sales</span>
                                      <strong>
                                        {money(payout.foodSales)}
                                      </strong>
                                    </div>

                                    <div>
                                      <span>Delivery income</span>
                                      <strong>
                                        {money(
                                          payout.deliveryIncome,
                                        )}
                                      </strong>
                                    </div>

                                    <div>
                                      <span>Commission</span>
                                      <strong>
                                        {money(
                                          payout.commission,
                                        )}
                                      </strong>
                                    </div>

                                    <div style={styles.payoutTotalRow}>
                                      <span>Restaurant receives</span>
                                      <strong>
                                        {money(
                                          payout.restaurantEarnings,
                                        )}
                                      </strong>
                                    </div>
                                  </div>

                                  {isPaid ? (
                                    <div style={styles.paidConfirmation}>
                                      ✓ Paid on{" "}
                                      {formatDate(
                                        payout.payoutDate,
                                      )}
                                    </div>
                                  ) : (
                                    <>
                                      <div style={styles.expectedDate}>
                                        Expected payout:{" "}
                                        <strong>
                                          {formatDate(
                                            payout.payoutDate,
                                          )}
                                        </strong>
                                      </div>

                                      <Form
                                        method="post"
                                        onSubmit={(event) => {
                                          const confirmed =
                                            window.confirm(
                                              `Have you already transferred ${money(
                                                payout.restaurantEarnings,
                                              )} to ${restaurant.name}?\n\nOnly click OK after the bank transfer has been completed.`,
                                            );

                                          if (!confirmed) {
                                            event.preventDefault();
                                          }
                                        }}
                                      >
                                        <input
                                          type="hidden"
                                          name="intent"
                                          value="mark-payout-paid"
                                        />

                                        <input
                                          type="hidden"
                                          name="payoutId"
                                          value={payout.id}
                                        />

                                        <button
                                          type="submit"
                                          style={styles.markPaidButton}
                                          disabled={isSubmitting}
                                        >
                                          ✓ MARK AS PAID
                                        </button>
                                      </Form>
                                    </>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>

                    {/* EDIT DETAILS */}

                    {canEdit && (
                      <div style={styles.editAction}>
                        <button
                          type="button"
                          style={styles.editButton}
                          onClick={() =>
                            setEditingRestaurantId(
                              isEditing
                                ? null
                                : restaurant.id,
                            )
                          }
                        >
                          {isEditing
                            ? "CANCEL EDIT"
                            : "EDIT DETAILS"}
                        </button>
                      </div>
                    )}

                    {canEdit && isEditing && (
                      <div style={styles.editPanel}>
                        <h3 style={styles.editHeading}>
                          Edit Restaurant Details
                        </h3>

                        <p style={styles.editDescription}>
                          Update this restaurant's name
                          and login email.
                        </p>

                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="edit-restaurant"
                          />

                          <input
                            type="hidden"
                            name="restaurantDbId"
                            value={restaurant.id}
                          />

                          <input
                            type="hidden"
                            name="restaurantUserId"
                            value={primaryUser.id}
                          />

                          <label style={styles.label}>
                            Restaurant name
                          </label>

                          <input
                            type="text"
                            name="name"
                            defaultValue={restaurant.name}
                            maxLength={150}
                            required
                            style={styles.input}
                          />

                          <label style={styles.label}>
                            Restaurant email
                          </label>

                          <input
                            type="email"
                            name="email"
                            defaultValue={primaryUser.email}
                            autoComplete="email"
                            maxLength={254}
                            required
                            style={styles.input}
                          />

                          <label style={styles.label}>
                            Restaurant ID
                          </label>

                          <input
                            type="text"
                            value={restaurant.restaurantId}
                            disabled
                            readOnly
                            style={styles.readOnlyInput}
                          />

                          <p style={styles.editNote}>
                            The Restaurant ID cannot be changed.
                          </p>

                          <button
                            type="submit"
                            style={styles.saveButton}
                            disabled={isSubmitting}
                          >
                            SAVE RESTAURANT DETAILS
                          </button>
                        </Form>
                      </div>
                    )}

                    {/* ACTIVATE / DEACTIVATE */}

                    <div style={styles.actions}>
                      <Form
                        method="post"
                        onSubmit={(event) => {
                          const message = restaurant.active
                            ? `Deactivate ${restaurant.name}? They will no longer be able to receive orders or access their restaurant account.`
                            : `Reactivate ${restaurant.name}? Their restaurant account and ordering access will be restored.`;

                          if (!window.confirm(message)) {
                            event.preventDefault();
                          }
                        }}
                      >
                        <input
                          type="hidden"
                          name="restaurantDbId"
                          value={restaurant.id}
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
                          disabled={isSubmitting}
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
              })}
            </div>
          )}
        </section>

        <div style={styles.security}>
          🔒 Mark a payout as paid only after
          completing the bank transfer.
          Deactivating a restaurant does not
          delete its previous orders or payout history.
        </div>
      </div>
    </main>
  );
}

// ======================================================
// STYLES
// ======================================================

const styles = {
  page: {
    minHeight: "100vh",
    background: "#F5F5F5",
    fontFamily: "Arial, Helvetica, sans-serif",
    padding: 24,
    color: BLACK,
  },

  container: {
    width: "100%",
    maxWidth: 900,
    margin: "30px auto",
  },

  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 20,
    marginBottom: 20,
    background: BLACK,
    borderRadius: 14,
    padding: "20px 24px",
  },

  brand: {
    color: YELLOW,
    fontSize: 22,
    fontWeight: 900,
    letterSpacing: 1.5,
  },

  logoutButton: {
    background: YELLOW,
    color: BLACK,
    border: 0,
    borderRadius: 8,
    padding: "11px 18px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  },

  headingSection: {
    marginBottom: 25,
  },

  heading: {
    fontSize: 34,
    margin: "0 0 8px",
    fontWeight: 900,
  },

  intro: {
    color: GREY,
    margin: 0,
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
    marginBottom: 24,
  },

  summaryCard: {
    background: WHITE,
    border: "1px solid #DDDDDD",
    borderTop: `5px solid ${YELLOW}`,
    borderRadius: 12,
    padding: 20,
  },

  summaryLabel: {
    color: GREY,
    fontSize: 12,
    fontWeight: 900,
    marginBottom: 10,
  },

  summaryValue: {
    fontSize: 27,
    fontWeight: 900,
    overflowWrap: "anywhere",
  },

  sectionTitle: {
    fontSize: 22,
    margin: "0 0 8px",
    fontWeight: 900,
  },

  sectionIntro: {
    color: GREY,
    fontSize: 14,
    margin: 0,
  },

  card: {
    background: WHITE,
    border: "1px solid #E2E2E2",
    borderRadius: 16,
    overflow: "hidden",
  },

  sectionTitleBar: {
    background: YELLOW,
    padding: "18px 24px 12px",
  },

  cardContent: {
    padding: 28,
  },

  label: {
    display: "block",
    fontWeight: 800,
    marginBottom: 7,
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: 14,
    border: "1px solid #BDBDBD",
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 20,
    background: WHITE,
    color: BLACK,
  },

  button: {
    width: "100%",
    background: YELLOW,
    color: BLACK,
    border: `2px solid ${BLACK}`,
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
    paddingBottom: 12,
    borderBottom: `4px solid ${YELLOW}`,
  },

  restaurantList: {
    display: "grid",
    gap: 14,
  },

  restaurantCard: {
    background: WHITE,
    border: "1px solid #E0E0E0",
    borderRadius: 14,
    padding: 20,
    borderLeft: `5px solid ${YELLOW}`,
  },

  restaurantCardInactive: {
    background: "#F8F8F8",
    opacity: 0.85,
  },

  restaurantTop: {
    display: "flex",
    justifyContent: "space-between",
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
    color: GREY,
    fontSize: 13,
    fontWeight: 700,
  },

  activeBadge: {
    background: YELLOW,
    color: BLACK,
    border: `1px solid ${BLACK}`,
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  inactiveBadge: {
    background: "#EAEAEA",
    color: "#555555",
    border: "1px solid #CCCCCC",
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
    color: GREY,
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    marginBottom: 4,
  },

  payoutSection: {
    marginTop: 22,
    background: "#FAFAFA",
    border: "1px solid #DDDDDD",
    borderRadius: 12,
    padding: 18,
  },

  payoutHeadingRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },

  payoutHeading: {
    fontSize: 18,
    fontWeight: 900,
  },

  payoutSubtext: {
    fontSize: 12,
    color: GREY,
    marginTop: 4,
  },

  payoutOutstanding: {
    background: "#FFF4C2",
    border: `1px solid ${YELLOW}`,
    borderRadius: 8,
    padding: "8px 10px",
    fontWeight: 900,
    fontSize: 13,
  },

  payoutStats: {
    display: "flex",
    gap: 24,
    flexWrap: "wrap",
    margin: "16px 0",
    fontSize: 13,
  },

  viewPayoutsButton: {
    width: "100%",
    background: BLACK,
    color: YELLOW,
    border: 0,
    borderRadius: 9,
    padding: 13,
    fontWeight: 900,
    cursor: "pointer",
  },

  payoutList: {
    marginTop: 15,
    display: "grid",
    gap: 12,
  },

  noPayouts: {
    padding: 18,
    background: WHITE,
    border: "1px solid #DDDDDD",
    borderRadius: 10,
    fontSize: 14,
    color: GREY,
    lineHeight: 1.6,
  },

  payoutItem: {
    background: WHITE,
    border: "1px solid #DDDDDD",
    borderRadius: 12,
    padding: 18,
  },

  payoutItemTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 14,
  },

  payoutSmall: {
    color: GREY,
    fontSize: 12,
    marginTop: 5,
  },

  paidBadge: {
    background: "#E8F5E9",
    color: "#137333",
    borderRadius: 30,
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 900,
  },

  expectedBadge: {
    background: "#FFF4C2",
    color: BLACK,
    borderRadius: 30,
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 900,
  },

  payoutBreakdown: {
    display: "grid",
    gap: 9,
    fontSize: 14,
  },

  payoutTotalRow: {
    borderTop: "2px solid #EEEEEE",
    paddingTop: 12,
    marginTop: 5,
    fontSize: 17,
    fontWeight: 900,
  },

  expectedDate: {
    marginTop: 15,
    marginBottom: 12,
    fontSize: 13,
    color: GREY,
  },

  markPaidButton: {
    width: "100%",
    background: YELLOW,
    color: BLACK,
    border: `2px solid ${BLACK}`,
    borderRadius: 9,
    padding: 14,
    fontSize: 15,
    fontWeight: 900,
    cursor: "pointer",
  },

  paidConfirmation: {
    marginTop: 15,
    padding: 12,
    background: "#E8F5E9",
    color: "#137333",
    borderRadius: 9,
    fontWeight: 900,
    fontSize: 13,
  },

  editAction: {
    marginTop: 18,
  },

  editButton: {
    width: "100%",
    background: BLACK,
    color: YELLOW,
    border: `2px solid ${BLACK}`,
    borderRadius: 9,
    padding: 13,
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
  },

  editPanel: {
    background: "#FAFAFA",
    border: `2px solid ${YELLOW}`,
    borderRadius: 12,
    padding: 20,
    marginTop: 15,
  },

  editHeading: {
    fontSize: 20,
    margin: "0 0 8px",
    fontWeight: 900,
  },

  editDescription: {
    color: GREY,
    fontSize: 14,
    margin: "0 0 20px",
  },

  readOnlyInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: 14,
    border: "1px solid #DDDDDD",
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 8,
    background: "#EEEEEE",
    color: GREY,
    cursor: "not-allowed",
  },

  editNote: {
    color: GREY,
    fontSize: 12,
    margin: "0 0 20px",
  },

  saveButton: {
    width: "100%",
    background: YELLOW,
    color: BLACK,
    border: `2px solid ${BLACK}`,
    borderRadius: 9,
    padding: 15,
    fontSize: 15,
    fontWeight: 900,
    cursor: "pointer",
  },

  actions: {
    borderTop: "1px solid #EEEEEE",
    marginTop: 20,
    paddingTop: 18,
  },

  deactivateButton: {
    width: "100%",
    background: WHITE,
    color: BLACK,
    border: `2px solid ${BLACK}`,
    borderRadius: 9,
    padding: 13,
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
  },

  reactivateButton: {
    width: "100%",
    background: YELLOW,
    color: BLACK,
    border: `2px solid ${BLACK}`,
    borderRadius: 9,
    padding: 13,
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
  },

  empty: {
    background: WHITE,
    border: "1px solid #DDDDDD",
    borderRadius: 14,
    padding: 24,
    color: GREY,
    textAlign: "center",
  },

  error: {
    background: "#FFF0F0",
    border: "1px solid #D72C0D",
    color: "#8E1F0B",
    padding: 14,
    borderRadius: 10,
    marginBottom: 20,
  },

  success: {
    background: WHITE,
    border: `2px solid ${YELLOW}`,
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
  },

  managementSuccess: {
    background: "#FFF9CC",
    border: `1px solid ${YELLOW}`,
    color: BLACK,
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
    fontWeight: 700,
  },

  successTitle: {
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
    marginBottom: 6,
  },

  activationLink: {
    background: "#FFF9CC",
    border: `1px solid ${YELLOW}`,
    padding: 12,
    borderRadius: 8,
    overflowWrap: "anywhere",
    fontSize: 14,
  },

  note: {
    color: GREY,
    fontSize: 13,
    marginBottom: 0,
  },

  security: {
    background: "#FFF9CC",
    border: `1px solid ${YELLOW}`,
    borderRadius: 10,
    padding: 16,
    marginTop: 18,
    fontSize: 14,
    lineHeight: 1.5,
  },
};