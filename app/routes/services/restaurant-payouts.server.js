import db from "../db.server";

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

    // Do not invent a payout date when holiday data
    // has never been successfully retrieved.
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

Only verified, accepted and captured orders count.

The caller must supply a COMPLETE list of orders
for the restaurant and payment week.
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

    const financialStatus = String(
      order.financialStatus || "",
    ).toUpperCase();

    // PARTIALLY_PAID is deliberately excluded.
    // A partially paid order needs separate reconciliation.
    if (financialStatus !== "PAID") {
      continue;
    }

    if (order.paymentCaptured !== true) {
      continue;
    }

    const orderId = String(
      order.id || order.shopifyOrderId || "",
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
      order.foodTotal === undefined ||
      order.delivery === undefined ||
      order.serviceFee === undefined
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
SAVE WEEKLY PAYOUT

IMPORTANT:
- Requires complete, verified order data.
- Does not create payouts for the current open week.
- Does not overwrite paid payouts.
- Uses a database transaction to protect against
  concurrent payout updates.
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

  if (!Array.isArray(orders)) {
    throw new Error("Complete order list is required.");
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

  const earnings = calculateRestaurantEarnings(orders);

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
      // Lock the restaurant row so two payout
      // calculations for the same restaurant cannot
      // update the payout simultaneously.
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
        PAID_STATUSES.includes(existing.status)
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

Uses UK calendar dates for the month boundaries.
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