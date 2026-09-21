-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RestaurantUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "restaurantId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activationToken" TEXT,
    "activationExpiry" DATETIME,
    "activated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RestaurantUser_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RestaurantUser" ("active", "createdAt", "email", "firstName", "id", "lastName", "passwordHash", "restaurantId", "updatedAt") SELECT "active", "createdAt", "email", "firstName", "id", "lastName", "passwordHash", "restaurantId", "updatedAt" FROM "RestaurantUser";
DROP TABLE "RestaurantUser";
ALTER TABLE "new_RestaurantUser" RENAME TO "RestaurantUser";
CREATE UNIQUE INDEX "RestaurantUser_email_key" ON "RestaurantUser"("email");
CREATE UNIQUE INDEX "RestaurantUser_activationToken_key" ON "RestaurantUser"("activationToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
