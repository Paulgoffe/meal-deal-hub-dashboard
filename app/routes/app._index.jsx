import {
  Form,
  useActionData,
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
import { authenticate } from "../shopify.server";
import db from "../db.server";

const RESTAURANT = {
  id: "Jamaica 2",
  name: "Mannies Aroma Jerk",
};

const SERVICE_FEE_PREFIX =
  "Meal Deal Hub Service Fee";

/*
=========================================================
HELPERS
=========================================================
*/

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value || 0));
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

  return (
    a === b ||
    a.includes(b) ||
    b.includes(a)
  );
}

function getAttribute(attributes, key) {
  return (
    attributes?.find(
      (attribute) =>
        attribute.key === key,
    )?.value || ""
  );
}

function getRestaurantId(lineItem) {
  return getAttribute(
    lineItem?.customAttributes,
    "_Restaurant ID",
  );
}

function getOrderRestaurantId(order) {
  for (
    const item of
    order.lineItems?.nodes || []
  ) {
    const restaurantId =
      getRestaurantId(item);

    if (restaurantId) {
      return restaurantId;
    }
  }

  return getAttribute(
    order.customAttributes,
    "_Restaurant ID",
  );
}

function isServiceFeeItem(item) {
  return String(
    item?.name || "",
  ).startsWith(
    SERVICE_FEE_PREFIX,
  );
}

function getFoodItems(order) {
  return (
    order.lineItems?.nodes || []
  ).filter(
    (item) =>
      !isServiceFeeItem(item),
  );
}

function getFoodTotal(order) {
  return getFoodItems(order).reduce(
    (total, item) => {
      const quantity =
        Number(
          item.quantity || 0,
        );

      const unitPrice =
        Number(
          item
            .originalUnitPriceSet
            ?.shopMoney
            ?.amount || 0,
        );

      return (
        total +
        unitPrice * quantity
      );
    },
    0,
  );
}

/*
=========================================================
SHOPIFY ORDERS
=========================================================
*/

async function fetchShopifyOrders(
  admin,
) {
  const allOrders = [];

  let cursor = null;
  let hasNextPage = true;
  let pageNumber = 0;

  /*
    5 × 100 gives us up to 500 recent
    Shopify orders rather than the old 50.
  */

  const MAX_PAGES = 5;

  while (
    hasNextPage &&
    pageNumber < MAX_PAGES
  ) {
    pageNumber += 1;

    const response =
      await admin.graphql(
        `
          query RestaurantOrders(
            $cursor: String
          ) {
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

                shippingLine {
                  title
                  code
                }

                currentTotalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }

                lineItems(first: 100) {
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
        `,
        {
          variables: {
            cursor,
          },
        },
      );

    const result =
      await response.json();

    if (result.errors?.length) {
      console.error(
        "SHOPIFY ORDER ERROR:",
        JSON.stringify(
          result.errors,
        ),
      );

      throw new Error(
        "Could not load Shopify orders.",
      );
    }

    const nodes =
      result.data?.orders?.nodes ||
      [];

    allOrders.push(...nodes);

    console.log(
      "SHOPIFY ADMIN ORDER PAGE:",
      {
        page: pageNumber,
        count: nodes.length,
        first:
          nodes[0]?.name || "",
        last:
          nodes[
            nodes.length - 1
          ]?.name || "",
      },
    );

    hasNextPage =
      Boolean(
        result.data?.orders
          ?.pageInfo
          ?.hasNextPage,
      );

    cursor =
      result.data?.orders
        ?.pageInfo
        ?.endCursor ||
      null;

    if (!cursor) {
      hasNextPage = false;
    }
  }

  return allOrders;
}

/*
=========================================================
ASSIGNED SHOPIFY LOCATION
=========================================================

Newer Meal Deal Hub orders do not always contain
_Restaurant ID.

When that ID is missing we check Shopify's assigned
fulfilment location.

For Mannies this has already been confirmed in the
Render logs as:

MANNIES AROMA JERK
=========================================================
*/

async function getAssignedLocations(
  admin,
  orderId,
  orderName = "",
) {
  try {
    const response =
      await admin.graphql(
        `
          query AssignedLocation(
            $id: ID!
          ) {
            order(id: $id) {
              fulfillmentOrders(
                first: 20
              ) {
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

    const result =
      await response.json();

    if (result.errors?.length) {
      console.error(
        "ADMIN ASSIGNED LOCATION ERROR:",
        {
          order:
            orderName,

          errors:
            result.errors,
        },
      );

      return [];
    }

    return (
      result.data?.order
        ?.fulfillmentOrders
        ?.nodes || []
    )
      .map(
        (fulfillmentOrder) =>
          fulfillmentOrder
            ?.assignedLocation
            ?.name || "",
      )
      .filter(Boolean);
  } catch (error) {
    console.error(
      "ADMIN ASSIGNED LOCATION LOOKUP FAILED:",
      {
        order:
          orderName,

        message:
          error?.message ||
          String(error),
      },
    );

    return [];
  }
}

/*
=========================================================
DOES ORDER BELONG TO MANNIES?
=========================================================
*/

async function orderBelongsToRestaurant(
  admin,
  order,
) {
  const foodItems =
    getFoodItems(order);

  /*
  -------------------------------------------------------
  1. NORMAL RESTAURANT ID MATCH
  -------------------------------------------------------
  */

  const restaurantIds =
    foodItems
      .map(
        (item) =>
          getRestaurantId(item),
      )
      .filter(Boolean);

  const lineItemIdMatch =
    restaurantIds.some(
      (restaurantId) =>
        normaliseText(
          restaurantId,
        ) ===
        normaliseText(
          RESTAURANT.id,
        ),
    );

  if (lineItemIdMatch) {
    return {
      matches: true,
      matchType:
        "restaurant-id",
      assignedLocations: [],
    };
  }

  /*
  -------------------------------------------------------
  2. ORDER-LEVEL RESTAURANT ID
  -------------------------------------------------------
  */

  const orderRestaurantId =
    getAttribute(
      order.customAttributes,
      "_Restaurant ID",
    );

  if (
    orderRestaurantId &&
    normaliseText(
      orderRestaurantId,
    ) ===
      normaliseText(
        RESTAURANT.id,
      )
  ) {
    return {
      matches: true,
      matchType:
        "order-restaurant-id",
      assignedLocations: [],
    };
  }

  /*
    If Shopify explicitly says the order belongs
    to another restaurant, do NOT use a fallback.
  */

  if (
    restaurantIds.length > 0 ||
    orderRestaurantId
  ) {
    return {
      matches: false,
      matchType:
        "different-restaurant",
      assignedLocations: [],
    };
  }

  /*
  -------------------------------------------------------
  3. ASSIGNED LOCATION FALLBACK
  -------------------------------------------------------
  */

  const assignedLocations =
    await getAssignedLocations(
      admin,
      order.id,
      order.name,
    );

  const assignedLocationMatch =
    assignedLocations.some(
      (locationName) =>
        textMatches(
          locationName,
          RESTAURANT.name,
        ),
    );

  if (assignedLocationMatch) {
    return {
      matches: true,
      matchType:
        "assigned-location",
      assignedLocations,
    };
  }

  /*
  -------------------------------------------------------
  4. SHIPPING LOCATION FALLBACK
  -------------------------------------------------------
  */

  const shippingLocation =
    order.shippingLine?.title ||
    order.shippingLine?.code ||
    "";

  if (
    textMatches(
      shippingLocation,
      RESTAURANT.name,
    )
  ) {
    return {
      matches: true,
      matchType:
        "shipping-location",
      assignedLocations,
    };
  }

  /*
  -------------------------------------------------------
  5. FOOD NAME FALLBACK
  -------------------------------------------------------
  */

  const foodNameMatch =
    foodItems.some(
      (item) =>
        textMatches(
          item.name,
          RESTAURANT.name,
        ),
    );

  if (foodNameMatch) {
    return {
      matches: true,
      matchType:
        "food-name",
      assignedLocations,
    };
  }

  return {
    matches: false,
    matchType: "none",
    assignedLocations,
  };
}

/*
=========================================================
LOADER
=========================================================
*/

export async function loader({
  request,
}) {
  const { admin } =
    await authenticate.admin(
      request,
    );

  let shopifyOrders = [];

  try {
    shopifyOrders =
      await fetchShopifyOrders(
        admin,
      );
  } catch (error) {
    console.error(
      "SHOPIFY ADMIN DASHBOARD LOAD ERROR:",
      error,
    );

    return {
      restaurant:
        RESTAURANT,

      orders: [],

      error:
        "Could not load Shopify orders.",
    };
  }

  const restaurantRecord =
    await db.restaurant.findUnique({
      where: {
        restaurantId:
          RESTAURANT.id,
      },
    });

  if (!restaurantRecord) {
    return {
      restaurant:
        RESTAURANT,

      orders: [],

      error:
        "Restaurant record not found.",
    };
  }

  const decisions =
    await db.orderDecision.findMany({
      where: {
        restaurantId:
          restaurantRecord.id,
      },
    });

  const decisionMap =
    new Map(
      decisions.map(
        (decision) => [
          decision.shopifyOrderId,
          String(
            decision.status || "",
          ).toUpperCase(),
        ],
      ),
    );

  const matchingOrders = [];

  /*
    Check each Shopify order against Mannies.

    Once an order has an explicit Restaurant ID,
    no assigned-location lookup is needed.
  */

  for (
    const order of
    shopifyOrders
  ) {
    const match =
      await orderBelongsToRestaurant(
        admin,
        order,
      );

    console.log(
      "SHOPIFY ADMIN ORDER MATCH:",
      {
        order:
          order.name,

        restaurant:
          RESTAURANT.id,

        match:
          match.matches,

        matchType:
          match.matchType,

        assignedLocations:
          match.assignedLocations,
      },
    );

    if (!match.matches) {
      continue;
    }

    const foodItems =
      getFoodItems(order);

    const foodTotal =
      getFoodTotal(order);

    matchingOrders.push({
      id:
        order.id,

      orderNumber:
        order.name,

      createdAt:
        order.createdAt,

      financialStatus:
        order.displayFinancialStatus,

      shopifyTotal:
        Number(
          order
            .currentTotalPriceSet
            ?.shopMoney
            ?.amount || 0,
        ),

      foodTotal,

      commission:
        foodTotal * 0.1,

      status:
        decisionMap.get(
          order.id,
        ) ||
        "NEW",

      items:
        foodItems.map(
          (item) => ({
            name:
              item.name,

            quantity:
              item.quantity,
          }),
        ),
    });
  }

  matchingOrders.sort(
    (a, b) =>
      new Date(
        b.createdAt,
      ).getTime() -
      new Date(
        a.createdAt,
      ).getTime(),
  );

  console.log(
    "SHOPIFY ADMIN DASHBOARD ORDERS:",
    matchingOrders.map(
      (order) => ({
        order:
          order.orderNumber,

        status:
          order.status,

        createdAt:
          order.createdAt,
      }),
    ),
  );

  return {
    restaurant: {
      id:
        restaurantRecord.id,

      restaurantId:
        restaurantRecord.restaurantId,

      name:
        restaurantRecord.name,

      acceptingOrders:
        restaurantRecord.acceptingOrders,
    },

    orders:
      matchingOrders,

    error: null,
  };
}

/*
=========================================================
ACTION
=========================================================

This keeps the existing Shopify Admin dashboard
decision behaviour.

The separate restaurant.dashboard.jsx payment
capture / void system is NOT changed.
=========================================================
*/

export async function action({
  request,
}) {
  const { admin } =
    await authenticate.admin(
      request,
    );

  const formData =
    await request.formData();

  const intent =
    String(
      formData.get("intent") ||
      "",
    );

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
    intent !==
      "accept-order" &&
    intent !==
      "reject-order"
  ) {
    return {
      success: false,
      message:
        "Invalid action.",
    };
  }

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

  const restaurant =
    await db.restaurant.findUnique({
      where: {
        restaurantId:
          RESTAURANT.id,
      },
    });

  if (!restaurant) {
    return {
      success: false,
      message:
        "Restaurant not found.",
    };
  }

  /*
  -------------------------------------------------------
  FETCH THE ORDER AGAIN
  -------------------------------------------------------
  */

  const verifyResponse =
    await admin.graphql(
      `
        query VerifyOrder(
          $id: ID!
        ) {
          order(id: $id) {
            id
            name

            customAttributes {
              key
              value
            }

            shippingLine {
              title
              code
            }

            lineItems(first: 100) {
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
      `,
      {
        variables: {
          id:
            shopifyOrderId,
        },
      },
    );

  const verifyResult =
    await verifyResponse.json();

  if (
    verifyResult.errors?.length
  ) {
    console.error(
      "ORDER VERIFY ERROR:",
      JSON.stringify(
        verifyResult.errors,
      ),
    );

    return {
      success: false,
      message:
        "Shopify order could not be verified.",
    };
  }

  const shopifyOrder =
    verifyResult.data?.order;

  if (!shopifyOrder) {
    return {
      success: false,
      message:
        "Shopify order could not be found.",
    };
  }

  if (
    shopifyOrder.name !==
    orderNumber
  ) {
    return {
      success: false,
      message:
        "Order verification failed.",
    };
  }

  /*
  -------------------------------------------------------
  VERIFY OWNERSHIP USING THE SAME NEW MATCHING SYSTEM
  -------------------------------------------------------
  */

  const match =
    await orderBelongsToRestaurant(
      admin,
      shopifyOrder,
    );

  console.log(
    "ORDER VERIFY:",
    {
      shopifyOrderId,

      orderNumber,

      restaurantExpected:
        RESTAURANT.id,

      matches:
        match.matches,

      matchType:
        match.matchType,

      assignedLocations:
        match.assignedLocations,
    },
  );

  if (!match.matches) {
    return {
      success: false,

      message:
        "This order does not belong to this restaurant.",
    };
  }

  const status =
    intent ===
    "accept-order"
      ? "ACCEPTED"
      : "REJECTED";

  await db.orderDecision.upsert({
    where: {
      shopifyOrderId_restaurantId:
        {
          shopifyOrderId,

          restaurantId:
            restaurant.id,
        },
    },

    update: {
      status,

      orderNumber:
        shopifyOrder.name,

      decidedAt:
        new Date(),
    },

    create: {
      shopifyOrderId,

      orderNumber:
        shopifyOrder.name,

      restaurantId:
        restaurant.id,

      status,
    },
  });

  return {
    success: true,

    orderNumber:
      shopifyOrder.name,

    status,
  };
}

/*
=========================================================
SHOPIFY ADMIN DASHBOARD UI
=========================================================
*/

export default function Index() {
  const {
    restaurant,
    orders,
    error,
  } = useLoaderData();

  const actionData =
    useActionData();

  const navigation =
    useNavigation();

  const revalidator =
    useRevalidator();

  const orderFetcher =
    useFetcher();

  /*
  -------------------------------------------------------
  AUTO REFRESH
  -------------------------------------------------------
  */

  useEffect(() => {
    const interval =
      setInterval(() => {
        if (
          revalidator.state ===
          "idle" &&
          orderFetcher.state ===
          "idle"
        ) {
          revalidator.revalidate();
        }
      }, 10000);

    return () =>
      clearInterval(interval);
  }, [
    revalidator,
    revalidator.state,
    orderFetcher.state,
  ]);

  /*
    Revalidate immediately after an orderFetcher
    Accept action completes.
  */

  useEffect(() => {
    if (
      orderFetcher.state ===
        "idle" &&
      orderFetcher.data?.success
    ) {
      revalidator.revalidate();
    }
  }, [
    orderFetcher.state,
    orderFetcher.data,
    revalidator,
  ]);

  const [
    soundEnabled,
    setSoundEnabled,
  ] = useState(false);

  const audioContextRef =
    useRef(null);

  const alarmTimerRef =
    useRef(null);

  const newOrders =
    orders.filter(
      (order) =>
        order.status ===
        "NEW",
    );

  const acceptedOrders =
    orders.filter(
      (order) =>
        order.status ===
        "ACCEPTED",
    );

  const rejectedOrders =
    orders.filter(
      (order) =>
        order.status ===
        "REJECTED",
    );

  const firstNewOrder =
    newOrders[0];

  const acceptedFoodSales =
    acceptedOrders.reduce(
      (total, order) =>
        total +
        order.foodTotal,
      0,
    );

  const commission =
    acceptedFoodSales * 0.1;

  const restaurantEarnings =
    acceptedFoodSales -
    commission;

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

      if (!AudioContext) {
        return;
      }

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

  function formatTime(value) {
    return new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone:
          "Europe/London",

        hour:
          "2-digit",

        minute:
          "2-digit",
      },
    ).format(
      new Date(value),
    );
  }

  const isSubmitting =
    navigation.state ===
      "submitting" ||
    orderFetcher.state !==
      "idle";

  return (
    <s-page
      heading={
        restaurant.name
      }
    >
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

            <s-text>
              {error}
            </s-text>
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
              ✓{" "}
              {
                actionData.orderNumber
              }{" "}
              {
                actionData.status
              }
            </s-heading>
          </s-box>
        </s-section>
      )}

      {actionData?.success ===
        false && (
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
              {
                actionData.message
              }
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
              Enable the terminal
              alarm so new orders
              sound a loud alert.
            </s-paragraph>

            <s-button
              variant="primary"
              onClick={
                enableSound
              }
            >
              ENABLE ORDER SOUND
            </s-button>
          </s-box>
        </s-section>
      )}

      {firstNewOrder && (
        <s-section
          heading="🔔 NEW ORDER"
        >
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
                {
                  firstNewOrder.orderNumber
                }
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
                (
                  item,
                  index,
                ) => (
                  <s-heading
                    key={
                      index
                    }
                  >
                    {
                      item.quantity
                    }{" "}
                    ×{" "}
                    {
                      item.name
                    }
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
                    disabled={
                      isSubmitting
                    }
                  >
                    {isSubmitting
                      ? "SAVING..."
                      : "ACCEPT ORDER"}
                  </button>
                </orderFetcher.Form>

                <Form
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

                  <s-button
                    type="submit"
                    tone="critical"
                    disabled={
                      isSubmitting
                    }
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
              New Meal Deal Hub
              orders will appear
              here automatically.
            </s-text>
          </s-box>
        </s-section>
      )}

      <s-section
        heading="Today's Overview"
      >
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(190px, 1fr))"
          gap="base"
        >
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-text>
              NEW ORDERS
            </s-text>

            <s-heading>
              {
                newOrders.length
              }
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
              {
                acceptedOrders.length
              }
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
              {money(
                acceptedFoodSales,
              )}
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
              {money(
                restaurantEarnings,
              )}
            </s-heading>
          </s-box>
        </s-grid>
      </s-section>

      <s-section
        heading="Orders"
      >
        <s-stack
          direction="block"
          gap="base"
        >
          {orders.map(
            (order) => (
              <s-box
                key={
                  order.id
                }
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack
                  direction="block"
                  gap="small"
                >
                  <s-heading>
                    {
                      order.orderNumber
                    }
                  </s-heading>

                  <s-text>
                    Received:{" "}
                    {formatTime(
                      order.createdAt,
                    )}
                  </s-text>

                  {order.items.map(
                    (
                      item,
                      index,
                    ) => (
                      <s-text
                        key={
                          index
                        }
                      >
                        {
                          item.quantity
                        }{" "}
                        ×{" "}
                        {
                          item.name
                        }
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
                    {money(
                      order.foodTotal,
                    )}
                  </s-text>

                  <s-text>
                    Meal Deal Hub
                    commission:{" "}
                    {money(
                      order.commission,
                    )}
                  </s-text>

                  <s-text>
                    Payment:{" "}
                    {
                      order.financialStatus
                    }
                  </s-text>

                  <s-heading>
                    Status:{" "}
                    {
                      order.status
                    }
                  </s-heading>

                  {order.status ===
                    "ACCEPTED" && (
                    <s-heading>
                      Restaurant
                      receives:{" "}
                      {money(
                        order.foodTotal *
                          0.9,
                      )}
                    </s-heading>
                  )}
                </s-stack>
              </s-box>
            ),
          )}
        </s-stack>
      </s-section>

      <s-section
        heading="Weekly Payout"
      >
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
        >
          <s-heading>
            Next payout:{" "}
            {money(
              restaurantEarnings,
            )}
          </s-heading>

          <s-paragraph>
            Period: Monday – Sunday
          </s-paragraph>

          <s-paragraph>
            Meal Deal Hub
            commission:{" "}
            {money(
              commission,
            )}
          </s-paragraph>

          <s-paragraph>
            Rejected orders:{" "}
            {
              rejectedOrders.length
            }
          </s-paragraph>
        </s-box>
      </s-section>
    </s-page>
  );
}