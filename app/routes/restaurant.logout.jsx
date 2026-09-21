import { redirect } from "react-router";

const COOKIE_NAME = "mdh_restaurant_session";

function logout() {
  throw redirect("/restaurant/login", {
    headers: {
      "Set-Cookie": [
        `${COOKIE_NAME}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=0",
        "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        process.env.NODE_ENV === "production" ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; "),
    },
  });
}

export async function loader() {
  return logout();
}

export async function action() {
  return logout();
}

export default function RestaurantLogout() {
  return null;
}