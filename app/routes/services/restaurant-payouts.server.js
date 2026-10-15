import db from "./db.server";

const COMMISSION_RATE = 0.1;
const TIME_ZONE = "Europe/London";

const PAID_STATUSES = ["paid", "completed"];

/*
=========================================================
MONEY HELPERS
=========================================================
*/

function toPence(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Invalid monetary amount.");
  }

  return Math.round((amount + Number.EPSILON) * 100);
}

function fromPence(value) {
  return (value / 100).toFixed(2);
}

/*
=========================================================
UK DATE HELPERS
=========================================================
*/

function londonDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type) =>
    Number(
      parts.find((part) => part.type === type)?.value,
    );

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

function dateFromParts({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function dateFromKey(key) {
  if (
    typeof key !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(key)
  ) {
    throw new Error("Invalid payment date.");
  }

  const date = new Date(`${key}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    dateKey(date) !== key
  ) {
    throw new Error("Invalid payment date.");
  }

  return date;
}

function londonDateKey(date) {
  const parts = londonDateParts(date);

  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

/*
=========================================================
PAYMENT WEEK
Monday to Sunday, UK calendar
=========================================================
*/

export function getRestaurantPaymentWeek(
  value = new Date(),
) {
  const parts = londonDateParts(value);
  const today = dateFromParts(parts);

  const weekday = today.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;

  const weekStart = addDays(today, -daysSinceMonday);
  const weekEnd = addDays(weekStart, 6);

  return {
    weekStart,
    weekEnd,
  };
}

/*
=========================================================
UK BANK HOLIDAYS
=========================================================
*/

let bankHolidayCache = {
  expiresAt: 0,
  dates: new Set(),
  loaded: false,
};

async function getBankHolidays() {
  if (
    bankHolidayCache.loaded &&
    Date.now() < bankHolidayCache.expiresAt
  ) {
    return bankHolidayCache.dates;
  }

  try {
    const response = await fetch(
      "https://www.gov.uk/bank-holidays.json",
      {
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      throw new Error("Bank holiday lookup failed.");
    }

    const data = await response.json();

    const events = data["england-and-wales"]?.events;

    if (!Array.isArray(events)) {
      throw new Error("Bank holiday data is incomplete.");
    }

    bankHolidayCache = {
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      dates: new Set(
        events.map((event) => event.date),
      ),
      loaded: true,
    };

    return bankHolidayCache.dates;
  } catch (error) {
    console.error(
      "BANK HOLIDAY LOOKUP FAILED:",
      error,
    );

    if (bankHolidayCache.loaded) {
      return bankHolidayCache.dates;
    }

    throw new Error(
      "Expected payout date is temporarily unavailable.",
    );
  }
}

function isWorkingDay(date, bankHolidays) {
  const weekday = date.getUTCDay();

  return (
    weekday !== 0 &&
    weekday !== 6 &&
    !bankHolidays.has(dateKey(date))
  );
}

export async function calculateExpectedPayoutDate(
  weekEnd,
) {
  const bankHolidays = await getBankHolidays();

  let date = addDays(weekEnd, 1);
  let workingDays = 0;

  while (workingDays < 3) {
    if (isWorkingDay(date, bankHolidays)) {
      workingDays += 1;
    }

    if (workingDays < 3) {
      date = addDays(date, 1);
    }
  }

  return date;
}

/*
=========================================================
CALCULATE RESTAURANT EARNINGS

Only accepted orders with verified captured payments
are included.

Rejected, pending and unpaid orders are excluded.
=========================================================
*/

export function calculateRestaurantEarnings(
  orders = [],
) {
  if (!Array.isArray(orders)) {
    throw new Error("Orders must be an array.");
  }

  const seenOrderIds = new Set();

  let foodSalesPence = 0;
  let deliveryPence = 0;
  let serviceFeesPence = 0;
  let acceptedOrderCount = 0;

  for (const order of orders) {
    if (order.status !== "accepted") {
      continue;
    }

    if (order.paymentCaptured !== true) {
      continue;
    }

    if (!order.capturedAt) {
      continue;
    }

    const currencyCode = String(
      order.currencyCode || "",
    ).toUpperCase();

    if (currencyCode !== "GBP") {
      throw new Error(
        "Only verified GBP orders can be included.",
      );
    }

    const orderId = String(
      order.shopifyOrderId || order.id || "",
    );

    if (!orderId) {
      throw new Error(
        "Accepted order is missing its Shopify ID.",
      );
    }

    if (seenOrderIds.has(orderId)) {
      throw new Error(
        `Duplicate Shopify order detected: ${orderId}`,
      );
    }

    seenOrderIds.add(orderId);

    if (
      order.foodTotal == null ||
      order.delivery == null ||
      order.serviceFee == null
    ) {
      throw new Error(
        `Financial information is incomplete for ${orderId}.`,
      );
    }

    foodSalesPence += toPence(order.foodTotal);
    deliveryPence += toPence(order.delivery);
    serviceFeesPence += toPence(order.serviceFee);

    acceptedOrderCount += 1;
  }

  const commissionPence = Math.round(
    foodSalesPence * COMMISSION_RATE,
  );

  const restaurantEarningsPence =
    foodSalesPence -
    commissionPence +
    deliveryPence;

  return {
    foodSales: fromPence(foodSalesPence),
    deliveryIncome: fromPence(deliveryPence),
    commission: fromPence(commissionPence),
    serviceFees: fromPence(serviceFeesPence),
    restaurantEarnings: fromPence(
      restaurantEarningsPence,
    ),
    acceptedOrderCount,
  };
}

/*
=========================================================
GET VERIFIED ORDERS FOR A PAYMENT WEEK

Only reads saved order decisions that are:

- Accepted
- Payment captured
- Captured date recorded
- GBP currency

Rejected orders cannot enter this result.
=========================================================
*/

export async function getVerifiedRestaurantOrdersForWeek({
  restaurantId,
  weekStart,
  weekEnd,
}) {
  const id = Number(restaurantId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid restaurant ID.");
  }

  const start = dateFromKey(dateKey(weekStart));
  const end = dateFromKey(dateKey(weekEnd));

  const decisions = await db.orderDecision.findMany({
    where: {
      restaurantId: id,
      status: "accepted",
      paymentCaptured: true,
      currencyCode: "GBP",
      capturedAt: {
        not: null,
      },
    },
  });

  const weekStartKey = dateKey(start);
  const weekEndKey = dateKey(end);

  return decisions
    .filter((decision) => {
      const capturedKey = londonDateKey(
        decision.capturedAt,
      );

      return (
        capturedKey >= weekStartKey &&
        capturedKey <= weekEndKey
      );
    })
    .map((decision) => {
      if (
        decision.foodSales == null ||
        decision.deliveryIncome == null ||
        decision.serviceFee == null
      ) {
        throw new Error(
          `Incomplete payment snapshot for ${decision.shopifyOrderId}.`,
        );
      }

      return {
        id: decision.shopifyOrderId,
        shopifyOrderId: decision.shopifyOrderId,
        status: decision.status,
        paymentCaptured: decision.paymentCaptured,
        currencyCode: decision.currencyCode,
        capturedAt: decision.capturedAt,
        foodTotal: decision.foodSales,
        delivery: decision.deliveryIncome,
        serviceFee: decision.serviceFee,
      };
    });
}

/*
=========================================================
SAVE WEEKLY PAYOUT

IMPORTANT SECURITY RULE:

The payout is ALWAYS recalculated from verified
database records.

The supplied orders array is not trusted as the
source of financial totals.

Paid payouts are never overwritten.
=========================================================
*/

export async function saveRestaurantWeeklyPayout({
  restaurantId,
  weekStart,
  weekEnd,
  orders,
  ordersComplete = false,
}) {
  const id = Number(restaurantId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid restaurant ID.");
  }

  if (ordersComplete !== true) {
    throw new Error(
      "Cannot create payout: complete order data has not been verified.",
    );
  }

  if (orders !== undefined && !Array.isArray(orders)) {
    throw new Error("Orders must be an array.");
  }

  const start = dateFromKey(dateKey(weekStart));
  const end = dateFromKey(dateKey(weekEnd));

  if (
    start.getUTCDay() !== 1 ||
    end.getUTCDay() !== 0 ||
    dateKey(addDays(start, 6)) !== dateKey(end)
  ) {
    throw new Error(
      "Payout period must be Monday to Sunday.",
    );
  }

  const currentWeek = getRestaurantPaymentWeek();

  if (start >= currentWeek.weekStart) {
    throw new Error(
      "Cannot finalise a payout for an open or future week.",
    );
  }

  /*
  ========================================================
  LOAD VERIFIED ORDERS DIRECTLY FROM DATABASE
  ========================================================
  */

  const verifiedOrders =
    await getVerifiedRestaurantOrdersForWeek({
      restaurantId: id,
      weekStart: start,
      weekEnd: end,
    });

  const earnings =
    calculateRestaurantEarnings(verifiedOrders);

  const payoutDate =
    await calculateExpectedPayoutDate(end);

  const uniqueWhere = {
    restaurantId_weekStart: {
      restaurantId: id,
      weekStart: start,
    },
  };

  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM "Restaurant"
        WHERE id = ${id}
        FOR UPDATE
      `;

      const existing =
        await tx.restaurantPayout.findUnique({
          where: uniqueWhere,
        });

      if (
        existing &&
        PAID_STATUSES.includes(
          String(existing.status).toLowerCase(),
        )
      ) {
        return existing;
      }

      if (existing) {
        return tx.restaurantPayout.update({
          where: {
            id: existing.id,
          },
          data: {
            weekEnd: end,
            payoutDate,
            ...earnings,
          },
        });
      }

      return tx.restaurantPayout.create({
        data: {
          restaurantId: id,
          weekStart: start,
          weekEnd: end,
          payoutDate,
          ...earnings,
          status: "expected",
        },
      });
    },
    {
      isolationLevel: "Serializable",
    },
  );
}

/*
=========================================================
GENERATE LAST COMPLETED WEEK'S PAYOUT
=========================================================
*/

export async function generateRestaurantWeeklyPayout(
  restaurantId,
) {
  const id = Number(restaurantId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid restaurant ID.");
  }

  const currentWeek = getRestaurantPaymentWeek();

  const weekStart = addDays(
    currentWeek.weekStart,
    -7,
  );

  const weekEnd = addDays(
    currentWeek.weekStart,
    -1,
  );

  return saveRestaurantWeeklyPayout({
    restaurantId: id,
    weekStart,
    weekEnd,
    ordersComplete: true,
  });
}

/*
=========================================================
GENERATE PAYOUTS FOR ALL ACTIVE RESTAURANTS
=========================================================
*/

export async function generateAllRestaurantWeeklyPayouts() {
  const restaurants = await db.restaurant.findMany({
    where: {
      active: true,
    },
    select: {
      id: true,
      name: true,
    },
  });

  const results = [];

  for (const restaurant of restaurants) {
    try {
      const payout =
        await generateRestaurantWeeklyPayout(
          restaurant.id,
        );

      results.push({
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        success: true,
        payoutId: payout.id,
        amount: Number(payout.restaurantEarnings),
      });
    } catch (error) {
      console.error(
        `PAYOUT GENERATION FAILED FOR ${restaurant.name}:`,
        error,
      );

      results.push({
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        success: false,
        error: error.message,
      });
    }
  }

  return results;
}

/*
=========================================================
PAYOUT HISTORY
=========================================================
*/

export async function getRestaurantPayoutHistory(
  restaurantId,
  limit = 52,
) {
  const id = Number(restaurantId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid restaurant ID.");
  }

  return db.restaurantPayout.findMany({
    where: {
      restaurantId: id,
    },
    orderBy: {
      weekStart: "desc",
    },
    take: Math.min(
      Math.max(Number(limit) || 52, 1),
      104,
    ),
  });
}

/*
=========================================================
PAID THIS MONTH
=========================================================
*/

export async function getRestaurantPaidThisMonth(
  restaurantId,
) {
  const id = Number(restaurantId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid restaurant ID.");
  }

  const now = londonDateParts();

  const monthStart = new Date(
    Date.UTC(now.year, now.month - 1, 1),
  );

  const nextMonthStart = new Date(
    Date.UTC(now.year, now.month, 1),
  );

  const payouts = await db.restaurantPayout.findMany({
    where: {
      restaurantId: id,
      status: {
        in: PAID_STATUSES,
      },
      payoutDate: {
        gte: monthStart,
        lt: nextMonthStart,
      },
    },
    select: {
      restaurantEarnings: true,
    },
  });

  const totalPence = payouts.reduce(
    (total, payout) =>
      total + toPence(payout.restaurantEarnings),
    0,
  );

  return Number(fromPence(totalPence));
}