import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  try {
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
  } catch (error) {
    console.error("ORDER TEST ERROR:", error);

    return {
      success: false,
      error: error?.message || "Shopify order test failed",
    };
  }
}

export default function TestOrders() {
  const data = useLoaderData();

  return (
    <div style={{ padding: "40px", fontFamily: "Arial, sans-serif" }}>
      <h1>Meal Deal Hub — Shopify Order Test</h1>

      <p>
        This test deliberately does not request customer name, address,
        email or phone.
      </p>

      <h2>{data.success ? "✅ Order query worked" : "❌ Order query failed"}</h2>

      <pre
        style={{
          background: "#f4f4f4",
          padding: "20px",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}