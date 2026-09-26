import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const RESTAURANT = {
  id: "Jamaica 2",
  name: "Mannies Aroma Jerk",
};

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
}

function getRestaurantId(lineItem) {
  const attribute = lineItem.customAttributes?.find(
    (item) => item.key === "_Restaurant ID",
  );

  return attribute?.value || "";
}

function getOrderRestaurantId(order) {
  for (const item of order.lineItems?.nodes || []) {
    const restaurantId = getRestaurantId(item);

    if (restaurantId) {
      return restaurantId;
    }
  }

  return "";
}

function getFoodTotal(order) {
  return (order.lineItems?.nodes || []).reduce(
    (total, item) => {
      const quantity = Number(item.quantity || 0);

      const unitPrice = Number(
        item.originalUnitPriceSet?.shopMoney?.amount || 0,
      );

      return total + unitPrice * quantity;
    },
    0,
  );
}

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query RestaurantOrders {
      orders(first: 50, reverse: true) {
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

              originalUnitPriceSet {
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

  const result = await response.json();

  if (result.errors) {
    console.error("SHOPIFY ORDER ERROR:", result.errors);

    return {
      restaurant: RESTAURANT,
      orders: [],
      error: "Could not load Shopify orders.",
    };
  }

  const shopifyOrders =
    result.data?.orders?.nodes || [];

  const restaurantRecord =
    await db.restaurant.findUnique({
      where: {
        restaurantId: RESTAURANT.id,
      },
    });

  if (!restaurantRecord) {
    return {
      restaurant: RESTAURANT,
      orders: [],
      error: "Restaurant record not found.",
    };
  }

  const decisions =
    await db.orderDecision.findMany({
      where: {
        restaurantId: restaurantRecord.id,
      },
    });

  const decisionMap = new Map(
    decisions.map((decision) => [
      decision.shopifyOrderId,
      decision.status,
    ]),
  );

  const orders = shopifyOrders
    .filter(
      (order) =>
        getOrderRestaurantId(order) === RESTAURANT.id,
    )
    .map((order) => {
      const foodTotal = getFoodTotal(order);

      return {
        id: order.id,
        orderNumber: order.name,
        createdAt: order.createdAt,
        financialStatus:
          order.displayFinancialStatus,
        shopifyTotal: Number(
          order.currentTotalPriceSet?.shopMoney
            ?.amount || 0,
        ),
        foodTotal,
        commission: foodTotal * 0.1,
        status:
          decisionMap.get(order.id) || "NEW",
        items: (order.lineItems?.nodes || []).map(
          (item) => ({
            name: item.name,
            quantity: item.quantity,
          }),
        ),
      };
    });

  return {
    restaurant: {
      id: restaurantRecord.id,
      restaurantId:
        restaurantRecord.restaurantId,
      name: restaurantRecord.name,
      acceptingOrders:
        restaurantRecord.acceptingOrders,
    },
    orders,
    error: null,
  };
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();

  const intent = String(
    formData.get("intent") || "",
  );

  const shopifyOrderId = String(
    formData.get("shopifyOrderId") || "",
  );

  const orderNumber = String(
    formData.get("orderNumber") || "",
  );

  if (
    intent !== "accept-order" &&
    intent !== "reject-order"
  ) {
    return {
      success: false,
      message: "Invalid action.",
    };
  }

  if (!shopifyOrderId || !orderNumber) {
    return {
      success: false,
      message: "Order information is missing.",
    };
  }

  const restaurant =
    await db.restaurant.findUnique({
      where: {
        restaurantId: RESTAURANT.id,
      },
    });

  if (!restaurant) {
    return {
      success: false,
      message: "Restaurant not found.",
    };
  }

  /*
    SECURITY CHECK

    Before saving the decision, fetch the Shopify
    order again and confirm it really belongs to
    this restaurant.
  */

  const verifyResponse = await admin.graphql(
    `
      query VerifyOrder($id: ID!) {
        order(id: $id) {
          id
          name

          lineItems(first: 50) {
            nodes {
              customAttributes {
                key
                value
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

  const verifyResult =
    await verifyResponse.json();

  const shopifyOrder =
    verifyResult.data?.order;
    console.log("ORDER VERIFY:", {
  shopifyOrderId,
  orderNumber,
  restaurantExpected: RESTAURANT.id,
  restaurantFound: shopifyOrder
    ? getOrderRestaurantId(shopifyOrder)
    : "NO ORDER",
});

  if (
    !shopifyOrder ||
    getOrderRestaurantId(shopifyOrder) !==
      RESTAURANT.id
  ) {
    return {
      success: false,
      message:
        "This order does not belong to this restaurant.",
    };
  }

  const status =
    intent === "accept-order"
      ? "ACCEPTED"
      : "REJECTED";

  await db.orderDecision.upsert({
    where: {
      shopifyOrderId_restaurantId: {
        shopifyOrderId,
        restaurantId: restaurant.id,
      },
    },

    update: {
      status,
      orderNumber: shopifyOrder.name,
      decidedAt: new Date(),
    },

    create: {
      shopifyOrderId,
      orderNumber: shopifyOrder.name,
      restaurantId: restaurant.id,
      status,
    },
  });

  return {
    success: true,
    orderNumber: shopifyOrder.name,
    status,
  };
}

export default function Index() {
  const {
    restaurant,
    orders,
    error,
  } = useLoaderData();

  const actionData = useActionData();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const orderFetcher = useFetcher();

  useEffect(() => {
    const interval = setInterval(() => {
      revalidator.revalidate();
    }, 10000);

    return () => clearInterval(interval);
  }, [revalidator]);

  const [soundEnabled, setSoundEnabled] =
    useState(false);

  const audioContextRef = useRef(null);
  const alarmTimerRef = useRef(null);

  const newOrders = orders.filter(
    (order) => order.status === "NEW",
  );

  const acceptedOrders = orders.filter(
    (order) => order.status === "ACCEPTED",
  );

  const rejectedOrders = orders.filter(
    (order) => order.status === "REJECTED",
  );

  const firstNewOrder = newOrders[0];

  const acceptedFoodSales =
    acceptedOrders.reduce(
      (total, order) =>
        total + order.foodTotal,
      0,
    );

  const commission =
    acceptedFoodSales * 0.1;

  /*
    For now this is the food amount after
    Meal Deal Hub's 10% commission.

    Delivery will be separated once we pull
    the exact Shopify delivery amount.
  */

  const restaurantEarnings =
    acceptedFoodSales - commission;

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

  function formatTime(value) {
    return new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
      },
    ).format(new Date(value));
  }

  const isSubmitting =
    navigation.state === "submitting";

  return (
    <s-page heading={restaurant.name}>
      {error && (
        <s-section>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-heading>
              Order connection error
            </s-heading>

            <s-text>{error}</s-text>
          </s-box>
        </s-section>
      )}

      {actionData?.success && (
        <s-section>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-heading>
              ✓ {actionData.orderNumber}{" "}
              {actionData.status}
            </s-heading>
          </s-box>
        </s-section>
      )}

      {actionData?.success === false && (
        <s-section>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-heading>
              Action failed
            </s-heading>

            <s-text>
              {actionData.message}
            </s-text>
          </s-box>
        </s-section>
      )}

      {!soundEnabled && (
        <s-section>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-heading>
              Order Alert Sound
            </s-heading>

            <s-paragraph>
              Enable the terminal alarm so new
              orders sound a loud alert.
            </s-paragraph>

            <s-button
              variant="primary"
              onClick={enableSound}
            >
              ENABLE ORDER SOUND
            </s-button>
          </s-box>
        </s-section>
      )}

      {firstNewOrder && (
        <s-section heading="🔔 NEW ORDER">
          <s-box
            padding="large"
            borderWidth="base"
            borderRadius="base"
          >
            <s-stack
              direction="block"
              gap="base"
            >
              <s-heading>
                NEW ORDER{" "}
                {firstNewOrder.orderNumber}
              </s-heading>

              <s-heading>
                {money(
                  firstNewOrder.shopifyTotal,
                )}
              </s-heading>

              <s-text>
                Received:{" "}
                {formatTime(
                  firstNewOrder.createdAt,
                )}
              </s-text>

              {firstNewOrder.items.map(
                (item, index) => (
                  <s-heading key={index}>
                    {item.quantity} ×{" "}
                    {item.name}
                  </s-heading>
                ),
              )}

              <s-text>
                Payment:{" "}
                {
                  firstNewOrder.financialStatus
                }
              </s-text>

              <s-stack
                direction="inline"
                gap="base"
              >
                <orderFetcher.Form method="post">
                  <input
                    type="hidden"
                    name="intent"
                    value="accept-order"
                  />

                  <input
                    type="hidden"
                    name="shopifyOrderId"
                    value={firstNewOrder.id}
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
  disabled={isSubmitting}
>
  {isSubmitting
    ? "SAVING..."
    : "ACCEPT ORDER"}
</button>
                </orderFetcher.Form>

                <Form method="post">
                  <input
                    type="hidden"
                    name="intent"
                    value="reject-order"
                  />

                  <input
                    type="hidden"
                    name="shopifyOrderId"
                    value={firstNewOrder.id}
                  />

                  <input
                    type="hidden"
                    name="orderNumber"
                    value={
                      firstNewOrder.orderNumber
                    }
                  />

                  <s-button
                    type="submit"
                    tone="critical"
                    disabled={isSubmitting}
                  >
                    {isSubmitting
                      ? "SAVING..."
                      : "REJECT ORDER"}
                  </s-button>
                </Form>
              </s-stack>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {!firstNewOrder && (
        <s-section>
          <s-box
            padding="large"
            borderWidth="base"
            borderRadius="base"
          >
            <s-heading>
              ✓ No New Orders
            </s-heading>

            <s-text>
              New Meal Deal Hub orders will
              appear here automatically.
            </s-text>
          </s-box>
        </s-section>
      )}

      <s-section heading="Today's Overview">
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(190px, 1fr))"
          gap="base"
        >
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-text>NEW ORDERS</s-text>
            <s-heading>
              {newOrders.length}
            </s-heading>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-text>
              ACCEPTED ORDERS
            </s-text>

            <s-heading>
              {acceptedOrders.length}
            </s-heading>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-text>
              MEAL DEAL SALES
            </s-text>

            <s-heading>
              {money(acceptedFoodSales)}
            </s-heading>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-text>
              YOUR EARNINGS
            </s-text>

            <s-heading>
              {money(restaurantEarnings)}
            </s-heading>
          </s-box>
        </s-grid>
      </s-section>

      <s-section heading="Orders">
        <s-stack
          direction="block"
          gap="base"
        >
          {orders.map((order) => (
            <s-box
              key={order.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack
                direction="block"
                gap="small"
              >
                <s-heading>
                  {order.orderNumber}
                </s-heading>

                <s-text>
                  Received:{" "}
                  {formatTime(
                    order.createdAt,
                  )}
                </s-text>

                {order.items.map(
                  (item, index) => (
                    <s-text key={index}>
                      {item.quantity} ×{" "}
                      {item.name}
                    </s-text>
                  ),
                )}

                <s-heading>
                  Shopify total:{" "}
                  {money(
                    order.shopifyTotal,
                  )}
                </s-heading>

                <s-text>
                  Meal deals:{" "}
                  {money(order.foodTotal)}
                </s-text>

                <s-text>
                  Meal Deal Hub commission:{" "}
                  {money(order.commission)}
                </s-text>

                <s-text>
                  Payment:{" "}
                  {order.financialStatus}
                </s-text>

                <s-heading>
                  Status: {order.status}
                </s-heading>

                {order.status ===
                  "ACCEPTED" && (
                  <s-heading>
                    Restaurant receives:{" "}
                    {money(
                      order.foodTotal * 0.9,
                    )}
                  </s-heading>
                )}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Weekly Payout">
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
        >
          <s-heading>
            Next payout:{" "}
            {money(restaurantEarnings)}
          </s-heading>

          <s-paragraph>
            Period: Monday – Sunday
          </s-paragraph>

          <s-paragraph>
            Meal Deal Hub commission:{" "}
            {money(commission)}
          </s-paragraph>

          <s-paragraph>
            Rejected orders:{" "}
            {rejectedOrders.length}
          </s-paragraph>
        </s-box>
      </s-section>
    </s-page>
  );
}