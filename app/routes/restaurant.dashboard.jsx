import {
  Form,
  redirect,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import crypto from "node:crypto";
import db from "../db.server";
import shopify from "../shopify.server";

const COOKIE_NAME = "mdh_restaurant_session";
const SHOP_DOMAIN = "bite-pfyaja4s.myshopify.com";

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

function verifySession(sessionValue) {
  if (!sessionValue) return null;

  const [userId, signature] = sessionValue.split(".");

  if (!userId || !signature) return null;

  const expectedSignature = sign(userId);

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (
    !crypto.timingSafeEqual(
      signatureBuffer,
      expectedBuffer,
    )
  ) {
    return null;
  }

  const parsedUserId = Number(userId);

  return Number.isInteger(parsedUserId)
    ? parsedUserId
    : null;
}

async function getAuthenticatedUser(request) {
  const userId = verifySession(readCookie(request));

  if (!userId) return null;

  const user = await db.restaurantUser.findUnique({
    where: { id: userId },
    include: { restaurant: true },
  });

  if (
    !user ||
    !user.active ||
    !user.restaurant ||
    !user.restaurant.active
  ) {
    return null;
  }

  return user;
}

function getAttribute(attributes, key) {
  return (
    attributes?.find(
      (attribute) => attribute.key === key,
    )?.value || ""
  );
}

function londonTime(dateString) {
  if (!dateString) return "";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateString));
}

async function getShopifyOrders(restaurantId) {
  try {
    /*
      The Shopify React Router template stores the
      installed shop's offline session in Prisma.

      For an offline session the shop is:
      bite-pfyaja4s.myshopify.com
    */

    const offlineSession =
      await shopify.sessionStorage.loadSession(
        `offline_${SHOP_DOMAIN}`,
      );

    if (!offlineSession?.accessToken) {
      console.error(
        "Meal Deal Hub: Shopify offline session not found.",
      );

      return [];
    }

    const client = new shopify.api.clients.Graphql({
      session: offlineSession,
    });

    const response = await client.request(`
      query RestaurantOrders {
        orders(
          first: 50
          reverse: true
        ) {
          nodes {
            id
            name
            createdAt
            displayFinancialStatus

            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }

            lineItems(first: 50) {
              nodes {
                name
                quantity

                originalTotalSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }

                customAttributes {
                  key
                  value
                }
              }
            }
          }
        }
      }
    `);

    const nodes =
      response?.data?.orders?.nodes || [];

    return nodes
      .map((order) => {
        const matchingItems = order.lineItems.nodes.filter(
          (item) =>
            getAttribute(
              item.customAttributes,
              "_Restaurant ID",
            ) === restaurantId,
        );

        if (matchingItems.length === 0) {
          return null;
        }

        const foodTotal = matchingItems.reduce(
          (total, item) =>
            total +
            Number(
              item.originalTotalSet?.shopMoney?.amount ||
                0,
            ),
          0,
        );

        return {
          id: order.id,
          orderNumber: order.name,
          restaurantId,
          time: londonTime(order.createdAt),

          customer: "Customer",

          items: matchingItems.map((item) => ({
            name: item.name,
            quantity: item.quantity,
          })),

          foodTotal,

          /*
            Delivery and service-fee breakdown will
            be connected separately once we read the
            actual Shopify shipping/fee data.

            For now the Shopify order total displayed
            is the real amount paid.
          */

          delivery: 0,
          serviceFee: 0,

          total: Number(
            order.currentTotalPriceSet?.shopMoney
              ?.amount || 0,
          ),

          financialStatus:
            order.displayFinancialStatus,

          status: "new",
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.error(
      "Meal Deal Hub Shopify order error:",
      error,
    );

    return [];
  }
}

export async function loader({ request }) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    throw redirect("/restaurant/login");
  }

  const orders = await getShopifyOrders(
    user.restaurant.restaurantId,
  );

  return {
    user: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    },

    restaurant: {
      id: user.restaurant.id,
      restaurantId:
        user.restaurant.restaurantId,
      name: user.restaurant.name,
      acceptingOrders:
        user.restaurant.acceptingOrders,
    },

    orders,
  };
}

export async function action({ request }) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    throw redirect("/restaurant/login");
  }

  const formData = await request.formData();
  const intent = String(
    formData.get("intent") || "",
  );

  if (intent === "pause-orders") {
    await db.restaurant.update({
      where: { id: user.restaurant.id },
      data: { acceptingOrders: false },
    });

    return { success: true };
  }

  if (intent === "resume-orders") {
    await db.restaurant.update({
      where: { id: user.restaurant.id },
      data: { acceptingOrders: true },
    });

    return { success: true };
  }

  return { success: false };
}

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

export default function RestaurantDashboard() {
  const {
    restaurant,
    user,
    orders: shopifyOrders,
  } = useLoaderData();

  const navigation = useNavigation();

  const [activeTab, setActiveTab] =
    useState("orders");

  const [orders, setOrders] =
    useState(shopifyOrders || []);

  const [soundEnabled, setSoundEnabled] =
    useState(false);

  const audioContextRef = useRef(null);
  const alarmTimerRef = useRef(null);

  useEffect(() => {
    setOrders(shopifyOrders || []);
  }, [shopifyOrders]);

  const restaurantOrders = orders.filter(
    (order) =>
      order.restaurantId ===
      restaurant.restaurantId,
  );

  const newOrders = restaurantOrders.filter(
    (order) => order.status === "new",
  );

  const acceptedOrders =
    restaurantOrders.filter(
      (order) => order.status === "accepted",
    );

  const firstNewOrder = newOrders[0];

  const isSaving =
    navigation.state === "submitting";

  function stopAlarm() {
    if (alarmTimerRef.current) {
      clearInterval(alarmTimerRef.current);
      alarmTimerRef.current = null;
    }
  }

  function makeAlarmSound() {
    try {
      const AudioContext =
        window.AudioContext ||
        window.webkitAudioContext;

      if (!audioContextRef.current) {
        audioContextRef.current =
          new AudioContext();
      }

      const context =
        audioContextRef.current;

      if (context.state === "suspended") {
        context.resume();
      }

      const oscillator =
        context.createOscillator();

      const gain =
        context.createGain();

      oscillator.type = "square";
      oscillator.frequency.value = 880;

      gain.gain.setValueAtTime(
        0.9,
        context.currentTime,
      );

      gain.gain.exponentialRampToValueAtTime(
        0.01,
        context.currentTime + 0.7,
      );

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start();

      oscillator.stop(
        context.currentTime + 0.7,
      );
    } catch (error) {
      console.log(
        "Alarm unavailable",
        error,
      );
    }
  }

  function enableSound() {
    setSoundEnabled(true);
    makeAlarmSound();
  }

  useEffect(() => {
    stopAlarm();

    if (
      newOrders.length > 0 &&
      soundEnabled
    ) {
      makeAlarmSound();

      alarmTimerRef.current =
        setInterval(() => {
          makeAlarmSound();
        }, 1500);
    }

    return () => stopAlarm();
  }, [newOrders.length, soundEnabled]);

  function updateOrder(id, status) {
    setOrders((current) =>
      current.map((order) =>
        order.id === id &&
        order.restaurantId ===
          restaurant.restaurantId
          ? { ...order, status }
          : order,
      ),
    );
  }

  const acceptedFoodSales =
    acceptedOrders.reduce(
      (total, order) =>
        total + order.foodTotal,
      0,
    );

  const deliveryIncome =
    acceptedOrders.reduce(
      (total, order) =>
        total + order.delivery,
      0,
    );

  const commission =
    acceptedFoodSales * 0.1;

  const restaurantEarnings =
    acceptedFoodSales * 0.9 +
    deliveryIncome;

  const serviceFees =
    acceptedOrders.reduce(
      (total, order) =>
        total + order.serviceFee,
      0,
    );

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <div style={styles.logo}>
              MEAL DEAL HUB
            </div>

            <h1
              style={styles.restaurantName}
            >
              {restaurant.name}
            </h1>

            <div style={styles.location}>
              Restaurant ID:{" "}
              {restaurant.restaurantId}
            </div>
          </div>

          <div
            style={
              restaurant.acceptingOrders
                ? styles.openBadge
                : styles.pausedBadge
            }
          >
            {restaurant.acceptingOrders
              ? "● ACCEPTING ORDERS"
              : "● ORDERS PAUSED"}
          </div>
        </header>

        {activeTab === "orders" && (
          <>
            <section style={styles.controls}>
              <Form method="post">
                <input
                  type="hidden"
                  name="intent"
                  value={
                    restaurant.acceptingOrders
                      ? "pause-orders"
                      : "resume-orders"
                  }
                />

                <button
                  type="submit"
                  disabled={isSaving}
                  style={
                    restaurant.acceptingOrders
                      ? styles.darkButton
                      : styles.orangeButton
                  }
                >
                  {isSaving
                    ? "SAVING..."
                    : restaurant.acceptingOrders
                      ? "PAUSE ORDERS"
                      : "RESUME ORDERS"}
                </button>
              </Form>

              {!soundEnabled ? (
                <button
                  type="button"
                  style={styles.orangeButton}
                  onClick={enableSound}
                >
                  🔊 ENABLE ORDER SOUND
                </button>
              ) : (
                <div style={styles.soundOn}>
                  🔊 ORDER SOUND ON
                </div>
              )}
            </section>

            {firstNewOrder ? (
              <section style={styles.newOrder}>
                <div style={styles.orderTop}>
                  <div>
                    <div style={styles.newLabel}>
                      🔔 NEW ORDER
                    </div>

                    <h2
                      style={styles.orderNumber}
                    >
                      {
                        firstNewOrder.orderNumber
                      }
                    </h2>

                    <div
                      style={styles.greyText}
                    >
                      Received{" "}
                      {firstNewOrder.time}
                    </div>
                  </div>

                  <div style={styles.total}>
                    {money(
                      firstNewOrder.total,
                    )}
                  </div>
                </div>

                <p style={styles.customer}>
                  Shopify order:{" "}
                  <strong>
                    {
                      firstNewOrder.orderNumber
                    }
                  </strong>
                </p>

                <div style={styles.items}>
                  {firstNewOrder.items.map(
                    (item, index) => (
                      <div
                        key={index}
                        style={styles.item}
                      >
                        <span
                          style={
                            styles.quantity
                          }
                        >
                          {item.quantity} ×
                        </span>{" "}
                        {item.name}
                      </div>
                    ),
                  )}
                </div>

                <div style={styles.actions}>
                  <button
                    type="button"
                    style={
                      styles.acceptButton
                    }
                    onClick={() =>
                      updateOrder(
                        firstNewOrder.id,
                        "accepted",
                      )
                    }
                  >
                    ✓ ACCEPT ORDER
                  </button>

                  <button
                    type="button"
                    style={
                      styles.rejectButton
                    }
                    onClick={() =>
                      updateOrder(
                        firstNewOrder.id,
                        "rejected",
                      )
                    }
                  >
                    ✕ REJECT ORDER
                  </button>
                </div>
              </section>
            ) : (
              <section style={styles.waiting}>
                <div style={styles.tick}>
                  ✓
                </div>

                <h2>No New Orders</h2>

                <p>
                  New orders will appear here
                  automatically.
                </p>
              </section>
            )}

            <section style={styles.panel}>
              <div style={styles.titleRow}>
                <h2 style={{ margin: 0 }}>
                  Current Orders
                </h2>

                <span style={styles.count}>
                  {acceptedOrders.length}
                </span>
              </div>

              {acceptedOrders.length ===
              0 ? (
                <p style={styles.greyText}>
                  No current orders.
                </p>
              ) : (
                acceptedOrders.map(
                  (order) => (
                    <div
                      key={order.id}
                      style={
                        styles.currentOrder
                      }
                    >
                      <div>
                        <strong
                          style={{
                            fontSize: 20,
                          }}
                        >
                          {
                            order.orderNumber
                          }
                        </strong>

                        <div
                          style={
                            styles.greyText
                          }
                        >
                          {money(order.total)}
                        </div>
                      </div>

                      <span
                        style={
                          styles.acceptedBadge
                        }
                      >
                        ACCEPTED
                      </span>
                    </div>
                  ),
                )
              )}
            </section>
          </>
        )}

        {activeTab === "payments" && (
          <>
            <section
              style={styles.pageHeading}
            >
              <h2 style={{ margin: 0 }}>
                Payments
              </h2>

              <p style={styles.greyText}>
                Your Meal Deal Hub earnings
                and payouts.
              </p>
            </section>

            <div style={styles.grid}>
              <PaymentCard
                title="MEAL DEAL SALES"
                value={money(
                  acceptedFoodSales,
                )}
              />

              <PaymentCard
                title="DELIVERY"
                value={money(
                  deliveryIncome,
                )}
              />

              <PaymentCard
                title="COMMISSION"
                value={money(commission)}
              />

              <PaymentCard
                title="YOU RECEIVE"
                value={money(
                  restaurantEarnings,
                )}
              />
            </div>

            <section style={styles.payout}>
              <div style={styles.smallWhite}>
                NEXT PAYOUT
              </div>

              <div
                style={styles.payoutAmount}
              >
                {money(
                  restaurantEarnings,
                )}
              </div>

              <p>
                Payout period:{" "}
                <strong>
                  Monday – Sunday
                </strong>
              </p>

              <p>
                Meal Deal Hub commission:{" "}
                <strong>
                  {money(commission)}
                </strong>
              </p>

              <p>
                Service fees retained by Meal
                Deal Hub:{" "}
                <strong>
                  {money(serviceFees)}
                </strong>
              </p>
            </section>

            <section style={styles.panel}>
              <h2 style={{ marginTop: 0 }}>
                Payout History
              </h2>

              <p style={styles.greyText}>
                No completed payouts yet.
              </p>
            </section>
          </>
        )}

        {activeTab === "account" && (
          <>
            <section
              style={styles.pageHeading}
            >
              <h2 style={{ margin: 0 }}>
                Restaurant Account
              </h2>

              <p style={styles.greyText}>
                Your Meal Deal Hub restaurant
                account.
              </p>
            </section>

            <section style={styles.panel}>
              <AccountRow
                label="Restaurant"
                value={restaurant.name}
              />

              <AccountRow
                label="Restaurant ID"
                value={
                  restaurant.restaurantId
                }
              />

              <AccountRow
                label="Login email"
                value={user.email}
              />

              <AccountRow
                label="Order status"
                value={
                  restaurant.acceptingOrders
                    ? "Accepting Orders"
                    : "Orders Paused"
                }
              />
            </section>

            <section style={styles.panel}>
              <h2 style={{ marginTop: 0 }}>
                Order Status
              </h2>

              <p>
                Temporarily stop new Meal Deal
                Hub orders whenever your
                restaurant is too busy.
              </p>

              <Form method="post">
                <input
                  type="hidden"
                  name="intent"
                  value={
                    restaurant.acceptingOrders
                      ? "pause-orders"
                      : "resume-orders"
                  }
                />

                <button
                  type="submit"
                  disabled={isSaving}
                  style={
                    restaurant.acceptingOrders
                      ? styles.darkButton
                      : styles.orangeButton
                  }
                >
                  {isSaving
                    ? "SAVING..."
                    : restaurant.acceptingOrders
                      ? "PAUSE ORDERS"
                      : "RESUME ORDERS"}
                </button>
              </Form>
            </section>

            <section style={styles.panel}>
              <h2 style={{ marginTop: 0 }}>
                Sign Out
              </h2>

              <p style={styles.greyText}>
                Sign out of this restaurant
                terminal.
              </p>

              <a
                href="/restaurant/logout"
                style={styles.logoutButton}
              >
                LOG OUT
              </a>
            </section>
          </>
        )}

        <nav style={styles.bottomNav}>
          <button
            type="button"
            onClick={() =>
              setActiveTab("orders")
            }
            style={
              activeTab === "orders"
                ? styles.activeNav
                : styles.navButton
            }
          >
            🧾 ORDERS
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveTab("payments")
            }
            style={
              activeTab === "payments"
                ? styles.activeNav
                : styles.navButton
            }
          >
            £ PAYMENTS
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveTab("account")
            }
            style={
              activeTab === "account"
                ? styles.activeNav
                : styles.navButton
            }
          >
            ⚙ ACCOUNT
          </button>
        </nav>
      </div>
    </main>
  );
}

function PaymentCard({ title, value }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        {title}
      </div>

      <div style={styles.cardValue}>
        {value}
      </div>
    </div>
  );
}

function AccountRow({ label, value }) {
  return (
    <div style={styles.accountRow}>
      <div style={styles.greyText}>
        {label}
      </div>

      <strong>{value}</strong>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f4f4f4",
    fontFamily:
      "Arial, Helvetica, sans-serif",
    color: "#171717",
    padding: 20,
  },

  container: {
    maxWidth: 900,
    margin: "0 auto",
  },

  header: {
    background: "#171717",
    color: "#fff",
    borderRadius: 18,
    padding: 24,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 20,
    flexWrap: "wrap",
    marginBottom: 15,
  },

  logo: {
    color: "#f05a28",
    fontWeight: 900,
    letterSpacing: 1.5,
    marginBottom: 7,
  },

  restaurantName: {
    margin: "0 0 6px",
    fontSize: 28,
  },

  location: {
    color: "#bbb",
    fontSize: 13,
  },

  openBadge: {
    background: "#e8f5e9",
    color: "#137333",
    padding: "10px 14px",
    borderRadius: 30,
    fontWeight: 800,
  },

  pausedBadge: {
    background: "#fdecec",
    color: "#b42318",
    padding: "10px 14px",
    borderRadius: 30,
    fontWeight: 800,
  },

  controls: {
    background: "#fff",
    padding: 15,
    borderRadius: 14,
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 15,
    border: "1px solid #ddd",
  },

  darkButton: {
    background: "#171717",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "14px 20px",
    fontWeight: 800,
    cursor: "pointer",
  },

  orangeButton: {
    background: "#f05a28",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "14px 20px",
    fontWeight: 800,
    cursor: "pointer",
  },

  soundOn: {
    padding: "14px 20px",
    color: "#137333",
    fontWeight: 800,
  },

  newOrder: {
    background: "#fff",
    border: "4px solid #f05a28",
    borderRadius: 18,
    padding: 25,
    marginBottom: 18,
  },

  orderTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 20,
    flexWrap: "wrap",
  },

  newLabel: {
    color: "#f05a28",
    fontSize: 20,
    fontWeight: 900,
  },

  orderNumber: {
    fontSize: 32,
    margin: "8px 0 4px",
  },

  total: {
    fontSize: 38,
    fontWeight: 900,
  },

  customer: {
    fontSize: 17,
    marginTop: 24,
  },

  items: {
    background: "#f7f7f7",
    borderRadius: 12,
    padding: 18,
    marginTop: 18,
  },

  item: {
    fontSize: 21,
    fontWeight: 700,
    padding: "8px 0",
  },

  quantity: {
    color: "#f05a28",
  },

  actions: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    marginTop: 25,
  },

  acceptButton: {
    minHeight: 64,
    background: "#171717",
    color: "#fff",
    border: 0,
    borderRadius: 12,
    fontSize: 18,
    fontWeight: 900,
    cursor: "pointer",
  },

  rejectButton: {
    minHeight: 64,
    background: "#fff",
    color: "#b42318",
    border: "2px solid #b42318",
    borderRadius: 12,
    fontSize: 18,
    fontWeight: 900,
    cursor: "pointer",
  },

  waiting: {
    background: "#fff",
    borderRadius: 18,
    padding: 50,
    textAlign: "center",
    marginBottom: 18,
  },

  tick: {
    width: 55,
    height: 55,
    borderRadius: "50%",
    background: "#e8f5e9",
    color: "#137333",
    display: "grid",
    placeItems: "center",
    margin: "0 auto",
    fontSize: 28,
    fontWeight: 900,
  },

  panel: {
    background: "#fff",
    borderRadius: 16,
    padding: 22,
    border: "1px solid #ddd",
    marginBottom: 18,
  },

  pageHeading: {
    background: "#fff",
    borderRadius: 16,
    padding: 22,
    border: "1px solid #ddd",
    marginBottom: 18,
  },

  titleRow: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    marginBottom: 15,
  },

  count: {
    background: "#f05a28",
    color: "#fff",
    width: 26,
    height: 26,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    fontWeight: 800,
  },

  currentOrder: {
    borderTop: "1px solid #eee",
    padding: "16px 0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },

  acceptedBadge: {
    background: "#e8f5e9",
    color: "#137333",
    padding: "8px 12px",
    borderRadius: 30,
    fontWeight: 800,
    fontSize: 12,
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
    marginBottom: 18,
  },

  card: {
    background: "#fff",
    border: "1px solid #ddd",
    borderRadius: 14,
    padding: 22,
  },

  cardTitle: {
    color: "#666",
    fontSize: 13,
    marginBottom: 10,
  },

  cardValue: {
    fontSize: 28,
    fontWeight: 900,
  },

  payout: {
    background: "#171717",
    color: "#fff",
    borderRadius: 16,
    padding: 25,
    marginBottom: 18,
  },

  smallWhite: {
    fontSize: 13,
    fontWeight: 800,
  },

  payoutAmount: {
    color: "#f05a28",
    fontSize: 40,
    fontWeight: 900,
    margin: "10px 0 20px",
  },

  accountRow: {
    padding: "15px 0",
    borderBottom: "1px solid #eee",
    display: "flex",
    justifyContent: "space-between",
    gap: 20,
  },

  greyText: {
    color: "#666",
  },

  logoutButton: {
    display: "inline-block",
    background: "#171717",
    color: "#fff",
    textDecoration: "none",
    borderRadius: 10,
    padding: "14px 22px",
    fontWeight: 800,
  },

  bottomNav: {
    background: "#171717",
    borderRadius: 14,
    padding: 8,
    display: "grid",
    gridTemplateColumns:
      "repeat(3, 1fr)",
    gap: 6,
    position: "sticky",
    bottom: 10,
  },

  activeNav: {
    background: "#f05a28",
    color: "#fff",
    border: 0,
    borderRadius: 9,
    padding: "16px 8px",
    fontWeight: 900,
    cursor: "pointer",
  },

  navButton: {
    background: "transparent",
    color: "#fff",
    border: 0,
    borderRadius: 9,
    padding: "16px 8px",
    fontWeight: 900,
    cursor: "pointer",
  },
};