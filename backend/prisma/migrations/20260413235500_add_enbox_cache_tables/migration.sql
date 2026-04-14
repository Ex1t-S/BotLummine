-- CreateTable
CREATE TABLE "EnboxShipment" (
    "id" TEXT NOT NULL,
    "didEnvio" TEXT NOT NULL,
    "didCliente" TEXT,
    "storeId" TEXT,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "shipmentNumber" TEXT,
    "packId" TEXT,
    "trackingNumber" TEXT,
    "trackingToken" TEXT,
    "trackingUrl" TEXT,
    "shippingStatus" TEXT,
    "shippingStatusCode" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "recipientEmail" TEXT,
    "postalCode" TEXT,
    "addressLine" TEXT,
    "shippingMethod" TEXT,
    "source" TEXT,
    "rawSummary" JSONB,
    "rawPayload" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnboxShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnboxSyncLog" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "shipmentsChecked" INTEGER NOT NULL DEFAULT 0,
    "shipmentsUpserted" INTEGER NOT NULL DEFAULT 0,
    "ordersScanned" INTEGER NOT NULL DEFAULT 0,
    "ordersMatched" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnboxSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnboxShipment_didEnvio_key" ON "EnboxShipment"("didEnvio");

-- CreateIndex
CREATE INDEX "EnboxShipment_orderNumber_idx" ON "EnboxShipment"("orderNumber");

-- CreateIndex
CREATE INDEX "EnboxShipment_shipmentNumber_idx" ON "EnboxShipment"("shipmentNumber");

-- CreateIndex
CREATE INDEX "EnboxShipment_packId_idx" ON "EnboxShipment"("packId");

-- CreateIndex
CREATE INDEX "EnboxShipment_trackingNumber_idx" ON "EnboxShipment"("trackingNumber");

-- CreateIndex
CREATE INDEX "EnboxShipment_storeId_orderNumber_idx" ON "EnboxShipment"("storeId", "orderNumber");

-- CreateIndex
CREATE INDEX "EnboxShipment_lastSyncedAt_idx" ON "EnboxShipment"("lastSyncedAt");

-- CreateIndex
CREATE INDEX "EnboxSyncLog_status_startedAt_idx" ON "EnboxSyncLog"("status", "startedAt");
