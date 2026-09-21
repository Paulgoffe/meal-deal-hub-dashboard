import { useEffect, useRef, useState } from "react";

const RESTAURANT = {
  id: "Jamaica 2",
  name: "Mannies Aroma Jerk",
};

const STARTING_ORDERS = [
  {
    id: "1001",
    orderNumber: "#1001",
    restaurantId: "Jamaica 2",
    time: "11:45",
    customer: "Test Customer",
    items: [
      {
        name: "Jerk Chicken Meal Deal",
        quantity: 2,
      },
      {
        name: "Caribbean Drinks",
        quantity: 2,
      },
    ],
    foodTotal: 30,
    delivery: 2.5,
    serviceFee: 0.42,
    status: "new",
  },
  {
    id: "1002",
    orderNumber: "#1002",
    restaurantId: "PETERS 1",
    time: "11:50",
    customer: "Another Customer",
    items: [
      {
        name: "Chicken Meal Deal",
        quantity: 1,
      },
    ],
    foodTotal: 20,
    delivery: 3,
    serviceFee: 0.42,
    status: "new",
  },
];

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value);
}

export default function Index() {
  const [orders, setOrders] = useState(STARTING_ORDERS);
  const [paused, setPaused] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);

  const audioContextRef = useRef(null);
  const alarmTimerRef = useRef(null);

  const restaurantOrders = orders.filter(
    (order) => order.restaurantId === RESTAURANT.id,
  );

  const newOrders = restaurantOrders.filter(
    (order) => order.status === "new",
  );

  const firstNewOrder = newOrders[0];

  function stopAlarm() {
    if (alarmTimerRef.current) {
      clearInterval(alarmTimerRef.current);
      alarmTimerRef.current = null;
    }
  }

  function makeAlarmSound() {
    try {
      const AudioContext =
        window.AudioContext || window.webkitAudioContext;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const context = audioContextRef.current;

      if (context.state === "suspended") {
        context.resume();
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "square";
      oscillator.frequency.value = 880;

      gain.gain.setValueAtTime(
        0.9,
        context.currentTime,
      );

      gain.gain.exponentialRampToValueAtTime(
        0.01,
        context.currentTime + 0.7,
      );

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start();
      oscillator.stop(context.currentTime + 0.7);
    } catch (error) {
      console.log("Alarm unavailable", error);
    }
  }

  function enableSound() {
    setSoundEnabled(true);
    makeAlarmSound();
  }

  useEffect(() => {
    stopAlarm();

    if (newOrders.length > 0 && soundEnabled) {
      makeAlarmSound();

      alarmTimerRef.current = setInterval(() => {
        makeAlarmSound();
      }, 1500);
    }

    return () => stopAlarm();
  }, [newOrders.length, soundEnabled]);

  function updateOrder(id, status) {
    setOrders((current) =>
      current.map((order) =>
        order.id === id &&
        order.restaurantId === RESTAURANT.id
          ? { ...order, status }
          : order,
      ),
    );
  }

  const acceptedOrders = restaurantOrders.filter(
    (order) => order.status === "accepted",
  );

  const foodSales = acceptedOrders.reduce(
    (total, order) => total + order.foodTotal,
    0,
  );

  const deliveryIncome = acceptedOrders.reduce(
    (total, order) => total + order.delivery,
    0,
  );

  const commission = foodSales * 0.1;

  const restaurantEarnings =
    foodSales * 0.9 + deliveryIncome;

  const serviceFees = acceptedOrders.reduce(
    (total, order) => total + order.serviceFee,
    0,
  );

  return (
    <s-page heading={RESTAURANT.name}>
      {!soundEnabled && (
        <s-section>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-heading>Order Alert Sound</s-heading>

            <s-paragraph>
              Enable the terminal alarm so new orders sound
              a loud alert.
            </s-paragraph>

            <s-button
              variant="primary"
              onClick={enableSound}
            >
              ENABLE ORDER SOUND
            </s-button>
          </s-box>
        </s-section>
      )}

      {firstNewOrder && (
        <s-section heading="🔔 NEW ORDER">
          <s-box
            padding="large"
            borderWidth="base"
            borderRadius="base"
          >
            <s-stack direction="block" gap="base">
              <s-heading>
                NEW ORDER {firstNewOrder.orderNumber}
              </s-heading>

              <s-heading>
                {money(
                  firstNewOrder.foodTotal +
                    firstNewOrder.delivery +
                    firstNewOrder.serviceFee,
                )}
              </s-heading>

              <s-text>
                Received: {firstNewOrder.time}
              </s-text>

              <s-text>
                Customer: {firstNewOrder.customer}
              </s-text>

              {firstNewOrder.items.map((item, index) => (
                <s-heading key={index}>
                  {item.quantity} × {item.name}
                </s-heading>
              ))}

              <s-stack direction="inline" gap="base">
                <s-button
                  variant="primary"
                  onClick={() =>
                    updateOrder(
                      firstNewOrder.id,
                      "accepted",
                    )
                  }
                >
                  ACCEPT ORDER
                </s-button>

                <s-button
                  tone="critical"
                  onClick={() =>
                    updateOrder(
                      firstNewOrder.id,
                      "rejected",
                    )
                  }
                >
                  REJECT ORDER
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-section>
      )}

      <s-section heading="Today's Overview">
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(190px, 1fr))"
          gap="base"
        >
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-text>NEW ORDERS</s-text>
            <s-heading>{newOrders.length}</s-heading>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-text>MEAL DEAL SALES</s-text>
            <s-heading>{money(foodSales)}</s-heading>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-text>YOUR EARNINGS</s-text>
            <s-heading>
              {money(restaurantEarnings)}
            </s-heading>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
          >
            <s-text>NEXT PAYOUT</s-text>
            <s-heading>
              {money(restaurantEarnings)}
            </s-heading>
          </s-box>
        </s-grid>
      </s-section>

      <s-section heading="Restaurant Status">
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
        >
          <s-heading>
            {paused
              ? "Orders Paused"
              : "Accepting Orders"}
          </s-heading>

          <s-paragraph>
            {paused
              ? "Your restaurant is currently paused."
              : "Your restaurant is available to receive orders."}
          </s-paragraph>

          <s-button onClick={() => setPaused(!paused)}>
            {paused
              ? "Resume Orders"
              : "Pause Orders"}
          </s-button>
        </s-box>
      </s-section>

      <s-section heading="Orders">
        <s-stack direction="block" gap="base">
          {restaurantOrders.map((order) => {
            const orderCommission =
              order.foodTotal * 0.1;

            const restaurantGets =
              order.status === "accepted"
                ? order.foodTotal * 0.9 +
                  order.delivery
                : 0;

            const customerTotal =
              order.foodTotal +
              order.delivery +
              order.serviceFee;

            return (
              <s-box
                key={order.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small">
                  <s-heading>
                    {order.orderNumber}
                  </s-heading>

                  <s-text>
                    Customer: {order.customer}
                  </s-text>

                  {order.items.map((item, index) => (
                    <s-text key={index}>
                      {item.quantity} × {item.name}
                    </s-text>
                  ))}

                  <s-text>
                    Meal deals:{" "}
                    {money(order.foodTotal)}
                  </s-text>

                  <s-text>
                    Delivery: {money(order.delivery)}
                  </s-text>

                  <s-text>
                    Service fee:{" "}
                    {money(order.serviceFee)}
                  </s-text>

                  <s-heading>
                    Customer total:{" "}
                    {money(customerTotal)}
                  </s-heading>

                  <s-text>
                    Meal Deal Hub commission:{" "}
                    {money(orderCommission)}
                  </s-text>

                  {order.status === "accepted" && (
                    <s-heading>
                      You receive:{" "}
                      {money(restaurantGets)}
                    </s-heading>
                  )}

                  <s-text>
                    Status: {order.status.toUpperCase()}
                  </s-text>
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-section>

      <s-section heading="Weekly Payout">
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
        >
          <s-heading>
            Next payout: {money(restaurantEarnings)}
          </s-heading>

          <s-text>
            Period: Monday – Sunday
          </s-text>

          <s-text>
            Meal Deal Hub commission:{" "}
            {money(commission)}
          </s-text>

          <s-text>
            Service fees retained by Meal Deal Hub:{" "}
            {money(serviceFees)}
          </s-text>
        </s-box>
      </s-section>
    </s-page>
  );
}