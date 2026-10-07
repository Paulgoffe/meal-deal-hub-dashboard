import { unauthenticated } from "../shopify.server";

/*
=========================================================
SHOPIFY STORE
=========================================================
*/

const SHOP_DOMAIN =
  "bite-pfyaja4s.myshopify.com";

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
COLLECTION IMAGE
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
PRODUCT IMAGE
=========================================================
*/

function getProductImageUrl(
  product,
) {
  return (
    product
      ?.featuredImage
      ?.url ||
    ""
  );
}

/*
=========================================================
PRODUCT PRICE
=========================================================
*/

function getProductPrice(
  product,
) {
  const amount =
    product
      ?.priceRangeV2
      ?.minVariantPrice
      ?.amount || "0.00";

  const currencyCode =
    product
      ?.priceRangeV2
      ?.minVariantPrice
      ?.currencyCode || "GBP";

  return {
    amount,
    currencyCode,
  };
}

/*
=========================================================
BUILD PRODUCT / MEAL DEAL
=========================================================
*/

function buildProduct(
  product,
) {
  const variants =
    product?.variants?.nodes || [];

  const firstVariant =
    variants[0] || null;

  return {
    id:
      product.id,

    title:
      product.title,

    handle:
      product.handle,

    description:
      product.description || "",

    descriptionHtml:
      product.descriptionHtml || "",

    availableForSale:
      Boolean(
        product.totalInventory ===
          null ||
        product.totalInventory > 0,
      ),

    image:
      getProductImageUrl(
        product,
      ),

    price:
      getProductPrice(
        product,
      ),

    url:
      `https://mealdealhub.co.uk/products/${product.handle}`,

    variantId:
      firstVariant?.id || "",

    variantTitle:
      firstVariant?.title || "",

    variantPrice:
      firstVariant?.price || null,

    variants:
      variants.map(
        (variant) => ({
          id:
            variant.id,

          title:
            variant.title,

          availableForSale:
            Boolean(
              variant.availableForSale,
            ),

          price:
            variant.price,

          image:
            variant
              ?.image
              ?.url || "",
        }),
      ),
  };
}

/*
=========================================================
SHOPIFY COLLECTIONS + PRODUCTS
=========================================================
*/

async function fetchRestaurantCollections(
  admin,
) {
  const collections = [];

  let cursor = null;
  let hasNextPage = true;

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

                products(
                  first: 100
                  sortKey: COLLECTION_DEFAULT
                ) {
                  nodes {
                    id
                    title
                    handle
                    description
                    descriptionHtml
                    totalInventory

                    featuredImage {
                      url
                      altText
                      width
                      height
                    }

                    priceRangeV2 {
                      minVariantPrice {
                        amount
                        currencyCode
                      }

                      maxVariantPrice {
                        amount
                        currencyCode
                      }
                    }

                    variants(
                      first: 100
                    ) {
                      nodes {
                        id
                        title
                        availableForSale

                        price

                        image {
                          url
                          altText
                        }
                      }
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
        connection
          ?.pageInfo
          ?.hasNextPage,
      );

    cursor =
      connection
        ?.pageInfo
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
    collection
      ?.metafields
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

  /*
  -------------------------------------------------------
  PRODUCTS / MEAL DEALS
  -------------------------------------------------------
  */

  const products =
    collection
      ?.products
      ?.nodes || [];

  const deals =
    products.map(
      buildProduct,
    );

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
      deals.length,

    openingHours:
      getOpeningHours(
        metafields,
      ),

    /*
    -----------------------------------------------------
    ACTUAL MEAL DEAL PRODUCTS
    -----------------------------------------------------
    */

    deals,
  };
}

/*
=========================================================
OPTIONS
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

    Uses the existing offline Shopify session stored
    securely in Prisma.

    Shopify Admin credentials stay on the server.

    They are never sent to the mobile application.
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
        -------------------------------------------------
        ONLY RESTAURANT COLLECTIONS
        -------------------------------------------------
        */

        .filter(
          (restaurant) =>
            Boolean(
              restaurant.restaurantId,
            ),
        )

        /*
        -------------------------------------------------
        HIDE INACTIVE RESTAURANTS
        -------------------------------------------------
        */

        .filter(
          (restaurant) => {
            const status =
              String(
                restaurant.status ||
                  "",
              )
                .toLowerCase()
                .replace(
                  /[\[\]"']/g,
                  "",
                )
                .trim();

            return (
              status !==
              "inactive"
            );
          },
        )

        /*
        -------------------------------------------------
        ALPHABETICAL ORDER
        -------------------------------------------------
        */

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