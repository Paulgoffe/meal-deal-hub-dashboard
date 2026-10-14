import {
  Form,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import crypto from "node:crypto";
import db from "../db.server";
import shopify from "../shopify.server";

const COOKIE_NAME = "mdh_restaurant_session";
const SHOP_DOMAIN = "bite-pfyaja4s.myshopify.com";
const SERVICE_FEE_PREFIX = "Meal Deal Hub Service Fee";

/*
=========================================================
AUTHENTICATION
=========================================================
*/

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

  return Number.isInteger(parsedUserId)
    ? parsedUserId
    : null;
}

async function getAuthenticatedUser(request) {
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
}
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

/*
=========================================================
HELPERS
=========================================================
*/

function getAttribute(attributes, key) {
  return (
    attributes?.find(
      (attribute) => attribute.key === key,
    )?.value || ""
  );
}

function normaliseText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textMatches(first, second) {
  const a = normaliseText(first);
  const b = normaliseText(second);

  if (!a || !b) {
    return false;
  }

  return a === b || a.includes(b) || b.includes(a);
}

function isServiceFeeItem(item) {
  return String(item?.name || "").startsWith(
    SERVICE_FEE_PREFIX,
  );
}

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function londonTime(dateString) {
  if (!dateString) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateString));
}

function londonDateTime(dateString) {
  if (!dateString) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateString));
}

function londonDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);

  const get = (type) =>
    parts.find((part) => part.type === type)?.value || "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: get("weekday"),
  };
}

function dateKeyFromParts(year, month, day) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function londonDateKey(dateString) {
  if (!dateString) {
    return "";
  }

  const parts = londonDateParts(new Date(dateString));

  return dateKeyFromParts(
    parts.year,
    parts.month,
    parts.day,
  );
}

function getCurrentPaymentWeek() {
  const londonNow = londonDateParts();

  const weekdayNumbers = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };

  const daysSinceMonday =
    weekdayNumbers[londonNow.weekday] ?? 0;

  const todayCalendar = new Date(
    Date.UTC(
      londonNow.year,
      londonNow.month - 1,
      londonNow.day,
    ),
  );

  const mondayCalendar = new Date(todayCalendar);

  mondayCalendar.setUTCDate(
    todayCalendar.getUTCDate() - daysSinceMonday,
  );

  const sundayCalendar = new Date(mondayCalendar);

  sundayCalendar.setUTCDate(
    mondayCalendar.getUTCDate() + 6,
  );

  const payoutCalendar = new Date(mondayCalendar);

  payoutCalendar.setUTCDate(
    mondayCalendar.getUTCDate() + 9,
  );

  function calendarKey(date) {
    return dateKeyFromParts(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
    );
  }

  function displayDate(date) {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  }

  return {
    startKey: calendarKey(mondayCalendar),
    endKey: calendarKey(sundayCalendar),
    startLabel: displayDate(mondayCalendar),
    endLabel: displayDate(sundayCalendar),
    payoutLabel: displayDate(payoutCalendar),
  };
}

function getOrderType(order) {
  const shippingTitle = normaliseText(
    order.shippingLine?.title,
  );

  const shippingCode = normaliseText(
    order.shippingLine?.code,
  );

  const combined = `${shippingTitle} ${shippingCode}`;

  if (
    combined.includes("pickup") ||
    combined.includes("pick up") ||
    combined.includes("collection") ||
    combined.includes("collect")
  ) {
    return "pickup";
  }

  if (order.shippingAddress) {
    return "delivery";
  }

  return "pickup";
}

function getShippingLocation(order) {
  return (
    order.shippingLine?.title ||
    order.shippingLine?.code ||
    ""
  );
}

function toPence(value) {
  return Math.round(Number(value || 0) * 100);
}

function formatPayoutDate(date) {
  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

/*
=========================================================
SHOPIFY ORDER QUERY
=========================================================
*/

async function fetchShopifyOrderPage(admin, cursor = null) {
  const response = await admin.graphql(
    `
      query RestaurantOrders($cursor: String) {
        orders(
          first: 100
          after: $cursor
          sortKey: CREATED_AT
          reverse: true
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }

          nodes {
            id
            name
            createdAt
            displayFinancialStatus

            customAttributes {
              key
              value
            }

            customer {
              firstName
              lastName
              email
              phone
            }

            shippingAddress {
              firstName
              lastName
              address1
              address2
              city
              province
              zip
              phone
            }

            shippingLine {
              title
              code
              deliveryCategory
            }

            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }

            currentShippingPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }

            lineItems(first: 100) {
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
    `,
    {
      variables: {
        cursor,
      },
    },
  );

  const result = await response.json();

  if (result.errors?.length) {
    console.error(
      "SHOPIFY ORDER GRAPHQL ERRORS:",
      JSON.stringify(result.errors),
    );

    throw new Error("Shopify order query failed.");
  }

  return {
    nodes: result.data?.orders?.nodes || [],
    pageInfo: result.data?.orders?.pageInfo || {
      hasNextPage: false,
      endCursor: null,
    },
  };
}

/*
=========================================================
SAFE ASSIGNED LOCATION LOOKUP
=========================================================
*/

async function getAssignedLocations(
  admin,
  orderId,
  orderName = "",
) {
  try {
    const response = await admin.graphql(
      `
        query RestaurantOrderAssignedLocation($id: ID!) {
          order(id: $id) {
            fulfillmentOrders(first: 20) {
              nodes {
                assignedLocation {
                  name
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          id: orderId,
        },
      },
    );

    const result = await response.json();

    if (result.errors?.length) {
      console.error(
        "ASSIGNED LOCATION GRAPHQL ERROR:",
        JSON.stringify({
          order: orderName,
          orderId,
          errors: result.errors,
        }),
      );

      return [];
    }

    return (
      result.data?.order?.fulfillmentOrders?.nodes || []
    )
      .map(
        (fulfillmentOrder) =>
          fulfillmentOrder?.assignedLocation?.name || "",
      )
      .filter(Boolean);
  } catch (error) {
    console.error(
      "ASSIGNED LOCATION LOOKUP FAILED:",
      error,
    );

    return [];
  }
}

/*
=========================================================
FETCH SHOPIFY ORDERS
=========================================================
*/

async function getRawShopifyOrders(admin) {
  const allOrders = [];

  let cursor = null;
  let hasNextPage = true;
  let pageNumber = 0;

  const MAX_PAGES = 5;

  while (hasNextPage && pageNumber < MAX_PAGES) {
    pageNumber += 1;

    const page = await fetchShopifyOrderPage(
      admin,
      cursor,
    );

    allOrders.push(...page.nodes);

    hasNextPage = Boolean(page.pageInfo.hasNextPage);
    cursor = page.pageInfo.endCursor || null;

    if (!cursor) {
      hasNextPage = false;
    }
  }

  return allOrders;
}

async function getShopifyOrders(
  restaurantId,
  restaurantName,
) {
  const { admin } = await shopify.unauthenticated.admin(
    SHOP_DOMAIN,
  );

  const nodes = await getRawShopifyOrders(admin);
  const results = [];

  const ASSIGNED_LOCATION_LOOKUP_AGE_MS =
    48 * 60 * 60 * 1000;

  const now = Date.now();

  for (const order of nodes) {
    const foodItems =
      order.lineItems?.nodes?.filter(
        (item) => !isServiceFeeItem(item),
      ) || [];

    if (foodItems.length === 0) {
      continue;
    }

    const foodRestaurantIds = foodItems
      .map((item) =>
        getAttribute(
          item.customAttributes,
          "_Restaurant ID",
        ),
      )
      .filter(Boolean);

    const matchingItems = foodItems.filter(
      (item) =>
        normaliseText(
          getAttribute(
            item.customAttributes,
            "_Restaurant ID",
          ),
        ) === normaliseText(restaurantId),
    );

    const noFoodRestaurantId =
      foodRestaurantIds.length === 0;

    const hasExplicitFoodRestaurant =
      foodRestaurantIds.length > 0;

    const orderRestaurantId = getAttribute(
      order.customAttributes,
      "_Restaurant ID",
    );

    const orderRestaurantMatches =
      Boolean(orderRestaurantId) &&
      normaliseText(orderRestaurantId) ===
        normaliseText(restaurantId);

    const orderHasDifferentRestaurant =
      Boolean(orderRestaurantId) &&
      !orderRestaurantMatches;

    const orderType = getOrderType(order);
    const shippingLocation = getShippingLocation(order);

    let belongsToRestaurant =
      matchingItems.length > 0;

    if (
      !hasExplicitFoodRestaurant &&
      orderRestaurantMatches
    ) {
      belongsToRestaurant = true;
    }

    let assignedLocations = [];

    const orderCreatedTime = order.createdAt
      ? new Date(order.createdAt).getTime()
      : 0;

    const orderAge = now - orderCreatedTime;

    const orderIsRecent =
      Number.isFinite(orderCreatedTime) &&
      orderCreatedTime > 0 &&
      orderAge >= 0 &&
      orderAge <= ASSIGNED_LOCATION_LOOKUP_AGE_MS;

    const shouldCheckAssignedLocation =
      !belongsToRestaurant &&
      noFoodRestaurantId &&
      !orderRestaurantId &&
      !orderHasDifferentRestaurant &&
      orderIsRecent;

    if (shouldCheckAssignedLocation) {
      assignedLocations = await getAssignedLocations(
        admin,
        order.id,
        order.name,
      );

      if (
        assignedLocations.some((locationName) =>
          textMatches(locationName, restaurantName),
        )
      ) {
        belongsToRestaurant = true;
      }
    }

    const canUseFallback =
      noFoodRestaurantId &&
      !orderHasDifferentRestaurant &&
      !orderRestaurantId;

    if (
      canUseFallback &&
      textMatches(shippingLocation, restaurantName)
    ) {
      belongsToRestaurant = true;
    }

    if (
      canUseFallback &&
      foodItems.some((item) =>
        textMatches(item.name, restaurantName),
      )
    ) {
      belongsToRestaurant = true;
    }

    if (!belongsToRestaurant) {
      continue;
    }

    const restaurantFoodItems =
      matchingItems.length > 0
        ? matchingItems
        : foodItems;

    const foodTotal = restaurantFoodItems.reduce(
      (total, item) =>
        total +
        Number(
          item.originalTotalSet?.shopMoney?.amount || 0,
        ),
      0,
    );

    const serviceFee = (
      order.lineItems?.nodes || []
    )
      .filter((item) => isServiceFeeItem(item))
      .reduce(
        (total, item) =>
          total +
          Number(
            item.originalTotalSet?.shopMoney?.amount || 0,
          ),
        0,
      );

    results.push({
      id: order.id,
      orderNumber: order.name,
      createdAt: order.createdAt,
      restaurantId,
      orderType,

      pickupLocation:
        orderType === "pickup"
          ? assignedLocations[0] || shippingLocation
          : "",

      time: londonTime(order.createdAt),
      dateTime: londonDateTime(order.createdAt),

      customer:
        [
          order.customer?.firstName,
          order.customer?.lastName,
        ]
          .filter(Boolean)
          .join(" ") ||
        [
          order.shippingAddress?.firstName,
          order.shippingAddress?.lastName,
        ]
          .filter(Boolean)
          .join(" ") ||
        "Customer",

      customerEmail: order.customer?.email || "",

      customerPhone:
        order.customer?.phone ||
        order.shippingAddress?.phone ||
        "",

      customerAddress: [
        order.shippingAddress?.address1,
        order.shippingAddress?.address2,
        order.shippingAddress?.city,
        order.shippingAddress?.province,
        order.shippingAddress?.zip,
      ]
        .filter(Boolean)
        .join(", "),

      items: restaurantFoodItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
      })),

      foodTotal,

      delivery: Number(
        order.currentShippingPriceSet?.shopMoney
          ?.amount || 0,
      ),

      serviceFee,

      total: Number(
        order.currentTotalPriceSet?.shopMoney
          ?.amount || 0,
      ),

      currencyCode:
        order.currentTotalPriceSet?.shopMoney
          ?.currencyCode || "",

      financialStatus: order.displayFinancialStatus,

      status: "new",
    });
  }

  return results;
}

/*
=========================================================
LOADER
=========================================================
*/

export async function loader({ request }) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    throw redirect("/restaurant/login");
  }

  let orders = [];
  let orderLoadError = "";

  try {
    orders = await getShopifyOrders(
      user.Restaurant.restaurantId,
      user.Restaurant.name,
    );
  } catch (error) {
    console.error(
      "MEAL DEAL HUB SHOPIFY ORDER ERROR:",
      error,
    );

    orderLoadError =
      "Shopify orders could not be refreshed. Please try again.";
  }

  const decisions = await db.orderDecision.findMany({
    where: {
      restaurantId: user.Restaurant.id,
    },
    orderBy: {
      decidedAt: "desc",
    },
  });

  const decisionMap = new Map(
    decisions.map((decision) => [
      decision.shopifyOrderId,
      decision.status,
    ]),
  );

  const ORDER_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const ordersWithDecisions = orders
    .filter((order) => {
      const savedStatus = decisionMap.get(order.id);

      if (savedStatus) {
        return true;
      }

      if (!order.createdAt) {
        return false;
      }

      const orderTime = new Date(
        order.createdAt,
      ).getTime();

      return (
        Number.isFinite(orderTime) &&
        now - orderTime <= ORDER_MAX_AGE_MS
      );
    })
    .map((order) => ({
      ...order,
      status: decisionMap.get(order.id) || order.status,
    }))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() -
        new Date(a.createdAt).getTime(),
    );

  /*
  =========================================================
  VERIFIED PAYMENT TOTALS

  Count only accepted orders with recorded, captured
  Shopify payments and complete GBP snapshots.
  =========================================================
  */

  const paymentWeek = getCurrentPaymentWeek();

  const verifiedOrders = decisions.filter((decision) => {
    if (
      decision.status !== "accepted" ||
      decision.paymentCaptured !== true ||
      !decision.capturedAt ||
      decision.foodSales == null ||
      decision.deliveryIncome == null ||
      decision.serviceFee == null ||
      decision.currencyCode !== "GBP"
    ) {
      return false;
    }

    const capturedDate = londonDateKey(
      decision.capturedAt,
    );

    return (
      capturedDate >= paymentWeek.startKey &&
      capturedDate <= paymentWeek.endKey
    );
  });

  const foodPence = verifiedOrders.reduce(
    (total, order) => total + toPence(order.foodSales),
    0,
  );

  const deliveryPence = verifiedOrders.reduce(
    (total, order) =>
      total + toPence(order.deliveryIncome),
    0,
  );

  const serviceFeePence = verifiedOrders.reduce(
    (total, order) => total + toPence(order.serviceFee),
    0,
  );

  const commissionPence = Math.round(foodPence * 0.1);

  const paymentSummary = {
    foodSales: foodPence / 100,
    deliveryIncome: deliveryPence / 100,
    commission: commissionPence / 100,

    restaurantEarnings:
      (foodPence - commissionPence + deliveryPence) /
      100,

    serviceFees: serviceFeePence / 100,
    acceptedOrderCount: verifiedOrders.length,
  };

  /*
  =========================================================
  ACTUAL PAYOUT HISTORY
  =========================================================
  */

  const payoutHistory = await db.restaurantPayout.findMany({
    where: {
      restaurantId: user.Restaurant.id,
    },
    orderBy: {
      weekStart: "desc",
    },
    take: 52,
    select: {
      id: true,
      weekStart: true,
      weekEnd: true,
      payoutDate: true,
      restaurantEarnings: true,
      acceptedOrderCount: true,
      status: true,
    },
  });

  /*
  =========================================================
  PAID THIS MONTH

  Use the London calendar month, not a browser date.
  =========================================================
  */

  const londonNow = londonDateParts();

  const currentMonthKey = dateKeyFromParts(
    londonNow.year,
    londonNow.month,
    1,
  ).slice(0, 7);

  const paidThisMonthPence = payoutHistory
    .filter((payout) => {
      const status = String(
        payout.status || "",
      ).toLowerCase();

      return (
        (status === "paid" || status === "completed") &&
        londonDateKey(payout.payoutDate).startsWith(
          currentMonthKey,
        )
      );
    })
    .reduce(
      (total, payout) =>
        total + toPence(payout.restaurantEarnings),
      0,
    );

  return {
    user: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    },

    restaurant: {
      id: user.Restaurant.id,
      restaurantId: user.Restaurant.restaurantId,
      name: user.Restaurant.name,
      acceptingOrders: user.Restaurant.acceptingOrders,
    },

    orders: ordersWithDecisions,
    orderLoadError,
    paidThisMonth: paidThisMonthPence / 100,
    paymentSummary,

    payoutHistory: payoutHistory.map((payout) => ({
      id: payout.id,
      weekStart: payout.weekStart,
      weekEnd: payout.weekEnd,
      payoutDate: payout.payoutDate,

      restaurantEarnings: Number(
        payout.restaurantEarnings,
      ),

      acceptedOrderCount: payout.acceptedOrderCount,
      status: payout.status,
    })),
  };
}

/*
=========================================================
ACTION
=========================================================
*/

export async function action({ request }) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    throw redirect("/restaurant/login");
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  /*
  =========================================================
  PAUSE / RESUME
  =========================================================
  */

  if (
    intent === "pause-orders" ||
    intent === "resume-orders"
  ) {
    await db.restaurant.update({
      where: {
        id: user.Restaurant.id,
      },
      data: {
        acceptingOrders: intent === "resume-orders",
      },
    });

    return {
      success: true,
    };
  }

  if (
    intent !== "accept-order" &&
    intent !== "reject-order"
  ) {
    return {
      success: false,
      message: "Unknown action.",
    };
  }

  const shopifyOrderId = String(
    formData.get("shopifyOrderId") || "",
  );

  const orderNumber = String(
    formData.get("orderNumber") || "",
  );

  if (!shopifyOrderId || !orderNumber) {
    return {
      success: false,
      message: "Order information is missing.",
    };
  }

  const accepting = intent === "accept-order";

  const fail = (message) => ({
    success: false,
    shopifyOrderId,
    orderNumber,
    message,
  });

  try {
    /*
    ========================================================
    CHECK EXISTING DECISION
    ========================================================
    */

    const existingDecision = await db.orderDecision.findUnique({
      where: {
        shopifyOrderId_restaurantId: {
          shopifyOrderId,
          restaurantId: user.Restaurant.id,
        },
      },
    });

    if (existingDecision?.status === "rejected") {
      if (accepting) {
        return fail(
          "This order was already rejected and cannot be accepted.",
        );
      }

      return {
        success: true,
        shopifyOrderId,
        orderNumber,
        status: "rejected",
      };
    }

    if (existingDecision?.status === "accepted") {
      if (!accepting) {
        return fail(
          "This order was already accepted and cannot be rejected.",
        );
      }

      if (
        existingDecision.paymentCaptured === true &&
        existingDecision.foodSales != null &&
        existingDecision.deliveryIncome != null &&
        existingDecision.serviceFee != null &&
        existingDecision.currencyCode === "GBP"
      ) {
        return {
          success: true,
          shopifyOrderId,
          orderNumber,
          status: "accepted",
        };
      }
    }

    /*
    ========================================================
    VERIFY RESTAURANT OWNERSHIP

    Never trust an order ID submitted by the browser.
    ========================================================
    */

    const restaurantOrders = await getShopifyOrders(
      user.Restaurant.restaurantId,
      user.Restaurant.name,
    );

    const restaurantOrder = restaurantOrders.find(
      (order) => order.id === shopifyOrderId,
    );

    if (!restaurantOrder) {
      return fail(
        "This order could not be verified for your restaurant.",
      );
    }

    if (restaurantOrder.orderNumber !== orderNumber) {
      return fail("Order verification failed.");
    }

    /*
    ========================================================
    SHOPIFY PAYMENT LOOKUP
    ========================================================
    */

    const { admin } = await shopify.unauthenticated.admin(
      SHOP_DOMAIN,
    );

    const paymentResponse = await admin.graphql(
      `
        query MealDealHubPaymentCheck($id: ID!) {
          order(id: $id) {
            id
            name
            displayFinancialStatus

            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }

            transactions(first: 100) {
              id
              kind
              status
              processedAt

              amountSet {
                shopMoney {
                  amount
                  currencyCode
                }

                presentmentMoney {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          id: shopifyOrderId,
        },
      },
    );

    const paymentResult = await paymentResponse.json();

    if (paymentResult.errors?.length) {
      console.error(
        "SHOPIFY PAYMENT LOOKUP ERROR:",
        paymentResult.errors,
      );

      return fail(
        "Shopify payment could not be checked. Please try again.",
      );
    }

    const shopifyOrder = paymentResult.data?.order;

    if (
      !shopifyOrder ||
      shopifyOrder.name !== orderNumber
    ) {
      return fail("Shopify order verification failed.");
    }

    const transactions = shopifyOrder.transactions || [];

    const successfulCapture = transactions.find(
      (transaction) =>
        transaction.status === "SUCCESS" &&
        (
          transaction.kind === "CAPTURE" ||
          transaction.kind === "SALE"
        ),
    );

    /*
    ========================================================
    REJECT ORDER
    ========================================================
    */

    if (!accepting) {
      if (successfulCapture) {
        return fail(
          "Payment has already been captured. This order cannot be rejected.",
        );
      }

      const successfulVoid = transactions.find(
        (transaction) =>
          transaction.kind === "VOID" &&
          transaction.status === "SUCCESS",
      );

      if (!successfulVoid) {
        const authorization = transactions.find(
          (transaction) =>
            transaction.kind === "AUTHORIZATION" &&
            transaction.status === "SUCCESS",
        );

        if (!authorization) {
          return fail(
            "No valid payment authorization was found.",
          );
        }

        const voidResponse = await admin.graphql(
          `
            mutation MealDealHubVoidPayment(
              $parentTransactionId: ID!
            ) {
              transactionVoid(
                parentTransactionId: $parentTransactionId
              ) {
                transaction {
                  id
                  kind
                  status
                }

                userErrors {
                  field
                  message
                  code
                }
              }
            }
          `,
          {
            variables: {
              parentTransactionId: authorization.id,
            },
          },
        );

        const voidResult = await voidResponse.json();

        if (voidResult.errors?.length) {
          console.error(
            "SHOPIFY VOID ERROR:",
            voidResult.errors,
          );

          return fail(
            "Payment authorization could not be released.",
          );
        }

        const voidPayload =
          voidResult.data?.transactionVoid;

        const voidErrors = voidPayload?.userErrors || [];

        if (voidErrors.length) {
          return fail(
            voidErrors
              .map((error) => error.message)
              .join(" "),
          );
        }

        if (
          voidPayload?.transaction?.kind !== "VOID" ||
          voidPayload?.transaction?.status !== "SUCCESS"
        ) {
          return fail(
            "Shopify did not confirm the payment was voided.",
          );
        }
      }

      await db.orderDecision.upsert({
        where: {
          shopifyOrderId_restaurantId: {
            shopifyOrderId,
            restaurantId: user.Restaurant.id,
          },
        },

        update: {
          status: "rejected",
          orderNumber,
        },

        create: {
          shopifyOrderId,
          orderNumber,
          restaurantId: user.Restaurant.id,
          status: "rejected",
        },
      });

      return {
        success: true,
        shopifyOrderId,
        orderNumber,
        status: "rejected",
      };
    }

    /*
    ========================================================
    ACCEPT ORDER

    Capture payment only if Shopify has not already
    recorded a successful CAPTURE or SALE.
    ========================================================
    */

    let captureTransaction = successfulCapture;

    if (!captureTransaction) {
      const authorization = transactions.find(
        (transaction) =>
          transaction.kind === "AUTHORIZATION" &&
          transaction.status === "SUCCESS",
      );

      if (!authorization) {
        return fail(
          "No valid payment authorization was found. Order was not accepted.",
        );
      }

      const captureAmount =
        authorization.amountSet?.presentmentMoney
          ?.amount ||
        authorization.amountSet?.shopMoney?.amount;

      const captureCurrency =
        authorization.amountSet?.presentmentMoney
          ?.currencyCode ||
        authorization.amountSet?.shopMoney?.currencyCode;

      if (
        !captureAmount ||
        !captureCurrency ||
        Number(captureAmount) <= 0
      ) {
        return fail(
          "The authorized payment amount is invalid.",
        );
      }

      const captureResponse = await admin.graphql(
        `
          mutation MealDealHubCaptureOrder(
            $input: OrderCaptureInput!
          ) {
            orderCapture(input: $input) {
              transaction {
                id
                kind
                status
                processedAt

                amountSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }

              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          variables: {
            input: {
              id: shopifyOrderId,
              parentTransactionId: authorization.id,
              amount: captureAmount,
              currency: captureCurrency,
            },
          },
        },
      );

      const captureResult = await captureResponse.json();

      if (captureResult.errors?.length) {
        console.error(
          "SHOPIFY CAPTURE ERROR:",
          captureResult.errors,
        );

        return fail(
          "Shopify could not confirm payment capture.",
        );
      }

      const capturePayload =
        captureResult.data?.orderCapture;

      const captureErrors =
        capturePayload?.userErrors || [];

      if (captureErrors.length) {
        return fail(
          captureErrors
            .map((error) => error.message)
            .join(" "),
        );
      }

      captureTransaction = capturePayload?.transaction;

      if (
        !captureTransaction ||
        captureTransaction.status !== "SUCCESS" ||
        captureTransaction.kind !== "CAPTURE"
      ) {
        return fail(
          "Payment was not successfully captured.",
        );
      }
    }

    /*
    ========================================================
    SAVE VERIFIED PAYMENT SNAPSHOT
    ========================================================
    */

    const foodSales = Number(restaurantOrder.foodTotal);
    const deliveryIncome = Number(
      restaurantOrder.delivery,
    );
    const serviceFee = Number(restaurantOrder.serviceFee);

    if (
      ![foodSales, deliveryIncome, serviceFee].every(
        (amount) =>
          Number.isFinite(amount) && amount >= 0,
      )
    ) {
      return fail(
        "Payment was captured, but the earnings breakdown could not be saved. Please retry.",
      );
    }

    const currencyCode =
      captureTransaction.amountSet?.shopMoney
        ?.currencyCode ||
      shopifyOrder.currentTotalPriceSet?.shopMoney
        ?.currencyCode ||
      "";

    if (currencyCode !== "GBP") {
      return fail(
        "Payment was captured, but this currency requires manual review.",
      );
    }

    const capturedAt =
      existingDecision?.capturedAt ||
      (
        captureTransaction.processedAt
          ? new Date(captureTransaction.processedAt)
          : new Date()
      );

    const snapshot = {
      status: "accepted",
      orderNumber,
      foodSales: foodSales.toFixed(2),
      deliveryIncome: deliveryIncome.toFixed(2),
      serviceFee: serviceFee.toFixed(2),
      paymentCaptured: true,
      capturedAt,
      currencyCode,
    };

    await db.orderDecision.upsert({
      where: {
        shopifyOrderId_restaurantId: {
          shopifyOrderId,
          restaurantId: user.Restaurant.id,
        },
      },

      update: snapshot,

      create: {
        shopifyOrderId,
        restaurantId: user.Restaurant.id,
        ...snapshot,
      },
    });

    console.log("RESTAURANT PAYMENT SAVED:", {
      shopifyOrderId,
      orderNumber,
      restaurantId: user.Restaurant.id,
      foodSales,
      deliveryIncome,
      serviceFee,
      paymentCaptured: true,
    });

    return {
      success: true,
      shopifyOrderId,
      orderNumber,
      status: "accepted",
    };
  } catch (error) {
    console.error(
      "RESTAURANT ORDER ACTION ERROR:",
      error,
    );

    return fail(
      "The order could not be completed. Please retry or contact support.",
    );
  }
}

/*
=========================================================
ORDER COMPONENTS
=========================================================
*/

function OrderTypeBadge({ orderType }) {
  const pickup = orderType === "pickup";

  return (
    <span
      style={
        pickup
          ? styles.pickupBadge
          : styles.deliveryBadge
      }
    >
      {pickup ? "🛍 COLLECTION" : "🚗 DELIVERY"}
    </span>
  );
}

function OrderDetails({ order, showStatus = false }) {
  if (!order) return null;

  return (
    <>
      <div style={styles.detailTop}>
        <div>
          <OrderTypeBadge orderType={order.orderType} />

          <h2 style={styles.orderNumber}>
            {order.orderNumber}
          </h2>

          <div style={styles.greyText}>
            {order.dateTime}
          </div>
        </div>

        <div style={styles.total}>
          {money(order.total)}
        </div>
      </div>

      {showStatus && (
        <div style={{ marginTop: 14 }}>
          <span
            style={
              order.status === "accepted"
                ? styles.acceptedBadge
                : styles.rejectedBadge
            }
          >
            {String(order.status || "").toUpperCase()}
          </span>
        </div>
      )}

      <div style={styles.customerDetails}>
        <div style={styles.sectionLabel}>
          CUSTOMER DETAILS
        </div>

        <div style={styles.infoLine}>
          <span>Customer</span>
          <strong>{order.customer || "Customer"}</strong>
        </div>

        {order.customerPhone && (
          <div style={styles.infoLine}>
            <span>Phone</span>
            <strong>{order.customerPhone}</strong>
          </div>
        )}

        {order.customerEmail && (
          <div style={styles.infoLine}>
            <span>Email</span>
            <strong style={{ overflowWrap: "anywhere" }}>
              {order.customerEmail}
            </strong>
          </div>
        )}

        {order.orderType === "delivery" &&
          order.customerAddress && (
            <div style={styles.infoLine}>
              <span>Delivery address</span>
              <strong>{order.customerAddress}</strong>
            </div>
          )}

        {order.orderType === "pickup" &&
          order.pickupLocation && (
            <div style={styles.infoLine}>
              <span>Collection location</span>
              <strong>{order.pickupLocation}</strong>
            </div>
          )}
      </div>

      <div style={styles.items}>
        <div style={styles.sectionLabel}>
          ORDER ITEMS
        </div>

        {(order.items || []).map((item, index) => (
          <div key={index} style={styles.item}>
            <span style={styles.quantity}>
              {item.quantity}×
            </span>
            <span>{item.name}</span>
          </div>
        ))}
      </div>

      <div style={styles.orderBreakdown}>
        <div style={styles.breakdownRow}>
          <span>Food</span>
          <strong>{money(order.foodTotal)}</strong>
        </div>

        {Number(order.delivery || 0) > 0 && (
          <div style={styles.breakdownRow}>
            <span>Delivery</span>
            <strong>{money(order.delivery)}</strong>
          </div>
        )}

        {Number(order.serviceFee || 0) > 0 && (
          <div style={styles.breakdownRow}>
            <span>Service fee</span>
            <strong>{money(order.serviceFee)}</strong>
          </div>
        )}

        <div style={styles.breakdownTotal}>
          <span>ORDER TOTAL</span>
          <strong>{money(order.total)}</strong>
        </div>
      </div>
    </>
  );
}

/*
=========================================================
DASHBOARD
=========================================================
*/

export default function RestaurantDashboard() {
  const {
    restaurant,
    user,
    orders: shopifyOrders,
    orderLoadError = "",
    paidThisMonth = 0,
    paymentSummary,
    payoutHistory = [],
  } = useLoaderData();

  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const orderFetcher = useFetcher();

  const [activeTab, setActiveTab] = useState("orders");
  const [orders, setOrders] = useState(shopifyOrders || []);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundUnlocked, setSoundUnlocked] = useState(false);

  const [selectedOrderId, setSelectedOrderId] =
    useState(null);

  const [pendingOrderAction, setPendingOrderAction] =
    useState(null);

  const [showAllOrders, setShowAllOrders] =
    useState(false);

  const audioContextRef = useRef(null);
  const alarmTimerRef = useRef(null);
  const soundEnabledRef = useRef(true);

  /*
  =========================================================
  AUTO REFRESH
  =========================================================
  */

  useEffect(() => {
    const interval = setInterval(() => {
      if (
        orderFetcher.state === "idle" &&
        revalidator.state === "idle"
      ) {
        revalidator.revalidate();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [
    orderFetcher.state,
    revalidator,
    revalidator.state,
  ]);

  /*
  =========================================================
  SYNC ORDERS
  =========================================================
  */

  useEffect(() => {
    if (!pendingOrderAction && !orderLoadError) {
      setOrders(shopifyOrders || []);
    }
  }, [
    shopifyOrders,
    pendingOrderAction,
    orderLoadError,
  ]);

  /*
  =========================================================
  ACCEPT / REJECT RESPONSE
  =========================================================
  */

  useEffect(() => {
    if (
      !pendingOrderAction ||
      orderFetcher.state !== "idle" ||
      !orderFetcher.data
    ) {
      return;
    }

    if (orderFetcher.data.success === true) {
      setPendingOrderAction(null);
      revalidator.revalidate();
      return;
    }

    if (orderFetcher.data.success === false) {
      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === pendingOrderAction.orderId
            ? { ...order, status: "new" }
            : order,
        ),
      );

      setPendingOrderAction(null);

      window.alert(
        orderFetcher.data.message ||
          "The order could not be updated. Please try again.",
      );
    }
  }, [
    orderFetcher.state,
    orderFetcher.data,
    pendingOrderAction,
    revalidator,
  ]);

  /*
  =========================================================
  SOUND SETTINGS
  =========================================================
  */

  useEffect(() => {
    try {
      const savedSetting =
        window.localStorage.getItem("mdh_order_sound");

      if (savedSetting === "off") {
        setSoundEnabled(false);
        soundEnabledRef.current = false;
      } else {
        setSoundEnabled(true);
        soundEnabledRef.current = true;
      }
    } catch {
      setSoundEnabled(true);
      soundEnabledRef.current = true;
    }
  }, []);

  const restaurantOrders = orders.filter(
    (order) =>
      normaliseText(order.restaurantId) ===
      normaliseText(restaurant.restaurantId),
  );

  const newOrders = restaurantOrders.filter(
    (order) => order.status === "new",
  );

  const acceptedOrders = restaurantOrders.filter(
    (order) => order.status === "accepted",
  );

  const rejectedOrders = restaurantOrders.filter(
    (order) => order.status === "rejected",
  );

  const previousOrders = [
    ...acceptedOrders,
    ...rejectedOrders,
  ].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() -
      new Date(a.createdAt).getTime(),
  );

  const visiblePreviousOrders = showAllOrders
    ? previousOrders
    : previousOrders.slice(0, 5);

  const selectedOrder =
    restaurantOrders.find(
      (order) => order.id === selectedOrderId,
    ) || null;

  const paymentWeek = getCurrentPaymentWeek();

  /*
  =========================================================
  VERIFIED SHOPIFY PAYMENT TOTALS
  =========================================================
  */

  const acceptedFoodSales = Number(
    paymentSummary?.foodSales || 0,
  );

  const deliveryIncome = Number(
    paymentSummary?.deliveryIncome || 0,
  );

  const commission = Number(
    paymentSummary?.commission || 0,
  );

  const restaurantEarnings = Number(
    paymentSummary?.restaurantEarnings || 0,
  );

  const serviceFees = Number(
    paymentSummary?.serviceFees || 0,
  );

  const verifiedAcceptedOrderCount = Number(
    paymentSummary?.acceptedOrderCount || 0,
  );

  const firstNewOrder = newOrders[0];

  const isSaving = navigation.state === "submitting";

  const orderActionSaving =
    orderFetcher.state !== "idle" ||
    Boolean(pendingOrderAction);

  /*
  =========================================================
  ACCEPT / REJECT
  =========================================================
  */

  function handleOrderDecision(order, action) {
    if (!order || orderActionSaving) return;

    const status =
      action === "accept" ? "accepted" : "rejected";

    setPendingOrderAction({
      orderId: order.id,
      action,
    });

    setOrders((currentOrders) =>
      currentOrders.map((currentOrder) =>
        currentOrder.id === order.id
          ? { ...currentOrder, status }
          : currentOrder,
      ),
    );

    const formData = new FormData();

    formData.set(
      "intent",
      action === "accept"
        ? "accept-order"
        : "reject-order",
    );

    formData.set("shopifyOrderId", order.id);
    formData.set("orderNumber", order.orderNumber);

    orderFetcher.submit(formData, {
      method: "post",
    });
  }

  /*
  =========================================================
  ORDER ALARM
  =========================================================
  */

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

      if (!AudioContext) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const context = audioContextRef.current;

      if (context.state === "suspended") {
        context.resume();
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();

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
      oscillator.stop(context.currentTime + 0.7);
    } catch (error) {
      console.log("Alarm unavailable", error);
    }
  }

  function enableSound() {
    setSoundEnabled(true);
    soundEnabledRef.current = true;

    try {
      window.localStorage.setItem(
        "mdh_order_sound",
        "on",
      );
    } catch {
      // Ignore storage errors.
    }

    try {
      const AudioContext =
        window.AudioContext ||
        window.webkitAudioContext;

      if (AudioContext && !audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      if (
        audioContextRef.current?.state === "suspended"
      ) {
        audioContextRef.current.resume();
      }

      setSoundUnlocked(true);
      makeAlarmSound();
    } catch (error) {
      console.log("Order sound unavailable", error);
    }
  }

  function disableSound() {
    setSoundEnabled(false);
    soundEnabledRef.current = false;

    try {
      window.localStorage.setItem(
        "mdh_order_sound",
        "off",
      );
    } catch {
      // Ignore storage errors.
    }

    stopAlarm();
  }

  useEffect(() => {
    function unlockOrderSound() {
      if (!soundEnabledRef.current) return;

      try {
        const AudioContext =
          window.AudioContext ||
          window.webkitAudioContext;

        if (!AudioContext) return;

        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext();
        }

        const context = audioContextRef.current;

        if (context.state === "suspended") {
          context.resume();
        }

        setSoundUnlocked(true);
      } catch (error) {
        console.log(
          "Order sound unlock unavailable",
          error,
        );
      }
    }

    document.addEventListener(
      "pointerdown",
      unlockOrderSound,
      { once: true, capture: true },
    );

    document.addEventListener(
      "keydown",
      unlockOrderSound,
      { once: true, capture: true },
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        unlockOrderSound,
        true,
      );

      document.removeEventListener(
        "keydown",
        unlockOrderSound,
        true,
      );
    };
  }, []);

  useEffect(() => {
    stopAlarm();

    if (
      newOrders.length > 0 &&
      soundEnabled &&
      soundUnlocked
    ) {
      makeAlarmSound();

      alarmTimerRef.current = setInterval(() => {
        makeAlarmSound();
      }, 1500);
    }

    return () => stopAlarm();
  }, [
    newOrders.length,
    soundEnabled,
    soundUnlocked,
  ]);

  /*
  =========================================================
  PAGE
  =========================================================
  */

  return (
    <main style={styles.page}>
      <style>
        {`
          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
          }

          .mdh-dashboard-button:hover {
            opacity: 0.88;
          }

          .mdh-dashboard-button:focus-visible {
            outline: 3px solid #FFCE00;
            outline-offset: 3px;
          }

          .mdh-dashboard-button:disabled {
            opacity: 0.55;
            cursor: not-allowed;
          }

          .mdh-order-row:hover {
            background: #FAFAFA !important;
          }

          @media (max-width: 600px) {
            .mdh-header-inner {
              padding: 16px !important;
            }

            .mdh-content {
              padding: 20px 14px 115px !important;
            }

            .mdh-summary-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            }

            .mdh-order-actions {
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            }

            .mdh-header-logo {
              width: 58px !important;
              height: 58px !important;
            }

            .mdh-header-name {
              font-size: 18px !important;
            }

            .mdh-status-badge {
              font-size: 10px !important;
              padding: 7px 9px !important;
            }

            .mdh-payment-value {
              font-size: 25px !important;
            }

            .mdh-bottom-nav {
              width: 100% !important;
              border-radius: 0 !important;
              bottom: 0 !important;
            }
          }
        `}
      </style>

      <header style={styles.header}>
        <div
          className="mdh-header-inner"
          style={styles.headerInner}
        >
          <div style={styles.headerIdentity}>
            <img
              className="mdh-header-logo"
              src="/meal-deal-hub-logo.png"
              alt="Meal Deal Hub"
              style={styles.logo}
            />

            <div style={{ minWidth: 0 }}>
              <h1
                className="mdh-header-name"
                style={styles.restaurantName}
              >
                {restaurant.name}
              </h1>

              <div style={styles.location}>
                ID: {restaurant.restaurantId}
              </div>
            </div>
          </div>

          <div
            className="mdh-status-badge"
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
        </div>
      </header>

      <div
        className="mdh-content"
        style={styles.container}
      >
        {activeTab === "orders" && (
          <>
            <div style={styles.pageIntro}>
              <div>
                <h2 style={styles.pageTitle}>
                  Orders
                </h2>

                <p style={styles.pageSubtitle}>
                  Manage incoming orders
                </p>
              </div>

              <span style={styles.liveIndicator}>
                ● LIVE
              </span>
            </div>

            <section style={styles.controls}>
              <Form
                method="post"
                style={{ flex: "1 1 150px" }}
              >
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
                  className="mdh-dashboard-button"
                  type="submit"
                  disabled={isSaving}
                  style={styles.controlButton}
                >
                  <span style={styles.controlIcon}>
                    {restaurant.acceptingOrders
                      ? "⏸"
                      : "▶"}
                  </span>

                  {isSaving
                    ? "SAVING..."
                    : restaurant.acceptingOrders
                      ? "PAUSE ORDERS"
                      : "RESUME ORDERS"}
                </button>
              </Form>

              <button
                className="mdh-dashboard-button"
                type="button"
                style={{
                  ...styles.controlButton,
                  flex: "1 1 150px",
                }}
                onClick={
                  soundEnabled
                    ? disableSound
                    : enableSound
                }
              >
                <span style={styles.controlIcon}>
                  {soundEnabled ? "🔊" : "🔇"}
                </span>

                SOUND {soundEnabled ? "ON" : "OFF"}
              </button>
            </section>

            {soundEnabled && !soundUnlocked && (
              <p style={styles.soundNotice}>
                Tap anywhere to enable new-order alerts.
              </p>
            )}

            {orderLoadError && (
              <section style={styles.errorPanel}>
                {orderLoadError}
              </section>
            )}

            {firstNewOrder ? (
              <section style={styles.newOrder}>
                <div style={styles.newOrderHeading}>
                  <span style={styles.newOrderBell}>
                    🔔
                  </span>

                  <div>
                    <div style={styles.newLabel}>
                      NEW ORDER
                    </div>

                    <div style={styles.newOrderSubheading}>
                      An order is waiting for your response
                    </div>
                  </div>

                  {newOrders.length > 1 && (
                    <span style={styles.newCount}>
                      {newOrders.length} NEW
                    </span>
                  )}
                </div>

                <div style={styles.newOrderInner}>
                  <OrderDetails order={firstNewOrder} />

                  <div
                    className="mdh-order-actions"
                    style={styles.actions}
                  >
                    <button
                      className="mdh-dashboard-button"
                      type="button"
                      disabled={orderActionSaving}
                      style={styles.acceptButton}
                      onClick={() =>
                        handleOrderDecision(
                          firstNewOrder,
                          "accept",
                        )
                      }
                    >
                      {pendingOrderAction?.orderId ===
                        firstNewOrder.id &&
                      pendingOrderAction?.action ===
                        "accept"
                        ? "ACCEPTING..."
                        : "✓ ACCEPT"}
                    </button>

                    <button
                      className="mdh-dashboard-button"
                      type="button"
                      disabled={orderActionSaving}
                      style={styles.rejectButton}
                      onClick={() =>
                        handleOrderDecision(
                          firstNewOrder,
                          "reject",
                        )
                      }
                    >
                      {pendingOrderAction?.orderId ===
                        firstNewOrder.id &&
                      pendingOrderAction?.action ===
                        "reject"
                        ? "REJECTING..."
                        : "× REJECT"}
                    </button>
                  </div>
                </div>
              </section>
            ) : (
              <section style={styles.waiting}>
                <div style={styles.tick}>✓</div>

                <h2 style={styles.waitingTitle}>
                  All Caught Up!
                </h2>

                <p style={styles.greyText}>
                  No new orders right now.
                  Incoming orders will appear here
                  automatically.
                </p>
              </section>
            )}

            <section style={styles.panel}>
              <div style={styles.titleRow}>
                <div style={styles.titleGroup}>
                  <h2 style={styles.sectionTitle}>
                    Previous Orders
                  </h2>

                  <span style={styles.count}>
                    {previousOrders.length}
                  </span>
                </div>

                {previousOrders.length > 5 && (
                  <button
                    className="mdh-dashboard-button"
                    type="button"
                    style={styles.viewAllButton}
                    onClick={() =>
                      setShowAllOrders((current) => !current)
                    }
                  >
                    {showAllOrders
                      ? "Show less"
                      : "View all →"}
                  </button>
                )}
              </div>

              {previousOrders.length === 0 ? (
                <p style={styles.emptyText}>
                  No previous orders yet.
                </p>
              ) : (
                visiblePreviousOrders.map((order) => (
                  <button
                    className="mdh-order-row mdh-dashboard-button"
                    type="button"
                    key={order.id}
                    style={styles.previousOrderButton}
                    onClick={() =>
                      setSelectedOrderId(order.id)
                    }
                  >
                    <div style={styles.previousOrderLeft}>
                      <strong style={styles.previousOrderNumber}>
                        {order.orderNumber}
                      </strong>

                      <div style={styles.greyText}>
                        {order.dateTime}
                      </div>

                      <div style={styles.previousOrderType}>
                        {order.orderType === "pickup"
                          ? "🛍 COLLECTION"
                          : "🚗 DELIVERY"}
                      </div>
                    </div>

                    <div style={styles.previousOrderRight}>
                      <strong style={styles.previousOrderAmount}>
                        {money(order.total)}
                      </strong>

                      <span
                        style={
                          order.status === "accepted"
                            ? styles.acceptedBadge
                            : styles.rejectedBadge
                        }
                      >
                        {String(
                          order.status || "",
                        ).toUpperCase()}
                      </span>
                    </div>

                    <span style={styles.rowChevron}>
                      ›
                    </span>
                  </button>
                ))
              )}
            </section>
          </>
        )}

        {activeTab === "payments" && (
          <>
            <div style={styles.pageIntro}>
              <div>
                <h2 style={styles.pageTitle}>
                  Payments
                </h2>

                <p style={styles.pageSubtitle}>
                  Track your earnings and payouts
                </p>
              </div>
            </div>

            <section style={styles.weekSelector}>
              <div>
                <div style={styles.weekSelectorTitle}>
                  📅 THIS WEEK
                </div>

                <strong style={styles.weekSelectorDate}>
                  {paymentWeek.startLabel}
                  {" – "}
                  {paymentWeek.endLabel}
                </strong>
              </div>

              <span style={styles.weekSelectorIcon}>
                ✓
              </span>
            </section>

            <div
              className="mdh-summary-grid"
              style={styles.grid}
            >
              <PaymentCard
                icon="🍔"
                title="MEAL DEAL SALES"
                value={money(acceptedFoodSales)}
              />

              <PaymentCard
                icon="🚗"
                title="DELIVERY"
                value={money(deliveryIncome)}
              />

              <PaymentCard
                icon="↗"
                title="COMMISSION"
                value={money(commission)}
                subtitle="Meal Deal Hub commission"
              />

              <PaymentCard
                icon="£"
                title="YOU RECEIVE"
                value={money(restaurantEarnings)}
                highlight
              />
            </div>

            <div style={styles.secondaryGrid}>
              <div style={styles.paidCard}>
                <div style={styles.secondaryCardLabel}>
                  ✓ PAID THIS MONTH
                </div>

                <div style={styles.secondaryCardValue}>
                  {money(paidThisMonth)}
                </div>
              </div>

              <div style={styles.nextPayoutCard}>
                <div style={styles.secondaryCardLabel}>
                  ◷ ESTIMATED NEXT PAYOUT
                </div>

                <div style={styles.secondaryCardValue}>
                  {money(restaurantEarnings)}
                </div>

                <div style={styles.secondaryCardDate}>
                  Standard date: {paymentWeek.payoutLabel}
                </div>
              </div>
            </div>

            <section style={styles.paymentNote}>
              <strong>
                This week's payment summary
              </strong>

              <div style={styles.paymentNoteRow}>
                <span>Accepted paid orders</span>
                <strong>
                  {verifiedAcceptedOrderCount}
                </strong>
              </div>

              <div style={styles.paymentNoteRow}>
                <span>Commission</span>
                <strong>{money(commission)}</strong>
              </div>

              <div style={styles.paymentNoteRow}>
                <span>Service fees retained by Meal Deal Hub</span>
                <strong>{money(serviceFees)}</strong>
              </div>

              <p style={styles.paymentDisclaimer}>
                Payouts are transferred manually after
                reconciliation. Actual payment dates may
                change for bank holidays.
              </p>
            </section>

            <section style={styles.panel}>
              <div style={styles.titleRow}>
                <h2 style={styles.sectionTitle}>
                  Payout History
                </h2>
              </div>

              {payoutHistory.length === 0 ? (
                <p style={styles.emptyText}>
                  No payout records yet.
                </p>
              ) : (
                payoutHistory.map((payout) => {
                  const status = String(
                    payout.status || "",
                  ).toLowerCase();

                  const isPaid =
                    status === "paid" ||
                    status === "completed";

                  return (
                    <div
                      key={payout.id}
                      style={styles.historyRow}
                    >
                      <div style={{ minWidth: 0 }}>
                        <strong style={styles.historyDates}>
                          {formatPayoutDate(
                            payout.weekStart,
                          )}
                          {" – "}
                          {formatPayoutDate(
                            payout.weekEnd,
                          )}
                        </strong>

                        <div style={styles.greyText}>
                          {isPaid
                            ? "Recorded payout date: "
                            : "Expected: "}
                          {formatPayoutDate(
                            payout.payoutDate,
                          )}
                        </div>

                        <div style={styles.historyCount}>
                          {payout.acceptedOrderCount}{" "}
                          accepted orders
                        </div>
                      </div>

                      <div style={styles.historyRight}>
                        <strong style={styles.historyAmount}>
                          {money(
                            payout.restaurantEarnings,
                          )}
                        </strong>

                        <span
                          style={
                            isPaid
                              ? styles.acceptedBadge
                              : styles.expectedBadge
                          }
                        >
                          {isPaid
                            ? "PAID"
                            : status.toUpperCase() ||
                              "EXPECTED"}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </section>
          </>
        )}

        {activeTab === "account" && (
          <>
            <div style={styles.pageIntro}>
              <div>
                <h2 style={styles.pageTitle}>
                  My Account
                </h2>

                <p style={styles.pageSubtitle}>
                  Restaurant details and settings
                </p>
              </div>
            </div>

            <section style={styles.panel}>
              <div style={styles.accountSectionHeading}>
                <span style={styles.accountSectionIcon}>
                  ▣
                </span>

                <h2 style={styles.sectionTitle}>
                  Restaurant Information
                </h2>
              </div>

              <AccountRow
                label="Restaurant Name"
                value={restaurant.name}
              />

              <AccountRow
                label="Restaurant ID"
                value={restaurant.restaurantId}
              />

              <AccountRow
                label="Email Address"
                value={user.email}
              />

              <AccountRow
                label="Order Status"
                value={
                  restaurant.acceptingOrders
                    ? "● Accepting Orders"
                    : "● Orders Paused"
                }
                status={
                  restaurant.acceptingOrders
                    ? "open"
                    : "paused"
                }
              />
            </section>

            <section style={styles.panel}>
              <div style={styles.accountSectionHeading}>
                <span style={styles.accountSectionIcon}>
                  ⚙
                </span>

                <h2 style={styles.sectionTitle}>
                  Order Settings
                </h2>
              </div>

              <div style={styles.settingRow}>
                <div>
                  <strong style={styles.settingTitle}>
                    Accept New Orders
                  </strong>

                  <p style={styles.settingDescription}>
                    Temporarily pause or resume orders.
                  </p>
                </div>

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
                    className="mdh-dashboard-button"
                    type="submit"
                    disabled={isSaving}
                    style={
                      restaurant.acceptingOrders
                        ? styles.pauseSmallButton
                        : styles.resumeSmallButton
                    }
                  >
                    {isSaving
                      ? "SAVING..."
                      : restaurant.acceptingOrders
                        ? "PAUSE"
                        : "RESUME"}
                  </button>
                </Form>
              </div>

              <div style={styles.settingRow}>
                <div>
                  <strong style={styles.settingTitle}>
                    Sound Notifications
                  </strong>

                  <p style={styles.settingDescription}>
                    Play an alert for incoming orders.
                  </p>
                </div>

                <button
                  className="mdh-dashboard-button"
                  type="button"
                  role="switch"
                  aria-checked={soundEnabled}
                  aria-label="Sound notifications"
                  onClick={
                    soundEnabled
                      ? disableSound
                      : enableSound
                  }
                  style={{
                    ...styles.toggleTrack,
                    background: soundEnabled
                      ? "#FFD400"
                      : "#D1D5DB",
                  }}
                >
                  <span
                    style={{
                      ...styles.toggleKnob,
                      transform: soundEnabled
                        ? "translateX(23px)"
                        : "translateX(0)",
                    }}
                  />
                </button>
              </div>
            </section>

            <section style={styles.panel}>
              <div style={styles.accountSectionHeading}>
                <span style={styles.accountSectionIcon}>
                  ↪
                </span>

                <h2 style={styles.sectionTitle}>
                  Sign Out
                </h2>
              </div>

              <p style={styles.settingDescription}>
                Sign out securely from your restaurant
                dashboard.
              </p>

              <a
                href="/restaurant/logout"
                style={styles.logoutButton}
              >
                ↪ LOG OUT
              </a>
            </section>
          </>
        )}
      </div>

      <nav
        className="mdh-bottom-nav"
        style={styles.bottomNav}
        aria-label="Restaurant dashboard navigation"
      >
        <button
          className="mdh-dashboard-button"
          type="button"
          onClick={() => setActiveTab("orders")}
          style={
            activeTab === "orders"
              ? styles.activeNav
              : styles.navButton
          }
        >
          <span style={styles.navIcon}>▤</span>
          <span>ORDERS</span>
          {newOrders.length > 0 && (
            <span style={styles.navCount}>
              {newOrders.length}
            </span>
          )}
        </button>

        <button
          className="mdh-dashboard-button"
          type="button"
          onClick={() => setActiveTab("payments")}
          style={
            activeTab === "payments"
              ? styles.activeNav
              : styles.navButton
          }
        >
          <span style={styles.navIcon}>£</span>
          <span>PAYMENTS</span>
        </button>

        <button
          className="mdh-dashboard-button"
          type="button"
          onClick={() => setActiveTab("account")}
          style={
            activeTab === "account"
              ? styles.activeNav
              : styles.navButton
          }
        >
          <span style={styles.navIcon}>⚙</span>
          <span>ACCOUNT</span>
        </button>
      </nav>

      {selectedOrder && (
        <div
          style={styles.modalOverlay}
          onClick={() => setSelectedOrderId(null)}
        >
          <div
            style={styles.orderModal}
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <button
              className="mdh-dashboard-button"
              type="button"
              style={styles.closeButton}
              onClick={() =>
                setSelectedOrderId(null)
              }
              aria-label="Close order details"
            >
              ×
            </button>

            <div style={styles.modalHeading}>
              ORDER DETAILS
            </div>

            <OrderDetails
              order={selectedOrder}
              showStatus
            />

            <button
              className="mdh-dashboard-button"
              type="button"
              style={styles.modalDoneButton}
              onClick={() =>
                setSelectedOrderId(null)
              }
            >
              CLOSE
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/*
=========================================================
SMALL COMPONENTS
=========================================================
*/

function PaymentCard({
  icon,
  title,
  value,
  subtitle,
  highlight = false,
}) {
  return (
    <div
      style={
        highlight
          ? styles.highlightPaymentCard
          : styles.paymentCard
      }
    >
      <div style={styles.paymentIcon}>
        {icon}
      </div>

      <div
        style={
          highlight
            ? styles.highlightCardTitle
            : styles.paymentCardTitle
        }
      >
        {title}
      </div>

      <div
        className="mdh-payment-value"
        style={
          highlight
            ? styles.highlightCardValue
            : styles.paymentCardValue
        }
      >
        {value}
      </div>

      {subtitle && (
        <div style={styles.paymentCardSubtitle}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function AccountRow({
  label,
  value,
  status,
}) {
  return (
    <div style={styles.accountRow}>
      <span style={styles.accountLabel}>
        {label}
      </span>

      <strong
        style={{
          ...styles.accountValue,
          color:
            status === "open"
              ? "#15803D"
              : status === "paused"
                ? "#B42318"
                : "#111111",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

/*
=========================================================
STYLES
=========================================================
*/

const styles = {
  page: {
    minHeight: "100vh",
    background: "#F5F6F8",
    fontFamily:
      "Arial, Helvetica, sans-serif",
    color: "#151515",
    padding: 0,
    paddingBottom: 90,
  },

  header: {
    background: "#111111",
    color: "#FFFFFF",
    borderBottom: "4px solid #FFD400",
  },

  headerInner: {
    maxWidth: 950,
    margin: "0 auto",
    padding: "19px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },

  headerIdentity: {
    display: "flex",
    alignItems: "center",
    gap: 13,
    minWidth: 0,
  },

  logo: {
    width: 70,
    height: 70,
    objectFit: "contain",
    flexShrink: 0,
  },

  restaurantName: {
    margin: "0 0 5px",
    fontSize: 23,
    fontWeight: 900,
    lineHeight: 1.2,
    color: "#FFFFFF",
    overflowWrap: "anywhere",
  },

  location: {
    color: "#BFC0C2",
    fontSize: 12,
    fontWeight: 600,
  },

  openBadge: {
    background: "#193B29",
    color: "#73E6A0",
    border: "1px solid #35684B",
    borderRadius: 30,
    padding: "9px 12px",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },

  pausedBadge: {
    background: "#442020",
    color: "#FFB4B4",
    border: "1px solid #7A3C3C",
    borderRadius: 30,
    padding: "9px 12px",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },

  container: {
    maxWidth: 950,
    margin: "0 auto",
    padding: "26px 22px 120px",
  },

  pageIntro: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 22,
  },

  pageTitle: {
    fontSize: 30,
    fontWeight: 900,
    margin: "0 0 6px",
    letterSpacing: -0.7,
  },

  pageSubtitle: {
    fontSize: 14,
    color: "#777777",
    margin: 0,
    lineHeight: 1.5,
  },

  liveIndicator: {
    background: "#E8F8EE",
    color: "#17813C",
    borderRadius: 20,
    padding: "7px 11px",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  controls: {
    display: "flex",
    gap: 12,
    marginBottom: 12,
    flexWrap: "wrap",
  },

  controlButton: {
    width: "100%",
    minHeight: 52,
    padding: "13px 14px",
    background: "#FFFFFF",
    color: "#151515",
    border: "1px solid #E5E7EB",
    borderRadius: 13,
    fontWeight: 900,
    fontSize: 12,
    cursor: "pointer",
    boxShadow: "0 3px 10px rgba(0,0,0,0.03)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },

  controlIcon: {
    fontSize: 18,
  },

  soundNotice: {
    margin: "0 0 18px",
    color: "#777777",
    fontSize: 12,
  },

  errorPanel: {
    background: "#FFF0F0",
    color: "#B42318",
    border: "1px solid #F5B9B4",
    borderRadius: 12,
    padding: 16,
    marginBottom: 18,
    fontWeight: 700,
  },

  newOrder: {
    background: "#FFD400",
    borderRadius: 18,
    padding: 14,
    marginBottom: 24,
    boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
  },

  newOrderHeading: {
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "5px 6px 16px",
  },

  newOrderBell: {
    width: 43,
    height: 43,
    background: "#111111",
    color: "#FFD400",
    borderRadius: 12,
    display: "grid",
    placeItems: "center",
    fontSize: 21,
    flexShrink: 0,
  },

  newLabel: {
    fontSize: 18,
    fontWeight: 900,
    color: "#111111",
    letterSpacing: 0.3,
  },

  newOrderSubheading: {
    fontSize: 12,
    color: "#403800",
    marginTop: 3,
    lineHeight: 1.4,
  },

  newCount: {
    marginLeft: "auto",
    background: "#111111",
    color: "#FFD400",
    padding: "7px 9px",
    borderRadius: 20,
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  newOrderInner: {
    background: "#FFFFFF",
    borderRadius: 13,
    padding: 19,
  },

  detailTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },

  pickupBadge: {
    display: "inline-block",
    background: "#FFF5C5",
    color: "#665000",
    borderRadius: 20,
    padding: "7px 10px",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: 0.3,
  },

  deliveryBadge: {
    display: "inline-block",
    background: "#E9F1FF",
    color: "#2355A2",
    borderRadius: 20,
    padding: "7px 10px",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: 0.3,
  },

  orderNumber: {
    fontSize: 28,
    fontWeight: 900,
    margin: "12px 0 5px",
    color: "#111111",
  },

  total: {
    fontSize: 29,
    fontWeight: 900,
    color: "#111111",
    marginTop: 7,
  },

  greyText: {
    color: "#777777",
    fontSize: 12,
    lineHeight: 1.6,
  },

  customerDetails: {
    marginTop: 20,
    paddingTop: 16,
    borderTop: "1px solid #EEEEEE",
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: 900,
    color: "#888888",
    letterSpacing: 0.7,
    marginBottom: 12,
  },

  infoLine: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 15,
    padding: "7px 0",
    fontSize: 13,
    lineHeight: 1.5,
  },

  items: {
    background: "#F8F9FA",
    border: "1px solid #ECEDEF",
    borderRadius: 12,
    padding: 15,
    marginTop: 18,
  },

  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: 11,
    padding: "8px 0",
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.5,
  },

  quantity: {
    background: "#FFD400",
    color: "#111111",
    minWidth: 29,
    height: 26,
    borderRadius: 6,
    display: "grid",
    placeItems: "center",
    fontSize: 12,
    fontWeight: 900,
    flexShrink: 0,
  },

  orderBreakdown: {
    marginTop: 18,
    borderTop: "1px solid #EEEEEE",
    paddingTop: 11,
  },

  breakdownRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    padding: "7px 0",
    fontSize: 13,
    color: "#5B5B5B",
  },

  breakdownTotal: {
    display: "flex",
    justifyContent: "space-between",
    gap: 15,
    padding: "14px 0 0",
    marginTop: 9,
    borderTop: "2px solid #111111",
    fontSize: 15,
    fontWeight: 900,
  },

  actions: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
    marginTop: 22,
  },

  acceptButton: {
    width: "100%",
    minHeight: 53,
    background: "#111111",
    color: "#FFFFFF",
    border: "2px solid #111111",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
  },

  rejectButton: {
    width: "100%",
    minHeight: 53,
    background: "#FFD400",
    color: "#111111",
    border: "2px solid #FFD400",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
  },

  waiting: {
    background: "#FFFFFF",
    borderRadius: 16,
    padding: "42px 24px",
    textAlign: "center",
    marginBottom: 24,
    border: "1px solid #ECEDEF",
  },

  tick: {
    width: 60,
    height: 60,
    borderRadius: "50%",
    background: "#FFF2B0",
    color: "#111111",
    display: "grid",
    placeItems: "center",
    margin: "0 auto 17px",
    fontSize: 28,
    fontWeight: 900,
  },

  waitingTitle: {
    fontSize: 21,
    margin: "0 0 10px",
  },

  panel: {
    background: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    border: "1px solid #E9EAEC",
    marginBottom: 20,
    boxShadow: "0 3px 14px rgba(0,0,0,0.025)",
  },

  titleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },

  titleGroup: {
    display: "flex",
    alignItems: "center",
    gap: 9,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: 900,
    margin: 0,
    color: "#151515",
  },

  count: {
    background: "#FFF0A3",
    color: "#111111",
    minWidth: 25,
    height: 25,
    padding: "0 7px",
    borderRadius: 30,
    display: "grid",
    placeItems: "center",
    fontSize: 12,
    fontWeight: 900,
  },

  viewAllButton: {
    background: "transparent",
    border: 0,
    color: "#111111",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  emptyText: {
    color: "#888888",
    fontSize: 13,
    padding: "10px 0",
  },

  previousOrderButton: {
    width: "100%",
    background: "#FFFFFF",
    border: 0,
    borderTop: "1px solid #F0F0F0",
    padding: "17px 0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    cursor: "pointer",
    color: "#111111",
    fontFamily: "inherit",
    textAlign: "left",
  },

  previousOrderLeft: {
    flex: 1,
    minWidth: 0,
  },

  previousOrderNumber: {
    display: "block",
    fontSize: 16,
    marginBottom: 3,
  },

  previousOrderType: {
    fontSize: 10,
    fontWeight: 900,
    color: "#555555",
    marginTop: 7,
  },

  previousOrderRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 8,
    flexShrink: 0,
  },

  previousOrderAmount: {
    fontSize: 16,
    fontWeight: 900,
  },

  rowChevron: {
    color: "#AAAAAA",
    fontSize: 25,
    paddingLeft: 2,
  },

  acceptedBadge: {
    display: "inline-block",
    background: "#E6F6EC",
    color: "#14823B",
    padding: "6px 9px",
    borderRadius: 20,
    fontWeight: 900,
    fontSize: 10,
    whiteSpace: "nowrap",
  },

  rejectedBadge: {
    display: "inline-block",
    background: "#FDECEC",
    color: "#B42318",
    padding: "6px 9px",
    borderRadius: 20,
    fontWeight: 900,
    fontSize: 10,
    whiteSpace: "nowrap",
  },

  expectedBadge: {
    display: "inline-block",
    background: "#FFF4C2",
    color: "#765800",
    padding: "6px 9px",
    borderRadius: 20,
    fontWeight: 900,
    fontSize: 10,
    whiteSpace: "nowrap",
  },

  weekSelector: {
    background: "#FFFFFF",
    border: "1px solid #E9EAEC",
    borderRadius: 14,
    padding: "17px 18px",
    marginBottom: 18,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },

  weekSelectorTitle: {
    fontSize: 11,
    fontWeight: 900,
    color: "#777777",
    marginBottom: 8,
  },

  weekSelectorDate: {
    fontSize: 14,
    fontWeight: 900,
  },

  weekSelectorIcon: {
    color: "#16803C",
    fontSize: 19,
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 13,
    marginBottom: 15,
  },

  paymentCard: {
    background: "#151515",
    color: "#FFFFFF",
    borderRadius: 14,
    padding: 19,
    minHeight: 145,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
  },

  highlightPaymentCard: {
    background: "#FFD400",
    color: "#111111",
    borderRadius: 14,
    padding: 19,
    minHeight: 145,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
  },

  paymentIcon: {
    color: "#FFD400",
    fontSize: 24,
    fontWeight: 900,
    marginBottom: 15,
  },

  paymentCardTitle: {
    fontSize: 10,
    fontWeight: 900,
    color: "#BDBDBD",
    letterSpacing: 0.5,
    marginBottom: 9,
  },

  highlightCardTitle: {
    fontSize: 10,
    fontWeight: 900,
    color: "#333333",
    letterSpacing: 0.5,
    marginBottom: 9,
  },

  paymentCardValue: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: 900,
    letterSpacing: -0.6,
    overflowWrap: "anywhere",
  },

  highlightCardValue: {
    color: "#111111",
    fontSize: 30,
    fontWeight: 900,
    letterSpacing: -0.6,
    overflowWrap: "anywhere",
  },

  paymentCardSubtitle: {
    fontSize: 10,
    color: "#BDBDBD",
    marginTop: 7,
    lineHeight: 1.4,
  },

  secondaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 13,
    marginBottom: 18,
  },

  paidCard: {
    background: "#FFF5CB",
    border: "1px solid #F8E8A0",
    borderRadius: 14,
    padding: 18,
  },

  nextPayoutCard: {
    background: "#ECEEF1",
    border: "1px solid #E4E6E9",
    borderRadius: 14,
    padding: 18,
  },

  secondaryCardLabel: {
    fontSize: 10,
    fontWeight: 900,
    color: "#555555",
    lineHeight: 1.4,
    marginBottom: 12,
  },

  secondaryCardValue: {
    fontSize: 24,
    fontWeight: 900,
    color: "#111111",
    overflowWrap: "anywhere",
  },

  secondaryCardDate: {
    color: "#666666",
    fontSize: 11,
    marginTop: 10,
    lineHeight: 1.5,
  },

  paymentNote: {
    background: "#FFFFFF",
    border: "1px solid #E9EAEC",
    borderRadius: 14,
    padding: 19,
    marginBottom: 20,
    fontSize: 13,
  },

  paymentNoteRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 15,
    paddingTop: 14,
    color: "#555555",
  },

  paymentDisclaimer: {
    fontSize: 11,
    color: "#888888",
    lineHeight: 1.7,
    margin: "16px 0 0",
    paddingTop: 13,
    borderTop: "1px solid #EEEEEE",
  },

  historyRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "17px 0",
    borderTop: "1px solid #EEEEEE",
  },

  historyRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 7,
    flexShrink: 0,
  },

  historyDates: {
    fontSize: 13,
    display: "block",
    marginBottom: 4,
  },

  historyAmount: {
    fontSize: 18,
    color: "#111111",
  },

  historyCount: {
    fontSize: 11,
    color: "#777777",
    marginTop: 6,
  },

  accountSectionHeading: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 15,
  },

  accountSectionIcon: {
    width: 34,
    height: 34,
    background: "#FFF2B6",
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    color: "#111111",
    fontWeight: 900,
    fontSize: 18,
  },

  accountRow: {
    padding: "15px 0",
    borderBottom: "1px solid #EEEEEE",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 15,
  },

  accountLabel: {
    color: "#777777",
    fontSize: 12,
    flexShrink: 0,
  },

  accountValue: {
    textAlign: "right",
    fontSize: 12,
    fontWeight: 800,
    overflowWrap: "anywhere",
  },

  settingRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "17px 0",
    borderTop: "1px solid #EEEEEE",
  },

  settingTitle: {
    fontSize: 13,
    fontWeight: 900,
  },

  settingDescription: {
    color: "#888888",
    fontSize: 12,
    lineHeight: 1.6,
    margin: "5px 0 0",
  },

  pauseSmallButton: {
    background: "#111111",
    color: "#FFFFFF",
    border: 0,
    borderRadius: 9,
    padding: "11px 14px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  resumeSmallButton: {
    background: "#FFD400",
    color: "#111111",
    border: 0,
    borderRadius: 9,
    padding: "11px 14px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  toggleTrack: {
    width: 51,
    height: 29,
    border: 0,
    borderRadius: 30,
    padding: 3,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
  },

  toggleKnob: {
    width: 22,
    height: 22,
    background: "#FFFFFF",
    borderRadius: "50%",
    boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
    transition: "transform 0.2s",
  },

  logoutButton: {
    display: "inline-block",
    background: "#FFFFFF",
    color: "#C22C2C",
    textDecoration: "none",
    border: "1px solid #F0B5B5",
    borderRadius: 10,
    padding: "13px 20px",
    fontSize: 12,
    fontWeight: 900,
    marginTop: 17,
  },

  bottomNav: {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%)",
    bottom: 0,
    width: "min(100%, 950px)",
    background: "#111111",
    borderTop: "3px solid #FFD400",
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    zIndex: 50,
    boxShadow: "0 -4px 25px rgba(0,0,0,0.12)",
  },

  activeNav: {
    position: "relative",
    background: "#111111",
    color: "#FFD400",
    border: 0,
    borderTop: "3px solid #FFD400",
    marginTop: -3,
    minHeight: 76,
    padding: "11px 5px",
    fontWeight: 900,
    fontSize: 10,
    letterSpacing: 0.4,
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },

  navButton: {
    position: "relative",
    background: "#111111",
    color: "#AFAFAF",
    border: 0,
    minHeight: 76,
    padding: "11px 5px",
    fontWeight: 900,
    fontSize: 10,
    letterSpacing: 0.4,
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },

  navIcon: {
    fontSize: 23,
    lineHeight: 1,
  },

  navCount: {
    position: "absolute",
    top: 7,
    right: "24%",
    background: "#FFD400",
    color: "#111111",
    borderRadius: 20,
    minWidth: 18,
    height: 18,
    padding: "0 4px",
    display: "grid",
    placeItems: "center",
    fontSize: 10,
  },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    overflowY: "auto",
  },

  orderModal: {
    position: "relative",
    width: "100%",
    maxWidth: 680,
    maxHeight: "90vh",
    overflowY: "auto",
    background: "#FFFFFF",
    borderRadius: 18,
    padding: 23,
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    borderTop: "5px solid #FFD400",
  },

  closeButton: {
    position: "absolute",
    top: 12,
    right: 14,
    width: 38,
    height: 38,
    borderRadius: "50%",
    border: 0,
    background: "#111111",
    color: "#FFFFFF",
    fontSize: 25,
    cursor: "pointer",
  },

  modalHeading: {
    color: "#111111",
    fontWeight: 900,
    letterSpacing: 1,
    marginBottom: 22,
    paddingRight: 45,
  },

  modalDoneButton: {
    width: "100%",
    marginTop: 24,
    background: "#FFD400",
    color: "#111111",
    border: 0,
    borderRadius: 10,
    padding: "15px 20px",
    fontWeight: 900,
    cursor: "pointer",
  },
};