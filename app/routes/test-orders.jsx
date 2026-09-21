import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  try {
    const { admin } = await authenticate.admin(request);

    const response = await admin.graphql(`
      #graphql
      query TestOrders {
        orders(first: 5, reverse: true) {
          nodes {
            id
            name
            createdAt

            lineItems(first: 20) {
              nodes {
                name
                quantity

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

    return Response.json(result);
  } catch (error) {
    console.error("ORDER TEST ERROR:", error);

    return Response.json(
      {
        success: false,
        error:
          error?.message ||
          "Shopify order test failed",
      },
      { status: 500 },
    );
  }
}

export default function TestOrders() {
  return null;
}