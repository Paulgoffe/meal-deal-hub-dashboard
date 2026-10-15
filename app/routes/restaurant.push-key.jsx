/*
=========================================================
MEAL DEAL HUB
PUBLIC PUSH NOTIFICATION KEY
=========================================================
*/

export async function loader() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;

  if (!publicKey) {
    return Response.json(
      {
        success: false,
        message: "Push notifications are not configured.",
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      success: true,
      publicKey,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}