import { unauthenticated } from "../shopify.server";

const SHOP_DOMAIN =
  process.env.SHOP_CUSTOM_DOMAIN ||
  "mealdealhub.myshopify.com";

/*
=========================================================
CORS
=========================================================
*/

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

/*
=========================================================
JSON RESPONSE
=========================================================
*/

function jsonResponse(
  data,
  status = 200,
) {
  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        ...corsHeaders(),
      },
    },
  );
}

/*
=========================================================
METAFIELD HELPERS
=========================================================
*/

function getMetafield(
  metafields,
  key,
) {
  return (
    metafields?.find(
      (metafield) =>
        metafield?.namespace ===
          "custom" &&
        metafield?.key === key,
    ) || null
  );
}

function getMetafieldValue(
  metafields,
  key,
) {
  return (
    getMetafield(
      metafields,
      key,
    )?.value || ""
  );
}

/*
=========================================================
RATING
=========================================================
*/

function getRating(
  metafields,
) {
  const metafield =
    getMetafield(
      metafields,
      "restaurant_rating",
    );

  if (!metafield?.value) {
    return 0;
  }

  /*
    Shopify rating metafields normally return JSON:

    {
      "value": "4.5",
      "scale_min": "1.0",
      "scale_max": "5.0"
    }

    We also support a plain numeric value just in case.
  */

  try {
    const parsed =
      JSON.parse(
        metafield.value,
      );

    const value =
      Number(
        parsed?.value ?? 0,
      );

    return Number.isFinite(
      value,
    )
      ? value
      : 0;
  } catch {
    const value =
      Number(
        metafield.value,
      );

    return Number.isFinite(
      value,
    )
      ? value
      : 0;
  }
}

/*
=========================================================
DELIVERY ZONES
=========================================================
*/

function getDeliveryZones(
  metafields,
) {
  const raw =
    getMetafieldValue(
      metafields,
      "delivery_zones",
    );

  if (!raw) {
    return [];
  }

  /*
    Supports:

    DE1, DE21, DE22

    or:

    DE1
    DE21
    DE22
  */

  return String(raw)
    .split(/[\n,]+/)
    .map((value) =>
      value
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
}

/*
=========================================================
OPENING HOURS
=========================================================
*/

function getOpeningHours(
  metafields,
) {
  const days = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];

  const hours = {};

  for (const day of days) {
    hours[day] = {
      opening:
        getMetafieldValue(
          metafields,
          `${day}_opening`,
        ),

      closing:
        getMetafieldValue(
          metafields,
          `${day}_closing`,
        ),
    };
  }

  return hours;
}

/*
=========================================================
IMAGE
=========================================================
*/

function getImageUrl(
  collection,
) {
  return (
    collection?.image?.url ||
    ""
  );
}

/*
=========================================================
SHOPIFY COLLECTIONS
=========================================================
*/

async function fetchRestaurantCollections(
  admin,
) {
  const collections = [];

  let cursor = null;
  let hasNextPage = true;

  /*
    More than enough for Meal Deal Hub now,
    while still supporting future restaurants.
  */

  const MAX_PAGES = 10;

  let page = 0;

  while (
    hasNextPage &&
    page < MAX_PAGES
  ) {
    page += 1;

    const response =
      await admin.graphql(
        `
          query MealDealHubRestaurants(
            $cursor: String
          ) {
            collections(
              first: 100
              after: $cursor
              sortKey: TITLE
            ) {
              pageInfo {
                hasNextPage
                endCursor
              }

              nodes {
                id
                title
                handle
                productsCount {
                  count
                }

                image {
                  url
                  altText
                  width
                  height
                }

                metafields(
                  first: 100
                  namespace: "custom"
                ) {
                  nodes {
                    namespace
                    key
                    type
                    value
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

    if (
      result.errors?.length
    ) {
      console.error(
        "RESTAURANT API SHOPIFY ERROR:",
        JSON.stringify(
          result.errors,
        ),
      );

      throw new Error(
        "Could not load restaurants from Shopify.",
      );
    }

    const connection =
      result.data?.collections;

    const nodes =
      connection?.nodes || [];

    collections.push(
      ...nodes,
    );

    hasNextPage =
      Boolean(
        connection?.pageInfo
          ?.hasNextPage,
      );

    cursor =
      connection?.pageInfo
        ?.endCursor ||
      null;

    if (!cursor) {
      hasNextPage = false;
    }
  }

  return collections;
}

/*
=========================================================
CONVERT SHOPIFY COLLECTION TO APP RESTAURANT
=========================================================
*/

function buildRestaurant(
  collection,
) {
  const metafields =
    collection?.metafields
      ?.nodes || [];

  const restaurantId =
    getMetafieldValue(
      metafields,
      "restaurant_id",
    );

  const status =
    getMetafieldValue(
      metafields,
      "restaurant_status",
    )
      .trim()
      .toLowerCase();

  const orderType =
    getMetafieldValue(
      metafields,
      "order_type",
    )
      .trim()
      .toLowerCase();

  return {
    shopifyCollectionId:
      collection.id,

    restaurantId,

    name:
      collection.title,

    handle:
      collection.handle,

    url:
      `https://mealdealhub.co.uk/collections/${collection.handle}`,

    image:
      getImageUrl(
        collection,
      ),

    status,

    orderType,

    rating:
      getRating(
        metafields,
      ),

    address:
      getMetafieldValue(
        metafields,
        "restaurant_address",
      ),

    postcode:
      getMetafieldValue(
        metafields,
        "restaurant_postcode",
      )
        .trim()
        .toUpperCase(),

    deliveryTime:
      getMetafieldValue(
        metafields,
        "delivery_time",
      ),

    deliveryZones:
      getDeliveryZones(
        metafields,
      ),

    minimumOrder:
      getMetafieldValue(
        metafields,
        "minimum_order",
      ),

    dealCount:
      Number(
        collection
          ?.productsCount
          ?.count || 0,
      ),

    openingHours:
      getOpeningHours(
        metafields,
      ),
  };
}

/*
=========================================================
OPTIONS
=========================================================

Allows the React Native app / web clients to
make requests to this endpoint.
=========================================================
*/

export async function action({
  request,
}) {
  if (
    request.method ===
    "OPTIONS"
  ) {
    return new Response(
      null,
      {
        status: 204,
        headers:
          corsHeaders(),
      },
    );
  }

  return jsonResponse(
    {
      success: false,
      error:
        "Method not allowed.",
    },
    405,
  );
}

/*
=========================================================
PUBLIC RESTAURANT API
=========================================================
*/

export async function loader() {
  try {
    /*
    -----------------------------------------------------
    SERVER-SIDE SHOPIFY CONNECTION
    -----------------------------------------------------

    The Admin API token remains on the server.

    Nothing private is sent to the mobile app.
    */

    const { admin } =
      await unauthenticated.admin(
        SHOP_DOMAIN,
      );

    /*
    -----------------------------------------------------
    LOAD COLLECTIONS
    -----------------------------------------------------
    */

    const collections =
      await fetchRestaurantCollections(
        admin,
      );

    /*
    -----------------------------------------------------
    BUILD RESTAURANTS
    -----------------------------------------------------
    */

    const restaurants =
      collections
        .map(
          buildRestaurant,
        )

        /*
          Only collections configured as restaurants
          should enter the app.

          Restaurant ID is the identifier already
          used by Meal Deal Hub.
        */

        .filter(
          (restaurant) =>
            Boolean(
              restaurant.restaurantId,
            ),
        )

        /*
          Same principle as the website:
          inactive restaurants do not appear.
        */

        .filter(
          (restaurant) =>
            restaurant.status !==
            "inactive",
        )

        .sort(
          (a, b) =>
            a.name.localeCompare(
              b.name,
            ),
        );

    /*
    -----------------------------------------------------
    SUCCESS
    -----------------------------------------------------
    */

    return jsonResponse({
      success: true,

      count:
        restaurants.length,

      restaurants,
    });
  } catch (error) {
    console.error(
      "PUBLIC RESTAURANT API ERROR:",
      error,
    );

    return jsonResponse(
      {
        success: false,

        count: 0,

        restaurants: [],

        error:
          "Could not load restaurants.",
      },
      500,
    );
  }
}