import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import readline from "node:readline";

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function main() {
  console.log("\nMeal Deal Hub — Create Restaurant Account\n");

const password = process.env.MDH_ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error(
      "Password must contain at least 8 characters.",
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const restaurant = await prisma.restaurant.upsert({
    where: {
      restaurantId: "Jamaica 2",
    },
    update: {
      name: "Mannies Aroma Jerk",
      active: true,
    },
    create: {
      restaurantId: "Jamaica 2",
      name: "Mannies Aroma Jerk",
      active: true,
      acceptingOrders: true,
    },
  });

  await prisma.restaurantUser.upsert({
    where: {
      email: "jrgraphix2@aol.com",
    },
    update: {
      restaurantId: restaurant.id,
      passwordHash,
      active: true,
    },
    create: {
      restaurantId: restaurant.id,
      email: "jrgraphix2@aol.com",
      passwordHash,
      active: true,
    },
  });

  console.log("\n✅ Restaurant account created successfully.");
  console.log("Restaurant: Mannies Aroma Jerk");
  console.log("Restaurant ID: Jamaica 2");
  console.log("Login email: jrgraphix2@aol.com");
}

main()
  .catch((error) => {
    console.error("\n❌", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
