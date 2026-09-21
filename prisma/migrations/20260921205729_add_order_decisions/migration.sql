-- CreateTable
CREATE TABLE "OrderDecision" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopifyOrderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderDecision_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OrderDecision_restaurantId_idx" ON "OrderDecision"("restaurantId");

-- CreateIndex
CREATE INDEX "OrderDecision_status_idx" ON "OrderDecision"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderDecision_shopifyOrderId_restaurantId_key" ON "OrderDecision"("shopifyOrderId", "restaurantId");
