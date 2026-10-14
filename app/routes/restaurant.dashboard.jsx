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
    <div
      style={
        pickup
          ? styles.pickupBadge
          : styles.deliveryBadge
      }
    >
      {pickup ? "🛍 PICKUP" : "🚗 DELIVERY"}
    </div>
  );
}

function OrderDetails({
  order,
  showStatus = false,
}) {
  if (!order) {
    return null;
  }

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
            {String(
              order.status || "",
            ).toUpperCase()}
          </span>
        </div>
      )}

      <div style={styles.customerDetails}>
        <div>
          <strong>Customer:</strong>{" "}
          {order.customer || "Customer"}
        </div>

        {order.customerPhone && (
          <div>
            <strong>Phone:</strong>{" "}
            {order.customerPhone}
          </div>
        )}

        {order.customerEmail && (
          <div>
            <strong>Email:</strong>{" "}
            {order.customerEmail}
          </div>
        )}

        {order.orderType === "delivery" &&
          order.customerAddress && (
            <div>
              <strong>Delivery address:</strong>{" "}
              {order.customerAddress}
            </div>
          )}

        {order.orderType === "pickup" &&
          order.pickupLocation && (
            <div>
              <strong>Pickup location:</strong>{" "}
              {order.pickupLocation}
            </div>
          )}
      </div>

      <div style={styles.items}>
        {(order.items || []).map((item, index) => (
          <div key={index} style={styles.item}>
            <span style={styles.quantity}>
              {item.quantity} ×
            </span>{" "}
            {item.name}
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
          <span>Order total</span>
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

  const [orders, setOrders] = useState(
    shopifyOrders || [],
  );

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundUnlocked, setSoundUnlocked] = useState(false);

  const [selectedOrderId, setSelectedOrderId] =
    useState(null);

  const [pendingOrderAction, setPendingOrderAction] =
    useState(null);

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
            ? {
                ...order,
                status: "new",
              }
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
      const savedSetting = window.localStorage.getItem(
        "mdh_order_sound",
      );

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

  const selectedOrder =
    restaurantOrders.find(
      (order) => order.id === selectedOrderId,
    ) || null;

  const paymentWeek = getCurrentPaymentWeek();

  /*
  =========================================================
  VERIFIED SHOPIFY PAYMENT TOTALS

  Do not calculate earnings from the visible order list.
  Use the server's captured-payment summary.
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
    if (!order || orderActionSaving) {
      return;
    }

    const status =
      action === "accept"
        ? "accepted"
        : "rejected";

    setPendingOrderAction({
      orderId: order.id,
      action,
    });

    setOrders((currentOrders) =>
      currentOrders.map((currentOrder) =>
        currentOrder.id === order.id
          ? {
              ...currentOrder,
              status,
            }
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

      if (!AudioContext) {
        return;
      }

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
      console.log(
        "Order sound unavailable",
        error,
      );
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
      if (!soundEnabledRef.current) {
        return;
      }

      try {
        const AudioContext =
          window.AudioContext ||
          window.webkitAudioContext;

        if (!AudioContext) {
          return;
        }

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
      {
        once: true,
        capture: true,
      },
    );

    document.addEventListener(
      "keydown",
      unlockOrderSound,
      {
        once: true,
        capture: true,
      },
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
      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <img
              src="/meal-deal-hub-logo.png"
              alt="Meal Deal Hub"
              style={styles.logo}
            />

            <h1 style={styles.restaurantName}>
              {restaurant.name}
            </h1>

            <div style={styles.location}>
              Restaurant ID: {restaurant.restaurantId}
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

              {soundEnabled ? (
                <button
                  type="button"
                  style={styles.soundOnButton}
                  onClick={disableSound}
                >
                  🔊 ORDER SOUND ON

                  {!soundUnlocked && (
                    <span style={styles.soundHint}>
                      Activates on first tap
                    </span>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  style={styles.orangeButton}
                  onClick={enableSound}
                >
                  🔇 ORDER SOUND OFF
                </button>
              )}
            </section>

            {orderLoadError && (
              <section style={styles.errorPanel}>
                {orderLoadError}
              </section>
            )}

            {firstNewOrder ? (
              <section style={styles.newOrder}>
                <div style={styles.newLabel}>
                  🔔 NEW ORDER
                </div>

                <OrderDetails order={firstNewOrder} />

                <div style={styles.actions}>
                  <button
                    type="button"
                    disabled={orderActionSaving}
                    style={{
                      ...styles.acceptButton,
                      opacity: orderActionSaving
                        ? 0.6
                        : 1,
                      cursor: orderActionSaving
                        ? "not-allowed"
                        : "pointer",
                    }}
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
                      : "✓ ACCEPT ORDER"}
                  </button>

                  <button
                    type="button"
                    disabled={orderActionSaving}
                    style={{
                      ...styles.rejectButton,
                      opacity: orderActionSaving
                        ? 0.6
                        : 1,
                      cursor: orderActionSaving
                        ? "not-allowed"
                        : "pointer",
                    }}
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
                      : "× REJECT ORDER"}
                  </button>
                </div>
              </section>
            ) : (
              <section style={styles.waiting}>
                <div style={styles.tick}>✓</div>

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
                  Previous Orders
                </h2>

                <span style={styles.count}>
                  {previousOrders.length}
                </span>
              </div>

              {previousOrders.length === 0 ? (
                <p style={styles.greyText}>
                  No previous orders.
                </p>
              ) : (
                previousOrders.map((order) => (
                  <button
                    type="button"
                    key={order.id}
                    style={styles.previousOrderButton}
                    onClick={() =>
                      setSelectedOrderId(order.id)
                    }
                  >
                    <div style={{ textAlign: "left" }}>
                      <strong style={{ fontSize: 20 }}>
                        {order.orderNumber}
                      </strong>

                      <div style={styles.greyText}>
                        {order.dateTime}
                      </div>

                      <div
                        style={styles.previousOrderType}
                      >
                        {order.orderType === "pickup"
                          ? "PICKUP"
                          : "DELIVERY"}
                      </div>
                    </div>

                    <div style={styles.previousOrderRight}>
                      <strong>
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
                          order.status,
                        ).toUpperCase()}
                      </span>

                      <span style={styles.viewOrder}>
                        VIEW ›
                      </span>
                    </div>
                  </button>
                ))
              )}
            </section>
          </>
        )}

        {activeTab === "payments" && (
          <>
            <section style={styles.pageHeading}>
              <h2 style={{ margin: 0 }}>
                Payments
              </h2>

              <p style={styles.greyText}>
                Your Meal Deal Hub earnings and payouts.
              </p>
            </section>

            <div style={styles.grid}>
              <PaymentCard
                title="MEAL DEAL SALES"
                value={money(acceptedFoodSales)}
              />

              <PaymentCard
                title="DELIVERY"
                value={money(deliveryIncome)}
              />

              <PaymentCard
                title="COMMISSION"
                value={money(commission)}
              />

              <PaymentCard
                title="YOU RECEIVE"
                value={money(restaurantEarnings)}
              />

              <PaymentCard
                title="PAID THIS MONTH"
                value={money(paidThisMonth)}
              />
            </div>

            <section style={styles.payout}>
              <div style={styles.smallWhite}>
                NEXT PAYOUT
              </div>

              <div style={styles.payoutAmount}>
                {money(restaurantEarnings)}
              </div>

              <p>
                Payout period:{" "}
                <strong>
                  {paymentWeek.startLabel}
                  {" – "}
                  {paymentWeek.endLabel}
                </strong>
              </p>

              <p>
                Standard payout date:{" "}
                <strong>
                  {paymentWeek.payoutLabel}
                </strong>
              </p>

              <p style={styles.payoutNote}>
                The actual payment date may change for
                bank holidays. Payments are transferred
                manually after reconciliation.
              </p>

              <p>
                Verified accepted orders this week:{" "}
                <strong>
                  {verifiedAcceptedOrderCount}
                </strong>
              </p>

              <p>
                Meal Deal Hub commission:{" "}
                <strong>
                  {money(commission)}
                </strong>
              </p>

              <p>
                Service fees retained by Meal Deal Hub:{" "}
                <strong>
                  {money(serviceFees)}
                </strong>
              </p>
            </section>

            <section style={styles.panel}>
              <h2 style={{ marginTop: 0 }}>
                Payout History
              </h2>

              {payoutHistory.length === 0 ? (
                <p style={styles.greyText}>
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
                      <div>
                        <strong>
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
                            ? "Paid: "
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
            <section style={styles.pageHeading}>
              <h2 style={{ margin: 0 }}>
                Restaurant Account
              </h2>

              <p style={styles.greyText}>
                Your Meal Deal Hub restaurant account.
              </p>
            </section>

            <section style={styles.panel}>
              <AccountRow
                label="Restaurant"
                value={restaurant.name}
              />

              <AccountRow
                label="Restaurant ID"
                value={restaurant.restaurantId}
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
                Temporarily stop new Meal Deal Hub orders
                whenever your restaurant is too busy.
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
                Sign out of this restaurant terminal.
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
            onClick={() => setActiveTab("orders")}
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
            onClick={() => setActiveTab("payments")}
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
            onClick={() => setActiveTab("account")}
            style={
              activeTab === "account"
                ? styles.activeNav
                : styles.navButton
            }
          >
            ⚙ ACCOUNT
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
                type="button"
                style={styles.closeButton}
                onClick={() =>
                  setSelectedOrderId(null)
                }
              >
                ×
              </button>

              <div style={styles.modalHeading}>
                ORDER DETAILS
              </div>

              <OrderDetails
                order={selectedOrder}
                showStatus={true}
              />

              <button
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
      </div>
    </main>
  );
}

/*
=========================================================
SMALL COMPONENTS
=========================================================
*/

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

/*
=========================================================
STYLES
=========================================================
*/

const styles = {
  page: {
    minHeight: "100vh",
    background: "#F5F5F5",
    fontFamily: "Arial, Helvetica, sans-serif",
    color: "#111111",
    padding: 20,
  },

  container: {
    maxWidth: 900,
    margin: "0 auto",
  },

  header: {
    background: "#111111",
    color: "#FFFFFF",
    borderRadius: 18,
    padding: 24,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 20,
    flexWrap: "wrap",
    marginBottom: 15,
    borderBottom: "5px solid #FFD400",
  },

  logo: {
    display: "block",
    width: 95,
    height: 95,
    objectFit: "contain",
    borderRadius: 18,
    marginBottom: 12,
  },

  restaurantName: {
    margin: "0 0 6px",
    fontSize: 28,
    color: "#FFFFFF",
  },

  location: {
    color: "#CCCCCC",
    fontSize: 13,
  },

  openBadge: {
    background: "#FFD400",
    color: "#111111",
    padding: "10px 14px",
    borderRadius: 30,
    fontWeight: 800,
  },

  pausedBadge: {
    background: "#FDECEC",
    color: "#B42318",
    padding: "10px 14px",
    borderRadius: 30,
    fontWeight: 800,
  },

  controls: {
    background: "#FFFFFF",
    padding: 15,
    borderRadius: 14,
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 15,
    border: "1px solid #DDDDDD",
  },

  errorPanel: {
    background: "#FDECEC",
    color: "#B42318",
    border: "1px solid #F5B9B4",
    borderRadius: 12,
    padding: 16,
    marginBottom: 15,
    fontWeight: 700,
  },

  darkButton: {
    background: "#111111",
    color: "#FFFFFF",
    border: 0,
    borderRadius: 10,
    padding: "14px 20px",
    fontWeight: 800,
    cursor: "pointer",
  },

  orangeButton: {
    background: "#FFD400",
    color: "#111111",
    border: "2px solid #111111",
    borderRadius: 10,
    padding: "14px 20px",
    fontWeight: 800,
    cursor: "pointer",
  },

  soundOnButton: {
    background: "#FFF9D6",
    color: "#111111",
    border: "2px solid #FFD400",
    borderRadius: 10,
    padding: "10px 20px",
    fontWeight: 800,
    cursor: "pointer",
  },

  soundHint: {
    display: "block",
    fontSize: 11,
    marginTop: 3,
    fontWeight: 600,
  },

  newOrder: {
    background: "#FFFFFF",
    border: "4px solid #FFD400",
    borderRadius: 18,
    padding: 25,
    marginBottom: 18,
  },

  newLabel: {
    color: "#111111",
    background: "#FFD400",
    display: "inline-block",
    padding: "9px 14px",
    borderRadius: 8,
    fontSize: 20,
    fontWeight: 900,
    marginBottom: 14,
  },

  detailTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 20,
    flexWrap: "wrap",
    alignItems: "flex-start",
  },

  pickupBadge: {
    display: "inline-block",
    background: "#FFF9D6",
    color: "#111111",
    border: "2px solid #FFD400",
    borderRadius: 30,
    padding: "8px 14px",
    fontSize: 15,
    fontWeight: 900,
    letterSpacing: 0.5,
  },

  deliveryBadge: {
    display: "inline-block",
    background: "#F0F0F0",
    color: "#111111",
    border: "2px solid #111111",
    borderRadius: 30,
    padding: "8px 14px",
    fontSize: 15,
    fontWeight: 900,
    letterSpacing: 0.5,
  },

  orderNumber: {
    fontSize: 32,
    margin: "10px 0 4px",
    color: "#111111",
  },

  total: {
    fontSize: 38,
    fontWeight: 900,
    color: "#111111",
  },

  customerDetails: {
    marginTop: 22,
    marginBottom: 16,
    lineHeight: 1.7,
    fontSize: 16,
  },

  items: {
    background: "#FFFBE6",
    borderRadius: 12,
    padding: 18,
    marginTop: 18,
    border: "1px solid #F3E6A1",
  },

  item: {
    fontSize: 21,
    fontWeight: 700,
    padding: "8px 0",
  },

  quantity: {
    color: "#111111",
    fontWeight: 900,
  },

  orderBreakdown: {
    marginTop: 18,
    borderTop: "1px solid #EEEEEE",
    paddingTop: 12,
  },

  breakdownRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 20,
    padding: "7px 0",
  },

  breakdownTotal: {
    display: "flex",
    justifyContent: "space-between",
    gap: 20,
    padding: "12px 0 0",
    marginTop: 6,
    borderTop: "2px solid #111111",
    fontSize: 18,
  },

  actions: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    marginTop: 25,
  },

  acceptButton: {
    width: "100%",
    minHeight: 64,
    background: "#FFD400",
    color: "#111111",
    border: "2px solid #111111",
    borderRadius: 12,
    fontSize: 18,
    fontWeight: 900,
    cursor: "pointer",
  },

  rejectButton: {
    width: "100%",
    minHeight: 64,
    background: "#FFFFFF",
    color: "#B42318",
    border: "2px solid #B42318",
    borderRadius: 12,
    fontSize: 18,
    fontWeight: 900,
    cursor: "pointer",
  },

  waiting: {
    background: "#FFFFFF",
    borderRadius: 18,
    padding: 50,
    textAlign: "center",
    marginBottom: 18,
    border: "1px solid #DDDDDD",
  },

  tick: {
    width: 55,
    height: 55,
    borderRadius: "50%",
    background: "#FFD400",
    color: "#111111",
    display: "grid",
    placeItems: "center",
    margin: "0 auto",
    fontSize: 28,
    fontWeight: 900,
  },

  panel: {
    background: "#FFFFFF",
    borderRadius: 16,
    padding: 22,
    border: "1px solid #DDDDDD",
    marginBottom: 18,
  },

  pageHeading: {
    background: "#FFFFFF",
    borderRadius: 16,
    padding: 22,
    border: "1px solid #DDDDDD",
    borderLeft: "5px solid #FFD400",
    marginBottom: 18,
  },

  titleRow: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    marginBottom: 15,
  },

  count: {
    background: "#FFD400",
    color: "#111111",
    minWidth: 26,
    height: 26,
    padding: "0 7px",
    borderRadius: 30,
    display: "grid",
    placeItems: "center",
    fontWeight: 800,
  },

  previousOrderButton: {
    width: "100%",
    background: "#FFFFFF",
    border: 0,
    borderTop: "1px solid #EEEEEE",
    padding: "18px 0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 20,
    cursor: "pointer",
    color: "#111111",
    fontFamily: "inherit",
  },

  previousOrderRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 7,
  },

  previousOrderType: {
    fontSize: 12,
    fontWeight: 900,
    color: "#111111",
    marginTop: 5,
  },

  viewOrder: {
    color: "#111111",
    fontWeight: 900,
    fontSize: 12,
    background: "#FFD400",
    padding: "5px 9px",
    borderRadius: 6,
  },

  acceptedBadge: {
    display: "inline-block",
    background: "#E8F5E9",
    color: "#137333",
    padding: "8px 12px",
    borderRadius: 30,
    fontWeight: 800,
    fontSize: 12,
  },

  rejectedBadge: {
    display: "inline-block",
    background: "#FDECEC",
    color: "#B42318",
    padding: "8px 12px",
    borderRadius: 30,
    fontWeight: 800,
    fontSize: 12,
  },

  expectedBadge: {
    display: "inline-block",
    background: "#FFF9D6",
    color: "#111111",
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
    background: "#FFFFFF",
    border: "1px solid #DDDDDD",
    borderTop: "5px solid #FFD400",
    borderRadius: 14,
    padding: 22,
  },

  cardTitle: {
    color: "#666666",
    fontSize: 13,
    marginBottom: 10,
    fontWeight: 800,
  },

  cardValue: {
    fontSize: 28,
    fontWeight: 900,
    color: "#111111",
  },

  payout: {
    background: "#111111",
    color: "#FFFFFF",
    borderRadius: 16,
    padding: 25,
    marginBottom: 18,
    borderBottom: "5px solid #FFD400",
  },

  smallWhite: {
    fontSize: 13,
    fontWeight: 800,
    color: "#FFFFFF",
  },

  payoutAmount: {
    color: "#FFD400",
    fontSize: 40,
    fontWeight: 900,
    margin: "10px 0 20px",
  },

  payoutNote: {
    color: "#CCCCCC",
    fontSize: 13,
    lineHeight: 1.6,
  },

  historyRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
    padding: "18px 0",
    borderTop: "1px solid #EEEEEE",
  },

  historyRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 8,
  },

  historyAmount: {
    fontSize: 23,
    color: "#111111",
  },

  historyCount: {
    fontSize: 12,
    color: "#666666",
    marginTop: 5,
  },

  accountRow: {
    padding: "15px 0",
    borderBottom: "1px solid #EEEEEE",
    display: "flex",
    justifyContent: "space-between",
    gap: 20,
  },

  greyText: {
    color: "#666666",
  },

  logoutButton: {
    display: "inline-block",
    background: "#111111",
    color: "#FFFFFF",
    textDecoration: "none",
    borderRadius: 10,
    padding: "14px 22px",
    fontWeight: 800,
  },

  bottomNav: {
    background: "#111111",
    borderRadius: 14,
    padding: 8,
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 6,
    position: "sticky",
    bottom: 10,
    zIndex: 20,
    border: "1px solid #333333",
  },

  activeNav: {
    background: "#FFD400",
    color: "#111111",
    border: 0,
    borderRadius: 9,
    padding: "16px 8px",
    fontWeight: 900,
    cursor: "pointer",
  },

  navButton: {
    background: "transparent",
    color: "#FFFFFF",
    border: 0,
    borderRadius: 9,
    padding: "16px 8px",
    fontWeight: 900,
    cursor: "pointer",
  },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.65)",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    overflowY: "auto",
  },

  orderModal: {
    position: "relative",
    width: "100%",
    maxWidth: 720,
    maxHeight: "90vh",
    overflowY: "auto",
    background: "#FFFFFF",
    borderRadius: 18,
    padding: 26,
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    borderTop: "5px solid #FFD400",
  },

  closeButton: {
    position: "absolute",
    top: 12,
    right: 14,
    width: 42,
    height: 42,
    borderRadius: "50%",
    border: 0,
    background: "#111111",
    color: "#FFFFFF",
    fontSize: 26,
    cursor: "pointer",
  },

  modalHeading: {
    color: "#111111",
    fontWeight: 900,
    letterSpacing: 1,
    marginBottom: 18,
    paddingRight: 50,
  },

  modalDoneButton: {
    width: "100%",
    marginTop: 24,
    background: "#FFD400",
    color: "#111111",
    border: "2px solid #111111",
    borderRadius: 10,
    padding: "15px 20px",
    fontWeight: 900,
    cursor: "pointer",
  },
};