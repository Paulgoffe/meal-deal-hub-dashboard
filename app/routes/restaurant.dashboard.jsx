import {
  Form,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import {
  useEffect,
  useRef,
  useState,
} from "react";
import crypto from "node:crypto";
import db from "../db.server";
import shopify from "../shopify.server";

const COOKIE_NAME =
  "mdh_restaurant_session";

const SHOP_DOMAIN =
  "bite-pfyaja4s.myshopify.com";

function getSessionSecret() {
  return (
    process.env.RESTAURANT_SESSION_SECRET ||
    "development-only-change-before-production"
  );
}

function sign(value) {
  return crypto
    .createHmac(
      "sha256",
      getSessionSecret(),
    )
    .update(value)
    .digest("hex");
}

function readCookie(request) {
  const cookieHeader =
    request.headers.get("Cookie") || "";

  const cookies = Object.fromEntries(
    cookieHeader
      .split(";")
      .map((cookie) =>
        cookie.trim(),
      )
      .filter(Boolean)
      .map((cookie) => {
        const index =
          cookie.indexOf("=");

        if (index === -1) {
          return [cookie, ""];
        }

        return [
          cookie.slice(0, index),
          cookie.slice(index + 1),
        ];
      }),
  );

  return (
    cookies[COOKIE_NAME] || null
  );
}

function verifySession(sessionValue) {
  if (!sessionValue) {
    return null;
  }

  const [userId, signature] =
    sessionValue.split(".");

  if (!userId || !signature) {
    return null;
  }

  const expectedSignature =
    sign(userId);

  const signatureBuffer =
    Buffer.from(signature);

  const expectedBuffer =
    Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !==
    expectedBuffer.length
  ) {
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

  const parsedUserId =
    Number(userId);

  return Number.isInteger(
    parsedUserId,
  )
    ? parsedUserId
    : null;
}

async function getAuthenticatedUser(
  request,
) {
  const userId =
    verifySession(
      readCookie(request),
    );

  if (!userId) {
    return null;
  }

  const user =
    await db.restaurantUser.findUnique(
      {
        where: {
          id: userId,
        },

        include: {
          restaurant: true,
        },
      },
    );

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

function getAttribute(
  attributes,
  key,
) {
  return (
    attributes?.find(
      (attribute) =>
        attribute.key === key,
    )?.value || ""
  );
}

function londonTime(dateString) {
  if (!dateString) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone:
        "Europe/London",

      hour: "2-digit",
      minute: "2-digit",
    },
  ).format(
    new Date(dateString),
  );
}

function londonDateLabel(
  dateString,
) {
  if (!dateString) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone:
        "Europe/London",

      day: "numeric",
      month: "short",
      year: "numeric",
    },
  ).format(
    new Date(dateString),
  );
}

function londonDateTimeLabel(
  dateString,
) {
  if (!dateString) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone:
        "Europe/London",

      day: "numeric",
      month: "short",
      year: "numeric",

      hour: "2-digit",
      minute: "2-digit",
    },
  ).format(
    new Date(dateString),
  );
}

function londonDateParts(
  date = new Date(),
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone:
          "Europe/London",

        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
      },
    ).formatToParts(date);

  const get = (type) =>
    parts.find(
      (part) =>
        part.type === type,
    )?.value || "";

  return {
    year: Number(
      get("year"),
    ),

    month: Number(
      get("month"),
    ),

    day: Number(
      get("day"),
    ),

    weekday:
      get("weekday"),
  };
}

function dateKeyFromParts(
  year,
  month,
  day,
) {
  return [
    String(year).padStart(
      4,
      "0",
    ),

    String(month).padStart(
      2,
      "0",
    ),

    String(day).padStart(
      2,
      "0",
    ),
  ].join("-");
}

function londonDateKey(
  dateString,
) {
  if (!dateString) {
    return "";
  }

  const parts =
    londonDateParts(
      new Date(dateString),
    );

  return dateKeyFromParts(
    parts.year,
    parts.month,
    parts.day,
  );
}

function calendarDateFromKey(
  dateKey,
) {
  const [
    year,
    month,
    day,
  ] = String(dateKey)
    .split("-")
    .map(Number);

  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
    ),
  );
}

function calendarKey(date) {
  return dateKeyFromParts(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

function displayCalendarDate(
  date,
) {
  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    },
  ).format(date);
}

function getPaymentWeekFromDateKey(
  dateKey,
) {
  const date =
    calendarDateFromKey(
      dateKey,
    );

  /*
    JavaScript:
    Sunday = 0
    Monday = 1
    ...
    Saturday = 6
  */
  const day =
    date.getUTCDay();

  const daysSinceMonday =
    day === 0
      ? 6
      : day - 1;

  const monday =
    new Date(date);

  monday.setUTCDate(
    date.getUTCDate() -
      daysSinceMonday,
  );

  const sunday =
    new Date(monday);

  sunday.setUTCDate(
    monday.getUTCDate() + 6,
  );

  const payout =
    new Date(monday);

  payout.setUTCDate(
    monday.getUTCDate() + 9,
  );

  return {
    startKey:
      calendarKey(monday),

    endKey:
      calendarKey(sunday),

    payoutKey:
      calendarKey(payout),

    startLabel:
      displayCalendarDate(
        monday,
      ),

    endLabel:
      displayCalendarDate(
        sunday,
      ),

    payoutLabel:
      displayCalendarDate(
        payout,
      ),

    startDate:
      monday,

    endDate:
      sunday,

    payoutDate:
      payout,
  };
}

function getCurrentPaymentWeek() {
  const londonNow =
    londonDateParts();

  const todayKey =
    dateKeyFromParts(
      londonNow.year,
      londonNow.month,
      londonNow.day,
    );

  return getPaymentWeekFromDateKey(
    todayKey,
  );
}

function getDeliveryType(
  shippingLine,
  shippingAddress,
) {
  const methodText = [
    shippingLine?.title,
    shippingLine?.code,
    shippingLine?.deliveryCategory,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const pickupWords = [
    "pickup",
    "pick up",
    "pick-up",
    "collection",
    "collect",
    "click and collect",
    "local pickup",
  ];

  const isPickup =
    pickupWords.some(
      (word) =>
        methodText.includes(
          word,
        ),
    );

  if (isPickup) {
    return "PICKUP";
  }

  /*
    Local pickup orders can sometimes
    have no delivery address.

    We do NOT use a £0 shipping price
    to determine pickup because free
    delivery is still delivery.
  */
  if (
    !shippingAddress &&
    !shippingLine
  ) {
    return "PICKUP";
  }

  return "DELIVERY";
}

async function getShopifyOrders(
  restaurantId,
) {
  try {
    const { admin } =
      await shopify.unauthenticated.admin(
        SHOP_DOMAIN,
      );

    const response =
      await admin.graphql(`
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

              lineItems(
                first: 50
              ) {
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

    const result =
      await response.json();

    if (result.errors) {
      console.error(
        "SHOPIFY GRAPHQL ERRORS:",
        result.errors,
      );
    }

    const nodes =
      result.data?.orders
        ?.nodes || [];

    console.log(
      "SHOPIFY ORDERS FOUND:",
      nodes.length,
    );

    return nodes
      .map((order) => {
        const matchingItems =
          order.lineItems.nodes.filter(
            (item) =>
              getAttribute(
                item.customAttributes,
                "_Restaurant ID",
              ) === restaurantId,
          );

        if (
          matchingItems.length === 0
        ) {
          return null;
        }

        const foodTotal =
          matchingItems.reduce(
            (
              total,
              item,
            ) =>
              total +
              Number(
                item
                  .originalTotalSet
                  ?.shopMoney
                  ?.amount || 0,
              ),
            0,
          );

        /*
          Shopify returns the selected
          service-fee variant in the
          line-item name, for example:

          Meal Deal Hub Service Fee - £0.99

          Keep startsWith here.
        */
        const serviceFee =
          order.lineItems.nodes
            .filter(
              (item) =>
                String(
                  item.name ||
                    "",
                ).startsWith(
                  "Meal Deal Hub Service Fee",
                ),
            )
            .reduce(
              (
                total,
                item,
              ) =>
                total +
                Number(
                  item
                    .originalTotalSet
                    ?.shopMoney
                    ?.amount ||
                    0,
                ),
              0,
            );

        const delivery =
          Number(
            order
              .currentShippingPriceSet
              ?.shopMoney
              ?.amount || 0,
          );

        const deliveryType =
          getDeliveryType(
            order.shippingLine,
            order.shippingAddress,
          );

        return {
          id: order.id,

          orderNumber:
            order.name,

          createdAt:
            order.createdAt,

          restaurantId,

          time: londonTime(
            order.createdAt,
          ),

          date:
            londonDateLabel(
              order.createdAt,
            ),

          dateTime:
            londonDateTimeLabel(
              order.createdAt,
            ),

          deliveryType,

          shippingMethod:
            order.shippingLine
              ?.title || "",

          customer:
            [
              order.customer
                ?.firstName,

              order.customer
                ?.lastName,
            ]
              .filter(Boolean)
              .join(" ") ||
            [
              order
                .shippingAddress
                ?.firstName,

              order
                .shippingAddress
                ?.lastName,
            ]
              .filter(Boolean)
              .join(" ") ||
            "Customer",

          customerEmail:
            order.customer
              ?.email || "",

          customerPhone:
            order.customer
              ?.phone ||
            order.shippingAddress
              ?.phone ||
            "",

          customerAddress: [
            order.shippingAddress
              ?.address1,

            order.shippingAddress
              ?.address2,

            order.shippingAddress
              ?.city,

            order.shippingAddress
              ?.province,

            order.shippingAddress
              ?.zip,
          ]
            .filter(Boolean)
            .join(", "),

          items:
            matchingItems.map(
              (item) => ({
                name:
                  item.name,

                quantity:
                  item.quantity,

                total:
                  Number(
                    item
                      .originalTotalSet
                      ?.shopMoney
                      ?.amount ||
                      0,
                  ),
              }),
            ),

          foodTotal,

          delivery,

          serviceFee,

          total:
            Number(
              order
                .currentTotalPriceSet
                ?.shopMoney
                ?.amount || 0,
            ),

          financialStatus:
            order
              .displayFinancialStatus,

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

async function saveCompletedPayoutWeeks(
  restaurantDbId,
  orders,
) {
  try {
    const currentWeek =
      getCurrentPaymentWeek();

    const completedAcceptedOrders =
      orders.filter(
        (order) => {
          if (
            order.status !==
            "accepted"
          ) {
            return false;
          }

          const orderDate =
            londonDateKey(
              order.createdAt,
            );

          return (
            orderDate &&
            orderDate <
              currentWeek.startKey
          );
        },
      );

    const weekGroups =
      new Map();

    for (
      const order of
      completedAcceptedOrders
    ) {
      const orderDate =
        londonDateKey(
          order.createdAt,
        );

      const week =
        getPaymentWeekFromDateKey(
          orderDate,
        );

      if (
        !weekGroups.has(
          week.startKey,
        )
      ) {
        weekGroups.set(
          week.startKey,
          {
            week,
            orders: [],
          },
        );
      }

      weekGroups
        .get(week.startKey)
        .orders.push(order);
    }

    for (
      const {
        week,
        orders:
          weekOrders,
      } of weekGroups.values()
    ) {
      const foodSales =
        weekOrders.reduce(
          (
            total,
            order,
          ) =>
            total +
            Number(
              order.foodTotal ||
                0,
            ),
          0,
        );

      const deliveryIncome =
        weekOrders.reduce(
          (
            total,
            order,
          ) =>
            total +
            Number(
              order.delivery ||
                0,
            ),
          0,
        );

      const serviceFees =
        weekOrders.reduce(
          (
            total,
            order,
          ) =>
            total +
            Number(
              order.serviceFee ||
                0,
            ),
          0,
        );

      const commission =
        foodSales * 0.1;

      const restaurantEarnings =
        foodSales * 0.9 +
        deliveryIncome;

      await db.restaurantPayout.upsert(
        {
          where: {
            restaurantId_weekStart:
              {
                restaurantId:
                  restaurantDbId,

                weekStart:
                  week.startDate,
              },
          },

          update: {
            weekEnd:
              week.endDate,

            payoutDate:
              week.payoutDate,

            foodSales,

            deliveryIncome,

            commission,

            serviceFees,

            restaurantEarnings,

            acceptedOrderCount:
              weekOrders.length,
          },

          create: {
            restaurantId:
              restaurantDbId,

            weekStart:
              week.startDate,

            weekEnd:
              week.endDate,

            payoutDate:
              week.payoutDate,

            foodSales,

            deliveryIncome,

            commission,

            serviceFees,

            restaurantEarnings,

            acceptedOrderCount:
              weekOrders.length,

            status:
              "expected",
          },
        },
      );
    }
  } catch (error) {
    /*
      Do not break the restaurant
      dashboard if payout history
      cannot be refreshed.
    */
    console.error(
      "Meal Deal Hub payout history error:",
      error,
    );
  }
}

export async function loader({
  request,
}) {
  const user =
    await getAuthenticatedUser(
      request,
    );

  if (!user) {
    throw redirect(
      "/restaurant/login",
    );
  }

  const orders =
    await getShopifyOrders(
      user.restaurant
        .restaurantId,
    );

  const decisions =
    await db.orderDecision.findMany(
      {
        where: {
          restaurantId:
            user.restaurant.id,
        },
      },
    );

  const decisionMap =
    new Map(
      decisions.map(
        (decision) => [
          decision.shopifyOrderId,
          decision.status,
        ],
      ),
    );

  const ORDER_MAX_AGE_MS =
    2 * 60 * 60 * 1000;

  const now = Date.now();

  const ordersWithDecisions =
    orders
      .filter(
        (order) => {
          const savedStatus =
            decisionMap.get(
              order.id,
            );

          if (savedStatus) {
            return true;
          }

          return (
            order.createdAt &&
            now -
              new Date(
                order.createdAt,
              ).getTime() <=
              ORDER_MAX_AGE_MS
          );
        },
      )
      .map(
        (order) => {
          const savedStatus =
            decisionMap.get(
              order.id,
            );

          return {
            ...order,

            status:
              savedStatus ||
              order.status,
          };
        },
      );

  /*
    Save finished Monday-Sunday
    payment periods to the database.
  */
  await saveCompletedPayoutWeeks(
    user.restaurant.id,
    ordersWithDecisions,
  );

  const payoutHistoryRaw =
    await db.restaurantPayout.findMany(
      {
        where: {
          restaurantId:
            user.restaurant.id,
        },

        orderBy: {
          weekStart: "desc",
        },

        take: 52,
      },
    );

  /*
    Prisma Decimal values should be
    converted before returning loader
    data to the browser.
  */
  const payoutHistory =
    payoutHistoryRaw.map(
      (payout) => ({
        id: payout.id,

        weekStart:
          payout.weekStart
            .toISOString(),

        weekEnd:
          payout.weekEnd
            .toISOString(),

        payoutDate:
          payout.payoutDate
            .toISOString(),

        foodSales:
          Number(
            payout.foodSales,
          ),

        deliveryIncome:
          Number(
            payout.deliveryIncome,
          ),

        commission:
          Number(
            payout.commission,
          ),

        serviceFees:
          Number(
            payout.serviceFees,
          ),

        restaurantEarnings:
          Number(
            payout
              .restaurantEarnings,
          ),

        acceptedOrderCount:
          payout
            .acceptedOrderCount,

        status:
          payout.status,
      }),
    );

  return {
    user: {
      email: user.email,

      firstName:
        user.firstName,

      lastName:
        user.lastName,
    },

    restaurant: {
      id:
        user.restaurant.id,

      restaurantId:
        user.restaurant
          .restaurantId,

      name:
        user.restaurant.name,

      acceptingOrders:
        user.restaurant
          .acceptingOrders,
    },

    orders:
      ordersWithDecisions,

    payoutHistory,
  };
}

export async function action({
  request,
}) {
  const user =
    await getAuthenticatedUser(
      request,
    );

  if (!user) {
    throw redirect(
      "/restaurant/login",
    );
  }

  const formData =
    await request.formData();

  const intent =
    String(
      formData.get(
        "intent",
      ) || "",
    );

  console.log(
    "ORDER ACTION RECEIVED:",
    {
      intent,

      shopifyOrderId:
        formData.get(
          "shopifyOrderId",
        ),

      orderNumber:
        formData.get(
          "orderNumber",
        ),

      restaurantDbId:
        user.restaurant.id,

      restaurantId:
        user.restaurant
          .restaurantId,
    },
  );

  if (
    intent ===
      "accept-order" ||
    intent ===
      "reject-order"
  ) {
    const shopifyOrderId =
      String(
        formData.get(
          "shopifyOrderId",
        ) || "",
      );

    const orderNumber =
      String(
        formData.get(
          "orderNumber",
        ) || "",
      );

    if (
      !shopifyOrderId ||
      !orderNumber
    ) {
      return {
        success: false,

        message:
          "Order information is missing.",
      };
    }

    const status =
      intent ===
      "accept-order"
        ? "accepted"
        : "rejected";

    await db.orderDecision.upsert(
      {
        where: {
          shopifyOrderId_restaurantId:
            {
              shopifyOrderId,

              restaurantId:
                user.restaurant.id,
            },
        },

        update: {
          status,
          orderNumber,
          decidedAt:
            new Date(),
        },

        create: {
          shopifyOrderId,
          orderNumber,

          restaurantId:
            user.restaurant.id,

          status,
        },
      },
    );

    return {
      success: true,
      orderNumber,
      status,
    };
  }

  if (
    intent ===
    "pause-orders"
  ) {
    await db.restaurant.update(
      {
        where: {
          id:
            user.restaurant.id,
        },

        data: {
          acceptingOrders:
            false,
        },
      },
    );

    return {
      success: true,
    };
  }

  if (
    intent ===
    "resume-orders"
  ) {
    await db.restaurant.update(
      {
        where: {
          id:
            user.restaurant.id,
        },

        data: {
          acceptingOrders:
            true,
        },
      },
    );

    return {
      success: true,
    };
  }

  return {
    success: false,
  };
}

function money(value) {
  return new Intl.NumberFormat(
    "en-GB",
    {
      style: "currency",
      currency: "GBP",
    },
  ).format(
    Number(value || 0),
  );
}

function isCurrentAcceptedOrder(
  order,
) {
  if (
    order.status !==
    "accepted"
  ) {
    return false;
  }

  /*
    Orders accepted today stay under
    Current Orders.

    Older accepted orders move into
    Previous Orders automatically.
  */
  return (
    londonDateKey(
      order.createdAt,
    ) ===
    londonDateKey(
      new Date().toISOString(),
    )
  );
}

export default function RestaurantDashboard() {
  const {
    restaurant,
    user,
    orders: shopifyOrders,
    payoutHistory:
      savedPayoutHistory,
  } = useLoaderData();

  const navigation =
    useNavigation();

  const revalidator =
    useRevalidator();

  const orderFetcher =
    useFetcher();

  useEffect(() => {
    const interval =
      setInterval(() => {
        revalidator.revalidate();
      }, 10000);

    return () =>
      clearInterval(
        interval,
      );
  }, [revalidator]);

  const [
    activeTab,
    setActiveTab,
  ] = useState("orders");

  const [
    orders,
    setOrders,
  ] = useState(
    shopifyOrders || [],
  );

  const [
    soundEnabled,
    setSoundEnabled,
  ] = useState(false);

  const [
    selectedOrder,
    setSelectedOrder,
  ] = useState(null);

  const [
    selectedPayout,
    setSelectedPayout,
  ] = useState(null);

  const audioContextRef =
    useRef(null);

  const alarmTimerRef =
    useRef(null);

  useEffect(() => {
    setOrders(
      shopifyOrders || [],
    );

    if (selectedOrder) {
      const updatedOrder =
        (
          shopifyOrders || []
        ).find(
          (order) =>
            order.id ===
            selectedOrder.id,
        );

      if (updatedOrder) {
        setSelectedOrder(
          updatedOrder,
        );
      }
    }
  }, [shopifyOrders]);

  const restaurantOrders =
    orders.filter(
      (order) =>
        order.restaurantId ===
        restaurant.restaurantId,
    );

  const newOrders =
    restaurantOrders.filter(
      (order) =>
        order.status === "new",
    );

  const acceptedOrders =
    restaurantOrders.filter(
      (order) =>
        order.status ===
        "accepted",
    );

  const currentOrders =
    restaurantOrders.filter(
      isCurrentAcceptedOrder,
    );

  const previousOrders =
    restaurantOrders
      .filter(
        (order) =>
          order.status ===
            "rejected" ||
          (
            order.status ===
              "accepted" &&
            !isCurrentAcceptedOrder(
              order,
            )
          ),
      )
      .sort(
        (a, b) =>
          new Date(
            b.createdAt,
          ).getTime() -
          new Date(
            a.createdAt,
          ).getTime(),
      );

  const paymentWeek =
    getCurrentPaymentWeek();

  const weeklyAcceptedOrders =
    acceptedOrders.filter(
      (order) => {
        const orderDate =
          londonDateKey(
            order.createdAt,
          );

        return (
          orderDate >=
            paymentWeek.startKey &&
          orderDate <=
            paymentWeek.endKey
        );
      },
    );

  const firstNewOrder =
    newOrders[0];

  const isSaving =
    navigation.state ===
    "submitting";

  function stopAlarm() {
    if (
      alarmTimerRef.current
    ) {
      clearInterval(
        alarmTimerRef.current,
      );

      alarmTimerRef.current =
        null;
    }
  }

  function makeAlarmSound() {
    try {
      const AudioContext =
        window.AudioContext ||
        window.webkitAudioContext;

      if (
        !audioContextRef.current
      ) {
        audioContextRef.current =
          new AudioContext();
      }

      const context =
        audioContextRef.current;

      if (
        context.state ===
        "suspended"
      ) {
        context.resume();
      }

      const oscillator =
        context.createOscillator();

      const gain =
        context.createGain();

      oscillator.type =
        "square";

      oscillator.frequency.value =
        880;

      gain.gain.setValueAtTime(
        0.9,
        context.currentTime,
      );

      gain.gain.exponentialRampToValueAtTime(
        0.01,
        context.currentTime +
          0.7,
      );

      oscillator.connect(
        gain,
      );

      gain.connect(
        context.destination,
      );

      oscillator.start();

      oscillator.stop(
        context.currentTime +
          0.7,
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

    return () =>
      stopAlarm();
  }, [
    newOrders.length,
    soundEnabled,
  ]);

  const acceptedFoodSales =
    weeklyAcceptedOrders.reduce(
      (
        total,
        order,
      ) =>
        total +
        Number(
          order.foodTotal ||
            0,
        ),
      0,
    );

  const deliveryIncome =
    weeklyAcceptedOrders.reduce(
      (
        total,
        order,
      ) =>
        total +
        Number(
          order.delivery ||
            0,
        ),
      0,
    );

  const commission =
    acceptedFoodSales *
    0.1;

  const restaurantEarnings =
    acceptedFoodSales *
      0.9 +
    deliveryIncome;

  const serviceFees =
    weeklyAcceptedOrders.reduce(
      (
        total,
        order,
      ) =>
        total +
        Number(
          order.serviceFee ||
            0,
        ),
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
              style={
                styles.restaurantName
              }
            >
              {restaurant.name}
            </h1>

            <div
              style={
                styles.location
              }
            >
              Restaurant ID:{" "}
              {
                restaurant.restaurantId
              }
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

        {activeTab ===
          "orders" && (
          <>
            <section
              style={
                styles.controls
              }
            >
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
                  disabled={
                    isSaving
                  }
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
                  style={
                    styles.orangeButton
                  }
                  onClick={
                    enableSound
                  }
                >
                  🔊 ENABLE ORDER
                  SOUND
                </button>
              ) : (
                <div
                  style={
                    styles.soundOn
                  }
                >
                  🔊 ORDER SOUND ON
                </div>
              )}
            </section>

            {firstNewOrder ? (
              <section
                style={
                  styles.newOrder
                }
              >
                <DeliveryBadge
                  type={
                    firstNewOrder.deliveryType
                  }
                />

                <div
                  style={
                    styles.orderTop
                  }
                >
                  <div>
                    <div
                      style={
                        styles.newLabel
                      }
                    >
                      🔔 NEW ORDER
                    </div>

                    <h2
                      style={
                        styles.orderNumber
                      }
                    >
                      {
                        firstNewOrder.orderNumber
                      }
                    </h2>

                    <div
                      style={
                        styles.greyText
                      }
                    >
                      Received{" "}
                      {
                        firstNewOrder.time
                      }
                    </div>
                  </div>

                  <div
                    style={
                      styles.total
                    }
                  >
                    {money(
                      firstNewOrder.total,
                    )}
                  </div>
                </div>

                <p
                  style={
                    styles.customer
                  }
                >
                  Shopify order:{" "}
                  <strong>
                    {
                      firstNewOrder.orderNumber
                    }
                  </strong>
                </p>

                <div
                  style={
                    styles.customerDetails
                  }
                >
                  <div>
                    <strong>
                      Customer:
                    </strong>{" "}
                    {
                      firstNewOrder.customer ||
                      "Customer"
                    }
                  </div>

                  {firstNewOrder.customerPhone && (
                    <div>
                      <strong>
                        Phone:
                      </strong>{" "}
                      {
                        firstNewOrder.customerPhone
                      }
                    </div>
                  )}

                  {firstNewOrder.customerEmail && (
                    <div>
                      <strong>
                        Email:
                      </strong>{" "}
                      {
                        firstNewOrder.customerEmail
                      }
                    </div>
                  )}

                  {firstNewOrder.deliveryType ===
                    "DELIVERY" &&
                    firstNewOrder.customerAddress && (
                      <div>
                        <strong>
                          Delivery
                          address:
                        </strong>{" "}
                        {
                          firstNewOrder.customerAddress
                        }
                      </div>
                    )}
                </div>

                <div
                  style={
                    styles.items
                  }
                >
                  {firstNewOrder.items.map(
                    (
                      item,
                      index,
                    ) => (
                      <div
                        key={
                          index
                        }
                        style={
                          styles.item
                        }
                      >
                        <span>
                          <span
                            style={
                              styles.quantity
                            }
                          >
                            {
                              item.quantity
                            }{" "}
                            ×
                          </span>{" "}
                          {
                            item.name
                          }
                        </span>

                        <strong>
                          {money(
                            item.total,
                          )}
                        </strong>
                      </div>
                    ),
                  )}
                </div>

                <div
                  style={
                    styles.orderTotals
                  }
                >
                  <TotalRow
                    label="Food"
                    value={money(
                      firstNewOrder.foodTotal,
                    )}
                  />

                  {firstNewOrder.deliveryType ===
                    "DELIVERY" && (
                    <TotalRow
                      label="Delivery"
                      value={money(
                        firstNewOrder.delivery,
                      )}
                    />
                  )}

                  <TotalRow
                    label="Order total"
                    value={money(
                      firstNewOrder.total,
                    )}
                    bold
                  />
                </div>

                <div
                  style={
                    styles.actions
                  }
                >
                  <orderFetcher.Form
                    method="post"
                  >
                    <input
                      type="hidden"
                      name="intent"
                      value="accept-order"
                    />

                    <input
                      type="hidden"
                      name="shopifyOrderId"
                      value={
                        firstNewOrder.id
                      }
                    />

                    <input
                      type="hidden"
                      name="orderNumber"
                      value={
                        firstNewOrder.orderNumber
                      }
                    />

                    <button
                      type="submit"
                      style={
                        styles.acceptButton
                      }
                    >
                      ✓ ACCEPT ORDER
                    </button>
                  </orderFetcher.Form>

                  <orderFetcher.Form
                    method="post"
                  >
                    <input
                      type="hidden"
                      name="intent"
                      value="reject-order"
                    />

                    <input
                      type="hidden"
                      name="shopifyOrderId"
                      value={
                        firstNewOrder.id
                      }
                    />

                    <input
                      type="hidden"
                      name="orderNumber"
                      value={
                        firstNewOrder.orderNumber
                      }
                    />

                    <button
                      type="submit"
                      style={
                        styles.rejectButton
                      }
                    >
                      × REJECT ORDER
                    </button>
                  </orderFetcher.Form>
                </div>
              </section>
            ) : (
              <section
                style={
                  styles.waiting
                }
              >
                <div
                  style={
                    styles.tick
                  }
                >
                  ✓
                </div>

                <h2>
                  No New Orders
                </h2>

                <p>
                  New orders will
                  appear here
                  automatically.
                </p>
              </section>
            )}

            <section
              style={
                styles.panel
              }
            >
              <div
                style={
                  styles.titleRow
                }
              >
                <h2
                  style={{
                    margin: 0,
                  }}
                >
                  Current Orders
                </h2>

                <span
                  style={
                    styles.count
                  }
                >
                  {
                    currentOrders.length
                  }
                </span>
              </div>

              <p
                style={
                  styles.sectionHelp
                }
              >
                Tap an order to view
                the full details.
              </p>

              {currentOrders.length ===
              0 ? (
                <p
                  style={
                    styles.greyText
                  }
                >
                  No current orders.
                </p>
              ) : (
                currentOrders.map(
                  (order) => (
                    <OrderListButton
                      key={
                        order.id
                      }
                      order={
                        order
                      }
                      onClick={() =>
                        setSelectedOrder(
                          order,
                        )
                      }
                    />
                  ),
                )
              )}
            </section>

            <section
              style={
                styles.panel
              }
            >
              <div
                style={
                  styles.titleRow
                }
              >
                <h2
                  style={{
                    margin: 0,
                  }}
                >
                  Previous Orders
                </h2>

                <span
                  style={
                    styles.darkCount
                  }
                >
                  {
                    previousOrders.length
                  }
                </span>
              </div>

              <p
                style={
                  styles.sectionHelp
                }
              >
                Tap a previous order
                to see the customer,
                items and totals.
              </p>

              {previousOrders.length ===
              0 ? (
                <p
                  style={
                    styles.greyText
                  }
                >
                  No previous orders
                  yet.
                </p>
              ) : (
                previousOrders.map(
                  (order) => (
                    <OrderListButton
                      key={
                        order.id
                      }
                      order={
                        order
                      }
                      onClick={() =>
                        setSelectedOrder(
                          order,
                        )
                      }
                      previous
                    />
                  ),
                )
              )}
            </section>
          </>
        )}

        {activeTab ===
          "payments" && (
          <>
            <section
              style={
                styles.pageHeading
              }
            >
              <h2
                style={{
                  margin: 0,
                }}
              >
                Payments
              </h2>

              <p
                style={
                  styles.greyText
                }
              >
                Your Meal Deal Hub
                earnings and payouts.
              </p>
            </section>

            <div
              style={
                styles.grid
              }
            >
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
                value={money(
                  commission,
                )}
              />

              <PaymentCard
                title="YOU RECEIVE"
                value={money(
                  restaurantEarnings,
                )}
              />
            </div>

            <section
              style={
                styles.payout
              }
            >
              <div
                style={
                  styles.smallWhite
                }
              >
                NEXT PAYOUT
              </div>

              <div
                style={
                  styles.payoutAmount
                }
              >
                {money(
                  restaurantEarnings,
                )}
              </div>

              <p>
                Payout period:{" "}
                <strong>
                  {
                    paymentWeek.startLabel
                  }
                  {" – "}
                  {
                    paymentWeek.endLabel
                  }
                </strong>
              </p>

              <p>
                Expected payout:{" "}
                <strong>
                  Wednesday{" "}
                  {
                    paymentWeek.payoutLabel
                  }
                </strong>
              </p>

              <p>
                Accepted orders this
                week:{" "}
                <strong>
                  {
                    weeklyAcceptedOrders.length
                  }
                </strong>
              </p>

              <p>
                Meal Deal Hub
                commission:{" "}
                <strong>
                  {money(
                    commission,
                  )}
                </strong>
              </p>

              <p>
                Service fees retained
                by Meal Deal Hub:{" "}
                <strong>
                  {money(
                    serviceFees,
                  )}
                </strong>
              </p>
            </section>

            <section
              style={
                styles.panel
              }
            >
              <div
                style={
                  styles.titleRow
                }
              >
                <h2
                  style={{
                    margin: 0,
                  }}
                >
                  Payout History
                </h2>

                <span
                  style={
                    styles.darkCount
                  }
                >
                  {
                    (
                      savedPayoutHistory ||
                      []
                    ).length
                  }
                </span>
              </div>

              <p
                style={
                  styles.sectionHelp
                }
              >
                Completed weekly
                payment periods are
                stored here.
              </p>

              {!savedPayoutHistory ||
              savedPayoutHistory.length ===
                0 ? (
                <p
                  style={
                    styles.greyText
                  }
                >
                  No completed payout
                  periods yet.
                </p>
              ) : (
                savedPayoutHistory.map(
                  (payout) => (
                    <button
                      key={
                        payout.id
                      }
                      type="button"
                      onClick={() =>
                        setSelectedPayout(
                          payout,
                        )
                      }
                      style={
                        styles.payoutHistoryButton
                      }
                    >
                      <div>
                        <strong
                          style={{
                            fontSize:
                              18,
                          }}
                        >
                          {londonDateLabel(
                            payout.weekStart,
                          )}
                          {" – "}
                          {londonDateLabel(
                            payout.weekEnd,
                          )}
                        </strong>

                        <div
                          style={
                            styles.greyText
                          }
                        >
                          {
                            payout.acceptedOrderCount
                          }{" "}
                          accepted{" "}
                          {payout.acceptedOrderCount ===
                          1
                            ? "order"
                            : "orders"}
                        </div>
                      </div>

                      <div
                        style={
                          styles.payoutHistoryRight
                        }
                      >
                        <strong
                          style={{
                            fontSize:
                              20,
                          }}
                        >
                          {money(
                            payout.restaurantEarnings,
                          )}
                        </strong>

                        <span
                          style={
                            styles.viewText
                          }
                        >
                          VIEW ›
                        </span>
                      </div>
                    </button>
                  ),
                )
              )}
            </section>
          </>
        )}

        {activeTab ===
          "account" && (
          <>
            <section
              style={
                styles.pageHeading
              }
            >
              <h2
                style={{
                  margin: 0,
                }}
              >
                Restaurant Account
              </h2>

              <p
                style={
                  styles.greyText
                }
              >
                Your Meal Deal Hub
                restaurant account.
              </p>
            </section>

            <section
              style={
                styles.panel
              }
            >
              <AccountRow
                label="Restaurant"
                value={
                  restaurant.name
                }
              />

              <AccountRow
                label="Restaurant ID"
                value={
                  restaurant.restaurantId
                }
              />

              <AccountRow
                label="Login email"
                value={
                  user.email
                }
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

            <section
              style={
                styles.panel
              }
            >
              <h2
                style={{
                  marginTop: 0,
                }}
              >
                Order Status
              </h2>

              <p>
                Temporarily stop new
                Meal Deal Hub orders
                whenever your
                restaurant is too
                busy.
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
                  disabled={
                    isSaving
                  }
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

            <section
              style={
                styles.panel
              }
            >
              <h2
                style={{
                  marginTop: 0,
                }}
              >
                Sign Out
              </h2>

              <p
                style={
                  styles.greyText
                }
              >
                Sign out of this
                restaurant terminal.
              </p>

              <a
                href="/restaurant/logout"
                style={
                  styles.logoutButton
                }
              >
                LOG OUT
              </a>
            </section>
          </>
        )}

        <nav
          style={
            styles.bottomNav
          }
        >
          <button
            type="button"
            onClick={() =>
              setActiveTab(
                "orders",
              )
            }
            style={
              activeTab ===
              "orders"
                ? styles.activeNav
                : styles.navButton
            }
          >
            🧾 ORDERS
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveTab(
                "payments",
              )
            }
            style={
              activeTab ===
              "payments"
                ? styles.activeNav
                : styles.navButton
            }
          >
            £ PAYMENTS
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveTab(
                "account",
              )
            }
            style={
              activeTab ===
              "account"
                ? styles.activeNav
                : styles.navButton
            }
          >
            ⚙ ACCOUNT
          </button>
        </nav>

        {selectedOrder && (
          <OrderDetailsModal
            order={
              selectedOrder
            }
            onClose={() =>
              setSelectedOrder(
                null,
              )
            }
          />
        )}

        {selectedPayout && (
          <PayoutDetailsModal
            payout={
              selectedPayout
            }
            onClose={() =>
              setSelectedPayout(
                null,
              )
            }
          />
        )}
      </div>
    </main>
  );
}

function DeliveryBadge({
  type,
}) {
  const isPickup =
    type === "PICKUP";

  return (
    <div
      style={
        isPickup
          ? styles.pickupBadge
          : styles.deliveryBadge
      }
    >
      {isPickup
        ? "🛍 PICKUP"
        : "🚗 DELIVERY"}
    </div>
  );
}

function OrderListButton({
  order,
  onClick,
  previous = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={
        styles.orderListButton
      }
    >
      <div
        style={
          styles.orderListLeft
        }
      >
        <DeliveryBadge
          type={
            order.deliveryType
          }
        />

        <strong
          style={{
            fontSize: 20,
          }}
        >
          {order.orderNumber}
        </strong>

        <div
          style={
            styles.greyText
          }
        >
          {order.date} at{" "}
          {order.time}
        </div>

        <div
          style={
            styles.greyText
          }
        >
          {order.customer}
        </div>
      </div>

      <div
        style={
          styles.orderListRight
        }
      >
        <strong
          style={{
            fontSize: 20,
          }}
        >
          {money(
            order.total,
          )}
        </strong>

        <span
          style={
            order.status ===
            "rejected"
              ? styles.rejectedBadge
              : previous
                ? styles.previousBadge
                : styles.acceptedBadge
          }
        >
          {order.status ===
          "rejected"
            ? "REJECTED"
            : previous
              ? "PREVIOUS"
              : "ACCEPTED"}
        </span>

        <span
          style={
            styles.viewText
          }
        >
          VIEW ›
        </span>
      </div>
    </button>
  );
}

function OrderDetailsModal({
  order,
  onClose,
}) {
  return (
    <div
      style={
        styles.modalOverlay
      }
      onClick={onClose}
    >
      <div
        style={
          styles.modal
        }
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        <div
          style={
            styles.modalHeader
          }
        >
          <div>
            <DeliveryBadge
              type={
                order.deliveryType
              }
            />

            <h2
              style={
                styles.modalOrderNumber
              }
            >
              {order.orderNumber}
            </h2>

            <div
              style={
                styles.greyText
              }
            >
              {order.dateTime}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={
              styles.closeButton
            }
            aria-label="Close order"
          >
            ×
          </button>
        </div>

        <div
          style={
            styles.modalStatusRow
          }
        >
          <span
            style={
              order.status ===
              "rejected"
                ? styles.rejectedBadge
                : styles.acceptedBadge
            }
          >
            {String(
              order.status,
            ).toUpperCase()}
          </span>

          {order.financialStatus && (
            <span
              style={
                styles.paymentBadge
              }
            >
              PAYMENT:{" "}
              {String(
                order.financialStatus,
              )
                .replaceAll(
                  "_",
                  " ",
                )
                .toUpperCase()}
            </span>
          )}
        </div>

        <section
          style={
            styles.detailSection
          }
        >
          <h3
            style={
              styles.detailHeading
            }
          >
            Customer
          </h3>

          <DetailRow
            label="Name"
            value={
              order.customer ||
              "Customer"
            }
          />

          {order.customerPhone && (
            <DetailRow
              label="Phone"
              value={
                order.customerPhone
              }
            />
          )}

          {order.customerEmail && (
            <DetailRow
              label="Email"
              value={
                order.customerEmail
              }
            />
          )}

          {order.deliveryType ===
            "DELIVERY" &&
            order.customerAddress && (
              <DetailRow
                label="Delivery address"
                value={
                  order.customerAddress
                }
              />
            )}

          {order.shippingMethod && (
            <DetailRow
              label="Method"
              value={
                order.shippingMethod
              }
            />
          )}
        </section>

        <section
          style={
            styles.detailSection
          }
        >
          <h3
            style={
              styles.detailHeading
            }
          >
            Order Items
          </h3>

          <div
            style={
              styles.modalItems
            }
          >
            {order.items.map(
              (
                item,
                index,
              ) => (
                <div
                  key={index}
                  style={
                    styles.modalItem
                  }
                >
                  <div>
                    <span
                      style={
                        styles.quantity
                      }
                    >
                      {
                        item.quantity
                      }{" "}
                      ×
                    </span>{" "}
                    <strong>
                      {
                        item.name
                      }
                    </strong>
                  </div>

                  <strong>
                    {money(
                      item.total,
                    )}
                  </strong>
                </div>
              ),
            )}
          </div>
        </section>

        <section
          style={
            styles.detailSection
          }
        >
          <h3
            style={
              styles.detailHeading
            }
          >
            Order Total
          </h3>

          <TotalRow
            label="Food"
            value={money(
              order.foodTotal,
            )}
          />

          {order.deliveryType ===
            "DELIVERY" && (
            <TotalRow
              label="Delivery"
              value={money(
                order.delivery,
              )}
            />
          )}

          <TotalRow
            label="Total paid by customer"
            value={money(
              order.total,
            )}
            bold
          />
        </section>

        <button
          type="button"
          onClick={onClose}
          style={
            styles.fullDarkButton
          }
        >
          CLOSE ORDER
        </button>
      </div>
    </div>
  );
}

function PayoutDetailsModal({
  payout,
  onClose,
}) {
  return (
    <div
      style={
        styles.modalOverlay
      }
      onClick={onClose}
    >
      <div
        style={
          styles.modal
        }
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        <div
          style={
            styles.modalHeader
          }
        >
          <div>
            <div
              style={
                styles.logo
              }
            >
              PAYOUT HISTORY
            </div>

            <h2
              style={
                styles.modalOrderNumber
              }
            >
              {money(
                payout.restaurantEarnings,
              )}
            </h2>

            <div
              style={
                styles.greyText
              }
            >
              {londonDateLabel(
                payout.weekStart,
              )}
              {" – "}
              {londonDateLabel(
                payout.weekEnd,
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={
              styles.closeButton
            }
            aria-label="Close payout"
          >
            ×
          </button>
        </div>

        <section
          style={
            styles.detailSection
          }
        >
          <h3
            style={
              styles.detailHeading
            }
          >
            Weekly Summary
          </h3>

          <DetailRow
            label="Accepted orders"
            value={
              payout.acceptedOrderCount
            }
          />

          <DetailRow
            label="Meal deal sales"
            value={money(
              payout.foodSales,
            )}
          />

          <DetailRow
            label="Delivery"
            value={money(
              payout.deliveryIncome,
            )}
          />

          <DetailRow
            label="Meal Deal Hub commission"
            value={money(
              payout.commission,
            )}
          />

          <DetailRow
            label="Service fees retained by Meal Deal Hub"
            value={money(
              payout.serviceFees,
            )}
          />

          <DetailRow
            label="Restaurant receives"
            value={money(
              payout.restaurantEarnings,
            )}
            bold
          />
        </section>

        <section
          style={
            styles.detailSection
          }
        >
          <DetailRow
            label="Expected payout date"
            value={
              londonDateLabel(
                payout.payoutDate,
              )
            }
          />
        </section>

        <button
          type="button"
          onClick={onClose}
          style={
            styles.fullDarkButton
          }
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}

function TotalRow({
  label,
  value,
  bold = false,
}) {
  return (
    <div
      style={
        bold
          ? styles.totalRowBold
          : styles.totalRow
      }
    >
      <span>
        {label}
      </span>

      <span>
        {value}
      </span>
    </div>
  );
}

function DetailRow({
  label,
  value,
  bold = false,
}) {
  return (
    <div
      style={
        styles.detailRow
      }
    >
      <span
        style={
          styles.greyText
        }
      >
        {label}
      </span>

      <strong
        style={
          bold
            ? styles.detailStrong
            : undefined
        }
      >
        {value}
      </strong>
    </div>
  );
}

function PaymentCard({
  title,
  value,
}) {
  return (
    <div
      style={
        styles.card
      }
    >
      <div
        style={
          styles.cardTitle
        }
      >
        {title}
      </div>

      <div
        style={
          styles.cardValue
        }
      >
        {value}
      </div>
    </div>
  );
}

function AccountRow({
  label,
  value,
}) {
  return (
    <div
      style={
        styles.accountRow
      }
    >
      <div
        style={
          styles.greyText
        }
      >
        {label}
      </div>

      <strong>
        {value}
      </strong>
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
    justifyContent:
      "space-between",
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
    border:
      "4px solid #f05a28",
    borderRadius: 18,
    padding: 25,
    marginBottom: 18,
  },

  deliveryBadge: {
    display: "inline-block",
    background: "#171717",
    color: "#fff",
    borderRadius: 8,
    padding: "9px 13px",
    fontWeight: 900,
    fontSize: 14,
    letterSpacing: 0.5,
    marginBottom: 12,
  },

  pickupBadge: {
    display: "inline-block",
    background: "#f05a28",
    color: "#fff",
    borderRadius: 8,
    padding: "9px 13px",
    fontWeight: 900,
    fontSize: 14,
    letterSpacing: 0.5,
    marginBottom: 12,
  },

  orderTop: {
    display: "flex",
    justifyContent:
      "space-between",
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

  customerDetails: {
    marginBottom: 16,
    lineHeight: 1.6,
  },

  items: {
    background: "#f7f7f7",
    borderRadius: 12,
    padding: 18,
    marginTop: 18,
  },

  item: {
    fontSize: 19,
    fontWeight: 700,
    padding: "10px 0",
    display: "flex",
    justifyContent:
      "space-between",
    gap: 15,
  },

  quantity: {
    color: "#f05a28",
  },

  orderTotals: {
    marginTop: 18,
    borderTop:
      "1px solid #ddd",
    paddingTop: 10,
  },

  totalRow: {
    display: "flex",
    justifyContent:
      "space-between",
    gap: 20,
    padding: "7px 0",
  },

  totalRowBold: {
    display: "flex",
    justifyContent:
      "space-between",
    gap: 20,
    padding: "12px 0 4px",
    borderTop:
      "1px solid #ddd",
    marginTop: 5,
    fontSize: 19,
    fontWeight: 900,
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
    background: "#171717",
    color: "#fff",
    border: 0,
    borderRadius: 12,
    fontSize: 18,
    fontWeight: 900,
    cursor: "pointer",
  },

  rejectButton: {
    width: "100%",
    minHeight: 64,
    background: "#fff",
    color: "#b42318",
    border:
      "2px solid #b42318",
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
    marginBottom: 8,
  },

  sectionHelp: {
    color: "#777",
    fontSize: 14,
    marginTop: 0,
    marginBottom: 14,
  },

  count: {
    background: "#f05a28",
    color: "#fff",
    minWidth: 26,
    height: 26,
    padding: "0 6px",
    borderRadius: 20,
    display: "grid",
    placeItems: "center",
    fontWeight: 800,
  },

  darkCount: {
    background: "#171717",
    color: "#fff",
    minWidth: 26,
    height: 26,
    padding: "0 6px",
    borderRadius: 20,
    display: "grid",
    placeItems: "center",
    fontWeight: 800,
  },

  orderListButton: {
    width: "100%",
    background: "#fff",
    color: "#171717",
    border: 0,
    borderTop:
      "1px solid #eee",
    padding: "18px 0",
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    gap: 15,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
  },

  orderListLeft: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
  },

  orderListRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 7,
    textAlign: "right",
  },

  acceptedBadge: {
    background: "#e8f5e9",
    color: "#137333",
    padding: "8px 12px",
    borderRadius: 30,
    fontWeight: 800,
    fontSize: 12,
  },

  rejectedBadge: {
    background: "#fdecec",
    color: "#b42318",
    padding: "8px 12px",
    borderRadius: 30,
    fontWeight: 800,
    fontSize: 12,
  },

  previousBadge: {
    background: "#eeeeee",
    color: "#444",
    padding: "8px 12px",
    borderRadius: 30,
    fontWeight: 800,
    fontSize: 12,
  },

  paymentBadge: {
    background: "#f3f3f3",
    color: "#444",
    padding: "8px 12px",
    borderRadius: 30,
    fontWeight: 800,
    fontSize: 12,
  },

  viewText: {
    color: "#f05a28",
    fontSize: 12,
    fontWeight: 900,
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

  payoutHistoryButton: {
    width: "100%",
    background: "#fff",
    color: "#171717",
    border: 0,
    borderTop:
      "1px solid #eee",
    padding: "18px 0",
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    gap: 15,
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "inherit",
  },

  payoutHistoryRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 6,
  },

  accountRow: {
    padding: "15px 0",
    borderBottom:
      "1px solid #eee",
    display: "flex",
    justifyContent:
      "space-between",
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
    zIndex: 20,
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

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background:
      "rgba(0, 0, 0, 0.65)",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },

  modal: {
    width: "100%",
    maxWidth: 700,
    maxHeight: "90vh",
    overflowY: "auto",
    background: "#fff",
    borderRadius: 18,
    padding: 24,
    boxShadow:
      "0 20px 60px rgba(0,0,0,0.3)",
  },

  modalHeader: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "flex-start",
    gap: 20,
  },

  modalOrderNumber: {
    margin: "4px 0",
    fontSize: 30,
  },

  closeButton: {
    width: 44,
    height: 44,
    borderRadius: "50%",
    border: 0,
    background: "#171717",
    color: "#fff",
    fontSize: 28,
    lineHeight: 1,
    cursor: "pointer",
  },

  modalStatusRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 18,
    marginBottom: 18,
  },

  detailSection: {
    borderTop:
      "1px solid #e5e5e5",
    paddingTop: 18,
    marginTop: 18,
  },

  detailHeading: {
    margin:
      "0 0 12px",
    fontSize: 18,
  },

  detailRow: {
    display: "flex",
    justifyContent:
      "space-between",
    gap: 25,
    padding: "8px 0",
    lineHeight: 1.4,
  },

  detailStrong: {
    fontSize: 18,
  },

  modalItems: {
    background: "#f7f7f7",
    borderRadius: 12,
    padding: "8px 16px",
  },

  modalItem: {
    display: "flex",
    justifyContent:
      "space-between",
    gap: 20,
    padding: "12px 0",
    borderBottom:
      "1px solid #e5e5e5",
  },

  fullDarkButton: {
    width: "100%",
    background: "#171717",
    color: "#fff",
    border: 0,
    borderRadius: 11,
    padding: 16,
    marginTop: 24,
    fontSize: 15,
    fontWeight: 900,
    cursor: "pointer",
  },
};