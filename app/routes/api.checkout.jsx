const SHOPIFY_STORE_DOMAIN =
  'bite-pfyaja4s.myshopify.com';

const STOREFRONT_API_VERSION = '2026-10';

const CART_CREATE_MUTATION = `
  mutation CartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
        totalQuantity

        cost {
          subtotalAmount {
            amount
            currencyCode
          }

          totalAmount {
            amount
            currencyCode
          }
        }
      }

      userErrors {
        field
        message
        code
      }

      warnings {
        code
        message
      }
    }
  }
`;

/*
=========================================================
CORS
=========================================================
*/

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Content-Type',
    'Access-Control-Allow-Methods':
      'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
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
        'Content-Type':
          'application/json; charset=utf-8',

        ...corsHeaders(),
      },
    }
  );
}

/*
=========================================================
LOADER
=========================================================

This handles GET requests to /api/checkout.

We need this because opening /api/checkout in a browser
sends a GET request.

=========================================================
*/

export async function loader() {
  return jsonResponse({
    success: true,
    message:
      'Meal Deal Hub checkout API is live. Use POST to create a Shopify checkout.',
  });
}

/*
=========================================================
ACTION
=========================================================

This handles POST requests from the Meal Deal Hub app.

=========================================================
*/

export async function action({
  request,
}) {
  try {
    /*
    =====================================================
    OPTIONS / CORS
    =====================================================
    */

    if (
      request.method ===
      'OPTIONS'
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers:
            corsHeaders(),
        }
      );
    }

    /*
    =====================================================
    ONLY ALLOW POST
    =====================================================
    */

    if (
      request.method !==
      'POST'
    ) {
      return jsonResponse(
        {
          success: false,
          error:
            'Method not allowed.',
        },
        405
      );
    }

    /*
    =====================================================
    READ REQUEST BODY
    =====================================================
    */

    let body;

    try {
      body =
        await request.json();
    } catch (error) {
      return jsonResponse(
        {
          success: false,
          error:
            'Invalid request body.',
        },
        400
      );
    }

    /*
    =====================================================
    CART ITEMS
    =====================================================
    */

    const items =
      Array.isArray(
        body?.items
      )
        ? body.items
        : [];

    const restaurantId =
      typeof body?.restaurantId ===
      'string'
        ? body.restaurantId.trim()
        : '';

    const restaurantName =
      typeof body?.restaurantName ===
      'string'
        ? body.restaurantName.trim()
        : '';

    const orderType =
      typeof body?.orderType ===
      'string'
        ? body.orderType
            .trim()
            .toLowerCase()
        : '';

    /*
    =====================================================
    EMPTY CART
    =====================================================
    */

    if (
      items.length === 0
    ) {
      return jsonResponse(
        {
          success: false,
          error:
            'Your cart is empty.',
        },
        400
      );
    }

    /*
    =====================================================
    BUILD SHOPIFY CART LINES
    =====================================================
    */

    const lines = [];

    for (
      const item of items
    ) {
      const variantId =
        typeof item?.variantId ===
        'string'
          ? item.variantId.trim()
          : '';

      const quantity =
        Number(
          item?.quantity
        );

      /*
      ---------------------------------------------------
      VALIDATE SHOPIFY VARIANT ID
      ---------------------------------------------------
      */

      if (
        !variantId ||
        !variantId.startsWith(
          'gid://shopify/ProductVariant/'
        )
      ) {
        return jsonResponse(
          {
            success: false,
            error:
              'One or more cart items are missing a valid Shopify variant ID.',
          },
          400
        );
      }

      /*
      ---------------------------------------------------
      VALIDATE QUANTITY
      ---------------------------------------------------
      */

      if (
        !Number.isInteger(
          quantity
        ) ||
        quantity < 1 ||
        quantity > 99
      ) {
        return jsonResponse(
          {
            success: false,
            error:
              'One or more cart items have an invalid quantity.',
          },
          400
        );
      }

      lines.push({
        merchandiseId:
          variantId,

        quantity,
      });
    }

    /*
    =====================================================
    STOREFRONT ACCESS TOKEN
    =====================================================
    */

    const storefrontAccessToken =
      process.env
        .SHOPIFY_STOREFRONT_ACCESS_TOKEN;

    if (
      !storefrontAccessToken
    ) {
      console.error(
        'SHOPIFY_STOREFRONT_ACCESS_TOKEN is missing.'
      );

      return jsonResponse(
        {
          success: false,
          error:
            'Checkout is not configured yet.',
        },
        500
      );
    }

    /*
    =====================================================
    CART ATTRIBUTES
    =====================================================
    */

    const attributes = [];

    if (restaurantId) {
      attributes.push({
        key:
          'restaurant_id',
        value:
          restaurantId,
      });
    }

    if (restaurantName) {
      attributes.push({
        key:
          'restaurant_name',
        value:
          restaurantName,
      });
    }

    if (orderType) {
      attributes.push({
        key:
          'order_type',
        value:
          orderType,
      });
    }

    attributes.push({
      key:
        'order_source',
      value:
        'Meal Deal Hub App',
    });

    /*
    =====================================================
    CREATE SHOPIFY CART
    =====================================================
    */

    const shopifyResponse =
      await fetch(
        `https://${SHOPIFY_STORE_DOMAIN}/api/${STOREFRONT_API_VERSION}/graphql.json`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            'X-Shopify-Storefront-Access-Token':
              storefrontAccessToken,
          },

          body:
            JSON.stringify(
              {
                query:
                  CART_CREATE_MUTATION,

                variables: {
                  input: {
                    lines,
                    attributes,
                  },
                },
              }
            ),
        }
      );

    /*
    =====================================================
    READ SHOPIFY RESPONSE
    =====================================================
    */

    let shopifyData;

    try {
      shopifyData =
        await shopifyResponse.json();
    } catch (error) {
      console.error(
        'Could not read Shopify response:',
        error
      );

      return jsonResponse(
        {
          success: false,
          error:
            'Shopify returned an invalid response.',
        },
        502
      );
    }

    /*
    =====================================================
    SHOPIFY HTTP ERROR
    =====================================================
    */

    if (
      !shopifyResponse.ok
    ) {
      console.error(
        'Shopify checkout HTTP error:',
        shopifyResponse.status,
        shopifyData
      );

      return jsonResponse(
        {
          success: false,
          error:
            'Shopify could not create the checkout.',
        },
        502
      );
    }

    /*
    =====================================================
    GRAPHQL ERRORS
    =====================================================
    */

    if (
      Array.isArray(
        shopifyData?.errors
      ) &&
      shopifyData.errors
        .length > 0
    ) {
      console.error(
        'Shopify GraphQL errors:',
        shopifyData.errors
      );

      return jsonResponse(
        {
          success: false,

          error:
            shopifyData
              .errors[0]
              ?.message ||
            'Shopify could not create the checkout.',

          details:
            shopifyData.errors,
        },
        502
      );
    }

    /*
    =====================================================
    CART CREATE RESULT
    =====================================================
    */

    const cartCreate =
      shopifyData?.data
        ?.cartCreate;

    if (!cartCreate) {
      console.error(
        'Shopify returned no cartCreate result:',
        shopifyData
      );

      return jsonResponse(
        {
          success: false,
          error:
            'Shopify did not return a cart.',
        },
        502
      );
    }

    /*
    =====================================================
    CART USER ERRORS
    =====================================================
    */

    const userErrors =
      Array.isArray(
        cartCreate.userErrors
      )
        ? cartCreate.userErrors
        : [];

    if (
      userErrors.length >
      0
    ) {
      console.error(
        'Shopify cart errors:',
        userErrors
      );

      return jsonResponse(
        {
          success: false,

          error:
            userErrors[0]
              ?.message ||
            'Shopify could not create the cart.',

          details:
            userErrors,
        },
        400
      );
    }

    /*
    =====================================================
    CART
    =====================================================
    */

    const cart =
      cartCreate.cart;

    if (!cart) {
      console.error(
        'Shopify returned an empty cart:',
        shopifyData
      );

      return jsonResponse(
        {
          success: false,
          error:
            'Shopify did not return a cart.',
        },
        502
      );
    }

    /*
    =====================================================
    CHECKOUT URL
    =====================================================
    */

    const checkoutUrl =
      cart.checkoutUrl ||
      '';

    if (!checkoutUrl) {
      console.error(
        'Shopify returned no checkout URL:',
        shopifyData
      );

      return jsonResponse(
        {
          success: false,
          error:
            'Shopify did not return a checkout URL.',
        },
        502
      );
    }

    /*
    =====================================================
    SUCCESS
    =====================================================
    */

    return jsonResponse({
      success: true,

      cartId:
        cart.id,

      checkoutUrl,

      totalQuantity:
        cart.totalQuantity,

      subtotal:
        cart.cost
          ?.subtotalAmount ||
        null,

      total:
        cart.cost
          ?.totalAmount ||
        null,
    });
  } catch (error) {
    console.error(
      'Checkout API error:',
      error
    );

    return jsonResponse(
      {
        success: false,
        error:
          'Something went wrong while creating the checkout.',
      },
      500
    );
  }
}