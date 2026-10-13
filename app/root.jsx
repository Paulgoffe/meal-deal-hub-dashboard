import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";

import { useEffect } from "react";

export default function App() {
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        console.log(
          "Meal Deal Hub: Screen active again."
        );
      }
    }

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
  }, []);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />

        <meta
          name="viewport"
          content="width=device-width,initial-scale=1"
        />

        <meta
          name="theme-color"
          content="#111111"
        />

        <link
          rel="preconnect"
          href="https://cdn.shopify.com/"
        />

        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />

        <Meta />
        <Links />
      </head>

      <body>
        <Outlet />

        <ScrollRestoration />

        <Scripts />
      </body>
    </html>
  );
}

/*
=========================================================
MEAL DEAL HUB — APPLICATION ERROR RECOVERY
=========================================================

If a phone temporarily loses its connection after
standby, show a friendly recovery screen rather than
the technical React Router error.

This does not alter order acceptance, Shopify payments,
restaurant accounts or payout calculations.
*/

export function ErrorBoundary() {
  const error = useRouteError();

  const isNetworkError =
    error instanceof TypeError &&
    /failed to fetch|network|load failed/i.test(
      error.message || ""
    );

  const isResponseError =
    isRouteErrorResponse(error);

  const isNotFound =
    isResponseError &&
    error.status === 404;

  useEffect(() => {
    if (!isNetworkError) {
      return;
    }

    let retryTimer = null;

    function retryConnection() {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine
      ) {
        window.location.reload();
      }
    }

    window.addEventListener(
      "online",
      retryConnection
    );

    function handleVisibilityChange() {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine
      ) {
        retryTimer = window.setTimeout(
          retryConnection,
          1500
        );
      }
    }

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    return () => {
      window.removeEventListener(
        "online",
        retryConnection
      );

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [isNetworkError]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />

        <meta
          name="viewport"
          content="width=device-width,initial-scale=1"
        />

        <meta
          name="theme-color"
          content="#111111"
        />

        <title>Meal Deal Hub</title>

        <Meta />
        <Links />
      </head>

      <body
        style={{
          margin: 0,
          background: "#F5F5F5",
          color: "#111111",
          fontFamily:
            "Arial, Helvetica, sans-serif",
        }}
      >
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            boxSizing: "border-box",
          }}
        >
          <section
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#FFFFFF",
              borderRadius: 20,
              padding: 30,
              textAlign: "center",
              boxSizing: "border-box",
              borderBottom:
                "6px solid #FFD400",
              boxShadow:
                "0 8px 30px rgba(0,0,0,0.08)",
            }}
          >
            <img
              src="/meal-deal-hub-logo.png"
              alt="Meal Deal Hub"
              style={{
                width: 110,
                height: 110,
                objectFit: "contain",
                marginBottom: 15,
              }}
            />

            <h1
              style={{
                fontSize: 26,
                marginBottom: 12,
              }}
            >
              {isNotFound
                ? "Page Not Found"
                : isNetworkError
                  ? "Reconnecting..."
                  : "Something Went Wrong"}
            </h1>

            <p
              style={{
                color: "#666666",
                lineHeight: 1.6,
                marginBottom: 25,
              }}
            >
              {isNotFound
                ? "The page you requested could not be found."
                : isNetworkError
                  ? "Your connection was interrupted. Please reconnect to the internet and try again."
                  : "We couldn't load this page. Please try again."}
            </p>

            <button
              type="button"
              onClick={() =>
                window.location.reload()
              }
              style={{
                width: "100%",
                padding: "16px 20px",
                border: 0,
                borderRadius: 12,
                background: "#FFD400",
                color: "#111111",
                fontSize: 16,
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              TRY AGAIN
            </button>

            <p
              style={{
                marginTop: 20,
                color: "#777777",
                fontSize: 12,
              }}
            >
              MEAL DEAL HUB
            </p>
          </section>
        </main>

        <Scripts />
      </body>
    </html>
  );
}