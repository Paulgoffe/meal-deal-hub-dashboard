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

function jsonResponse(data, status = 200) {
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
METAFIELD IMAGE
=========================================================

Used for Shopify file/image reference metafields such as
the Restaurant Logo.
=========================================================
*/

function getMetafieldImageUrl(
  metafields,
  key,
) {
  const metafield =
    getMetafield(
      metafields,
      key,
    );

  if (!metafield) {
    return "";
  }

  const reference =
    metafield.reference;

  if (!reference) {
    return "";
  }

  if (
    reference.__typename ===
    "MediaImage"
  ) {
    return (
      reference
        ?.image
        ?.url || ""
    );
  }

  if (
    reference.__typename ===
    "GenericFile"
  ) {
    return (
      reference.url || ""
    );
  }

  return "";
}

/*
=========================================================
RATING
=========================================================
*/

function getRating(metafields) {
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

    return Number.isFinite(value)
      ? value
      : 0;
  } catch {
    const value =
      Number(
        metafield.value,
      );

    return Number.isFinite(value)
      ? value
      : 0;
  }
}

/*
=========================================================
DELIVERY ZONES
=========================================================
*/

function getDeliveryZones(metafields) {
  const raw = getMetafieldValue(
    metafields,
    "delivery_zones"
  );

  if (!raw) {
    return [];
  }

  const text = String(raw).toUpperCase();

  // Recognise delivery zones separated by
  // spaces, commas, or new lines.
  //
  // Examples:
  // MK1=2.00 MK2=3.00 MK3=3.50
  // MK1=2.00, MK2=3.00
  // MK1=2.00
  // MK2=3.00

  const matches = text.matchAll(
    /([A-Z]{1,2}\d[A-Z\d]?)\s*=\s*£?\s*(\d+(?:\.\d{1,2})?)/g
  );

  const zones = [];

  for (const match of matches) {
    const postcode = match[1];
    const price = Number(match[2]);

    if (Number.isFinite(price)) {
      zones.push(
        `${postcode}=${price.toFixed(2)}`
      );
    }
  }

  return zones;
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
      ?.url || ""
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
    product
      ?.variants
      ?.nodes || [];

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

    availableForSale:
      Boolean(
        firstVariant
          ?.availableForSale,
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
              variant
                .availableForSale,
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
FETCH RESTAURANT COLLECTIONS
=========================================================

Products are NOT requested here.

This keeps the Shopify GraphQL query cost low.
=========================================================
*/

async function fetchRestaurantCollections(
  admin,
) {
  const collections = [];

  let cursor = null;
  let hasNextPage = true;
  let page = 0;

  const MAX_PAGES = 10;

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
              first: 50
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
                }

                metafields(
                  first: 40
                  namespace: "custom"
                ) {
                  nodes {
                    namespace
                    key
                    type
                    value

                    reference {
                      __typename

                      ... on MediaImage {
                        image {
                          url
                          altText
                          width
                          height
                        }
                      }

                      ... on GenericFile {
                        url
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

    if (result.errors?.length) {
      console.error(
        "RESTAURANT COLLECTION QUERY ERROR:",
        JSON.stringify(
          result.errors,
        ),
      );

      throw new Error(
        "Could not load restaurant collections.",
      );
    }

    const connection =
      result
        ?.data
        ?.collections;

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
        ?.endCursor || null;

    if (!cursor) {
      hasNextPage = false;
    }
  }

  return collections;
}

/*
=========================================================
FETCH ONE RESTAURANT'S MEAL DEALS
=========================================================
*/

async function fetchCollectionProducts(
  admin,
  collectionId,
) {
  const products = [];

  let cursor = null;
  let hasNextPage = true;
  let page = 0;

  const MAX_PAGES = 10;

  while (
    hasNextPage &&
    page < MAX_PAGES
  ) {
    page += 1;

    const response =
      await admin.graphql(
        `
          query MealDealHubRestaurantProducts(
            $id: ID!
            $cursor: String
          ) {
            collection(id: $id) {
              products(
                first: 20
                after: $cursor
                sortKey: COLLECTION_DEFAULT
              ) {
                pageInfo {
                  hasNextPage
                  endCursor
                }

                nodes {
                  id
                  title
                  handle
                  description

                  featuredImage {
                    url
                    altText
                  }

                  priceRangeV2 {
                    minVariantPrice {
                      amount
                      currencyCode
                    }
                  }

                  variants(
                    first: 20
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
        `,
        {
          variables: {
            id:
              collectionId,

            cursor,
          },
        },
      );

    const result =
      await response.json();

    if (result.errors?.length) {
      console.error(
        "RESTAURANT PRODUCT QUERY ERROR:",
        collectionId,
        JSON.stringify(
          result.errors,
        ),
      );

      throw new Error(
        "Could not load restaurant meal deals.",
      );
    }

    const connection =
      result
        ?.data
        ?.collection
        ?.products;

    if (!connection) {
      return [];
    }

    const nodes =
      connection.nodes || [];

    products.push(
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
        ?.endCursor || null;

    if (!cursor) {
      hasNextPage = false;
    }
  }

  return products.map(
    buildProduct,
  );
}

/*
=========================================================
BUILD BASIC RESTAURANT
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

    /*
    Main restaurant / collection image
    */

    image:
      getImageUrl(
        collection,
      ),

    /*
    Restaurant logo from:
    custom.restaurant_logo
    */

    restaurantLogo:
      getMetafieldImageUrl(
        metafields,
        "restaurant_logo",
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

    deals: [],
  };
}

/*
=========================================================
NORMALISE RESTAURANT STATUS
=========================================================
*/

function normaliseStatus(
  status,
) {
  return String(
    status || "",
  )
    .toLowerCase()
    .replace(
      /[\[\]"']/g,
      "",
    )
    .trim();
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
    CONNECT TO SHOPIFY
    -----------------------------------------------------
    */

    const { admin } =
      await unauthenticated.admin(
        SHOP_DOMAIN,
      );

    /*
    -----------------------------------------------------
    LOAD RESTAURANT COLLECTIONS
    -----------------------------------------------------
    */

    const collections =
      await fetchRestaurantCollections(
        admin,
      );

    /*
    -----------------------------------------------------
    BUILD BASIC RESTAURANTS
    -----------------------------------------------------
    */

    const basicRestaurants =
      collections
        .map(
          buildRestaurant,
        )

        .filter(
          (restaurant) =>
            Boolean(
              restaurant
                .restaurantId,
            ),
        )

        .filter(
          (restaurant) =>
            normaliseStatus(
              restaurant.status,
            ) !== "inactive",
        )

        .sort(
          (a, b) =>
            a.name.localeCompare(
              b.name,
            ),
        );

    /*
    -----------------------------------------------------
    LOAD EACH RESTAURANT'S MEAL DEALS
    -----------------------------------------------------
    */

    const restaurants = [];

    for (
      const restaurant
      of basicRestaurants
    ) {
      try {
        const deals =
          await fetchCollectionProducts(
            admin,
            restaurant
              .shopifyCollectionId,
          );

        restaurants.push({
          ...restaurant,

          dealCount:
            deals.length,

          deals,
        });
      } catch (error) {
        console.error(
          "MEAL DEAL LOAD ERROR:",
          restaurant.name,
          error,
        );

        restaurants.push({
          ...restaurant,

          deals: [],
        });
      }
    }

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