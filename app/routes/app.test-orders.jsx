import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query TestOrders {
      orders(first: 5, reverse: true) {
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

  return {
    success: !result.errors,
    result,
  };
}

export default function TestOrders() {
  const data = useLoaderData();

  return (
    <s-page heading="Shopify Order Test">
      <s-section>
        <h2>
          {data.success
            ? "✅ REAL SHOPIFY ORDERS CONNECTED"
            : "❌ ORDER QUERY FAILED"}
        </h2>

        <p>
          This test does not request customer name, address, email or phone.
        </p>

        <pre
          style={{
            background: "#f4f4f4",
            padding: "20px",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {JSON.stringify(data.result, null, 2)}
        </pre>
      </s-section>
    </s-page>
  );
}