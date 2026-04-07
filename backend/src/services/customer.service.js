import { prisma } from '../lib/prisma.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || 'v1';
const ORDERS_PER_PAGE = Math.max(1, Math.min(200, Number(process.env.TIENDANUBE_ORDERS_SYNC_PER_PAGE || 200)));
const RECENT_LOOKBACK_DAYS = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_INCREMENTAL_LOOKBACK_DAYS || 14));
const INITIAL_SYNC_MAX_PAGES = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_INITIAL_MAX_PAGES || 250));
const BACKFILL_PAGES_PER_RUN = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_BACKFILL_PAGES_PER_RUN || 80));
const FETCH_RETRIES = Math.max(1, Number(process.env.TIENDANUBE_FETCH_RETRIES || 3));
const UPDATE_BATCH_SIZE = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_UPDATE_BATCH_SIZE || 50));
const ITEM_BATCH_SIZE = Math.max(50, Number(process.env.TIENDANUBE_ORDER_ITEMS_BATCH_SIZE || 500));

const syncState = {
  running: false,
  startedAt: null,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeEmail(value) {
  const text = cleanString(value);
  return text ? text.toLowerCase() : null;
}

function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits || null;
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function toDecimalOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function parseDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function subtractDays(date, days) {
  const base = date instanceof Date ? date : new Date(date);
  return new Date(base.getTime() - days * 24 * 60 * 60 * 1000);
}

async function resolveStoreCredentials() {
  const envStoreId = cleanString(process.env.TIENDANUBE_STORE_ID);
  const envAccessToken = cleanString(process.env.TIENDANUBE_ACCESS_TOKEN);

  if (envStoreId && envAccessToken) {
    return {
      storeId: envStoreId,
      accessToken: envAccessToken,
      source: 'env',
    };
  }

  const installation = await prisma.storeInstallation.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: {
      storeId: true,
      accessToken: true,
    },
  });

  if (!installation?.storeId || !installation?.accessToken) {
    throw new Error('Faltan credenciales de Tiendanube. Configurá TIENDANUBE_STORE_ID y TIENDANUBE_ACCESS_TOKEN.');
  }

  return {
    storeId: installation.storeId,
    accessToken: installation.accessToken,
    source: 'storeInstallation',
  };
}

async function fetchJson(url, accessToken, resourceLabel) {
  const userAgent =
    process.env.TIENDANUBE_USER_AGENT ||
    'Lummine IA Assistant (germanarroyo016@gmail.com)';

  let lastError = null;

  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authentication: `bearer ${accessToken}`,
          'User-Agent': userAgent,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${resourceLabel}: Tiendanube respondió ${response.status} - ${text}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRIES) {
        await sleep(350 * attempt);
        continue;
      }
    }
  }

  throw lastError || new Error(`No se pudo obtener ${resourceLabel} de Tiendanube.`);
}

async function fetchOrdersPage({ storeId, accessToken, page, q = '', createdAtMin = null, createdAtMax = null }) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(ORDERS_PER_PAGE),
    fields: [
      'id',
      'number',
      'token',
      'store_id',
      'customer',
      'contact_name',
      'contact_email',
      'contact_phone',
      'contact_identification',
      'status',
      'payment_status',
      'shipping_status',
      'subtotal',
      'total',
      'currency',
      'gateway',
      'gateway_id',
      'gateway_name',
      'gateway_link',
      'created_at',
      'updated_at',
      'products',
      'fulfillments',
    ].join(','),
  });

  if (q) params.set('q', q);
  if (createdAtMin) params.set('created_at_min', createdAtMin.toISOString());
  if (createdAtMax) params.set('created_at_max', createdAtMax.toISOString());

  const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/orders?${params.toString()}`;
  const payload = await fetchJson(url, accessToken, `pedidos página ${page}`);

  if (!Array.isArray(payload)) {
    throw new Error('La respuesta de Tiendanube para pedidos no fue una lista.');
  }

  return payload;
}

async function getLocalOrderBounds(storeId) {
  const [count, earliest, latest] = await Promise.all([
    prisma.customerOrder.count({ where: { storeId } }),
    prisma.customerOrder.findFirst({
      where: { storeId },
      orderBy: [{ orderCreatedAt: 'asc' }, { createdAt: 'asc' }],
      select: { orderCreatedAt: true },
    }),
    prisma.customerOrder.findFirst({
      where: { storeId },
      orderBy: [{ orderUpdatedAt: 'desc' }, { orderCreatedAt: 'desc' }, { createdAt: 'desc' }],
      select: { orderCreatedAt: true, orderUpdatedAt: true },
    }),
  ]);

  return {
    count,
    earliestOrderCreatedAt: earliest?.orderCreatedAt || null,
    latestOrderCreatedAt: latest?.orderCreatedAt || null,
    latestOrderUpdatedAt: latest?.orderUpdatedAt || latest?.orderCreatedAt || null,
  };
}

function buildProfileIdentity(order) {
  const externalCustomerId = cleanString(order?.customer?.id);
  const normalizedEmail = normalizeEmail(order?.contact_email || order?.customer?.email);
  const normalizedPhone = normalizePhone(order?.contact_phone || order?.customer?.phone);
  const syntheticExternalCustomerId = externalCustomerId || `order-${cleanString(order?.id)}`;

  return {
    externalCustomerId: syntheticExternalCustomerId,
    normalizedEmail,
    normalizedPhone,
    displayName: cleanString(order?.contact_name || order?.customer?.name),
    email: cleanString(order?.contact_email || order?.customer?.email),
    phone: cleanString(order?.contact_phone || order?.customer?.phone),
    identification: cleanString(order?.contact_identification || order?.customer?.identification),
    currency: cleanString(order?.currency) || 'ARS',
    rawCustomerPayload: order?.customer ?? null,
    syncedAt: new Date(),
  };
}

async function ensureProfilesForOrders(orders, storeId) {
  const candidatesMap = new Map();

  for (const order of orders) {
    const candidate = buildProfileIdentity(order);
    if (!candidate.externalCustomerId) continue;
    candidatesMap.set(candidate.externalCustomerId, candidate);
  }

  const candidates = Array.from(candidatesMap.values());
  if (!candidates.length) return new Map();

  const externalIds = candidates.map((item) => item.externalCustomerId).filter(Boolean);
  const emails = candidates.map((item) => item.normalizedEmail).filter(Boolean);
  const phones = candidates.map((item) => item.normalizedPhone).filter(Boolean);

  const existingProfiles = await prisma.customerProfile.findMany({
    where: {
      storeId,
      OR: [
        externalIds.length ? { externalCustomerId: { in: externalIds } } : null,
        emails.length ? { normalizedEmail: { in: emails } } : null,
        phones.length ? { normalizedPhone: { in: phones } } : null,
      ].filter(Boolean),
    },
    select: {
      id: true,
      externalCustomerId: true,
      normalizedEmail: true,
      normalizedPhone: true,
    },
  });

  const byExternal = new Map();
  const byEmail = new Map();
  const byPhone = new Map();

  for (const profile of existingProfiles) {
    if (profile.externalCustomerId) byExternal.set(profile.externalCustomerId, profile.id);
    if (profile.normalizedEmail) byEmail.set(profile.normalizedEmail, profile.id);
    if (profile.normalizedPhone) byPhone.set(profile.normalizedPhone, profile.id);
  }

  const missing = candidates.filter((item) => {
    if (item.externalCustomerId && byExternal.has(item.externalCustomerId)) return false;
    if (item.normalizedEmail && byEmail.has(item.normalizedEmail)) return false;
    if (item.normalizedPhone && byPhone.has(item.normalizedPhone)) return false;
    return true;
  });

  if (missing.length) {
    await prisma.customerProfile.createMany({
      data: missing.map((item) => ({
        storeId,
        externalCustomerId: item.externalCustomerId,
        displayName: item.displayName,
        email: item.email,
        normalizedEmail: item.normalizedEmail,
        phone: item.phone,
        normalizedPhone: item.normalizedPhone,
        identification: item.identification,
        currency: item.currency,
        rawCustomerPayload: item.rawCustomerPayload,
        syncedAt: item.syncedAt,
      })),
      skipDuplicates: true,
    });

    const reloadedProfiles = await prisma.customerProfile.findMany({
      where: {
        storeId,
        OR: [
          externalIds.length ? { externalCustomerId: { in: externalIds } } : null,
          emails.length ? { normalizedEmail: { in: emails } } : null,
          phones.length ? { normalizedPhone: { in: phones } } : null,
        ].filter(Boolean),
      },
      select: {
        id: true,
        externalCustomerId: true,
        normalizedEmail: true,
        normalizedPhone: true,
      },
    });

    byExternal.clear();
    byEmail.clear();
    byPhone.clear();
    for (const profile of reloadedProfiles) {
      if (profile.externalCustomerId) byExternal.set(profile.externalCustomerId, profile.id);
      if (profile.normalizedEmail) byEmail.set(profile.normalizedEmail, profile.id);
      if (profile.normalizedPhone) byPhone.set(profile.normalizedPhone, profile.id);
    }
  }

  const orderToProfileId = new Map();
  for (const order of orders) {
    const candidate = buildProfileIdentity(order);
    const profileId =
      (candidate.externalCustomerId ? byExternal.get(candidate.externalCustomerId) : null) ||
      (candidate.normalizedEmail ? byEmail.get(candidate.normalizedEmail) : null) ||
      (candidate.normalizedPhone ? byPhone.get(candidate.normalizedPhone) : null);

    if (!profileId) {
      throw new Error(`No se pudo resolver el perfil del pedido ${cleanString(order?.id) || 'desconocido'}.`);
    }

    orderToProfileId.set(String(order?.id), profileId);
  }

  return orderToProfileId;
}

function buildShippingLabel(order) {
  const firstFulfillment = Array.isArray(order?.fulfillments) ? order.fulfillments[0] : null;
  const optionName = cleanString(firstFulfillment?.shipping?.option?.name);
  const carrierName = cleanString(firstFulfillment?.shipping?.carrier?.name);
  return [carrierName, optionName].filter(Boolean).join(' · ') || null;
}

function mapOrderPayload(order, storeId, customerProfileId) {
  return {
    customerProfileId,
    storeId,
    orderId: String(order?.id),
    orderNumber: cleanString(order?.number),
    token: cleanString(order?.token),
    contactName: cleanString(order?.contact_name || order?.customer?.name),
    contactEmail: cleanString(order?.contact_email || order?.customer?.email),
    normalizedEmail: normalizeEmail(order?.contact_email || order?.customer?.email),
    contactPhone: cleanString(order?.contact_phone || order?.customer?.phone),
    normalizedPhone: normalizePhone(order?.contact_phone || order?.customer?.phone),
    contactIdentification: cleanString(order?.contact_identification || order?.customer?.identification),
    status: cleanString(order?.status),
    paymentStatus: cleanString(order?.payment_status),
    shippingStatus: cleanString(order?.shipping_status),
    subtotal: toDecimalOrNull(order?.subtotal),
    totalAmount: toDecimalOrNull(order?.total),
    currency: cleanString(order?.currency) || 'ARS',
    gateway: cleanString(order?.gateway),
    gatewayId: cleanString(order?.gateway_id),
    gatewayName: cleanString(order?.gateway_name),
    gatewayLink: cleanString(order?.gateway_link),
    products: Array.isArray(order?.products) ? order.products : [],
    rawPayload: order,
    orderCreatedAt: parseDateOrNull(order?.created_at),
    orderUpdatedAt: parseDateOrNull(order?.updated_at),
  };
}

function buildOrderItems(order, storeId, customerOrderId, customerProfileId) {
  const orderId = String(order?.id);
  const orderNumber = cleanString(order?.number);
  const orderCreatedAt = parseDateOrNull(order?.created_at);
  const products = Array.isArray(order?.products) ? order.products : [];

  return products.map((product, index) => {
    const quantity = Number(product?.quantity || 1) || 1;
    const unitPrice = toDecimalOrNull(product?.price);
    const lineTotal = unitPrice !== null ? unitPrice * quantity : null;
    const variantValues = Array.isArray(product?.variant_values)
      ? product.variant_values.filter(Boolean)
      : [];
    const baseName = cleanString(product?.name_without_variants) || cleanString(product?.name) || `Ítem ${index + 1}`;
    const variantName = variantValues.length ? variantValues.join(' / ') : null;

    return {
      customerOrderId,
      customerProfileId,
      storeId,
      orderId,
      orderNumber,
      productId: cleanString(product?.product_id),
      variantId: cleanString(product?.variant_id),
      lineItemId: cleanString(product?.id),
      sku: cleanString(product?.sku),
      barcode: cleanString(product?.barcode),
      name: cleanString(product?.name) || baseName,
      normalizedName: normalizeText(`${baseName} ${variantName || ''} ${product?.sku || ''}`),
      variantName,
      quantity,
      unitPrice,
      lineTotal,
      imageUrl: cleanString(product?.image?.src || product?.image?.url),
      rawPayload: product,
      orderCreatedAt,
    };
  });
}

async function upsertOrdersAndItems(orders, storeId) {
  if (!orders.length) {
    return { ordersUpserted: 0, itemsUpserted: 0, customersTouched: 0 };
  }

  const orderToProfileId = await ensureProfilesForOrders(orders, storeId);
  const orderIds = orders.map((order) => String(order?.id));

  const existingOrders = await prisma.customerOrder.findMany({
    where: {
      storeId,
      orderId: { in: orderIds },
    },
    select: {
      id: true,
      orderId: true,
    },
  });

  const existingMap = new Map(existingOrders.map((item) => [item.orderId, item.id]));
  const createData = [];
  const updates = [];
  const touchedProfileIds = new Set();

  for (const order of orders) {
    const orderId = String(order?.id);
    const customerProfileId = orderToProfileId.get(orderId);
    touchedProfileIds.add(customerProfileId);
    const payload = mapOrderPayload(order, storeId, customerProfileId);

    if (existingMap.has(orderId)) {
      updates.push({ id: existingMap.get(orderId), data: payload });
    } else {
      createData.push(payload);
    }
  }

  if (createData.length) {
    for (let start = 0; start < createData.length; start += UPDATE_BATCH_SIZE) {
      const batch = createData.slice(start, start + UPDATE_BATCH_SIZE);
      await prisma.customerOrder.createMany({ data: batch, skipDuplicates: true });
    }
  }

  if (updates.length) {
    for (let start = 0; start < updates.length; start += UPDATE_BATCH_SIZE) {
      const batch = updates.slice(start, start + UPDATE_BATCH_SIZE);
      await prisma.$transaction(
        batch.map((item) =>
          prisma.customerOrder.update({
            where: { id: item.id },
            data: item.data,
          })
        )
      );
    }
  }

  const savedOrders = await prisma.customerOrder.findMany({
    where: {
      storeId,
      orderId: { in: orderIds },
    },
    select: {
      id: true,
      orderId: true,
    },
  });

  const savedOrderMap = new Map(savedOrders.map((item) => [item.orderId, item.id]));
  const savedOrderIds = savedOrders.map((item) => item.id);

  if (savedOrderIds.length) {
    await prisma.customerOrderItem.deleteMany({
      where: { customerOrderId: { in: savedOrderIds } },
    });
  }

  const allItems = [];
  for (const order of orders) {
    const orderId = String(order?.id);
    const customerOrderId = savedOrderMap.get(orderId);
    const customerProfileId = orderToProfileId.get(orderId);
    if (!customerOrderId || !customerProfileId) continue;
    allItems.push(...buildOrderItems(order, storeId, customerOrderId, customerProfileId));
  }

  if (allItems.length) {
    for (let start = 0; start < allItems.length; start += ITEM_BATCH_SIZE) {
      const batch = allItems.slice(start, start + ITEM_BATCH_SIZE);
      await prisma.customerOrderItem.createMany({ data: batch });
    }
  }

  return {
    ordersUpserted: orders.length,
    itemsUpserted: allItems.length,
    customersTouched: touchedProfileIds.size,
  };
}

async function fetchAndUpsertOrdersRange({
  storeId,
  accessToken,
  q = '',
  createdAtMin = null,
  createdAtMax = null,
  maxPages,
  modeLabel,
}) {
  let page = 1;
  let pagesFetched = 0;
  let ordersFetched = 0;
  let ordersUpserted = 0;
  let itemsUpserted = 0;
  let customersTouched = 0;
  let exhausted = true;

  while (page <= maxPages) {
    const orders = await fetchOrdersPage({
      storeId,
      accessToken,
      page,
      q,
      createdAtMin,
      createdAtMax,
    });

    pagesFetched += 1;
    ordersFetched += orders.length;

    if (!orders.length) {
      break;
    }

    const saved = await upsertOrdersAndItems(orders, storeId);
    ordersUpserted += saved.ordersUpserted;
    itemsUpserted += saved.itemsUpserted;
    customersTouched += saved.customersTouched;

    if (orders.length < ORDERS_PER_PAGE) {
      break;
    }

    page += 1;
  }

  if (page > maxPages) {
    exhausted = false;
  }

  return {
    mode: modeLabel,
    pagesFetched,
    ordersFetched,
    ordersUpserted,
    itemsUpserted,
    customersTouched,
    exhausted,
  };
}

function sumRunValues(runs, key) {
  return runs.reduce((acc, run) => acc + Number(run?.[key] || 0), 0);
}

export async function syncCustomers({ q = '', dateFrom = '', dateTo = '' } = {}) {
  if (syncState.running) {
    throw new Error('Ya hay una sincronización de pedidos en curso. Esperá a que termine.');
  }

  syncState.running = true;
  syncState.startedAt = new Date();

  const syncLog = await prisma.customerSyncLog.create({
    data: {
      status: 'RUNNING',
      fullSync: false,
      startedAt: new Date(),
      message: 'Sync de pedidos iniciada',
    },
  });

  try {
    const startedAt = Date.now();
    const { storeId, accessToken } = await resolveStoreCredentials();
    const localBoundsBefore = await getLocalOrderBounds(storeId);
    const hasManualFilters = Boolean(q || dateFrom || dateTo);
    const runs = [];

    if (hasManualFilters) {
      runs.push(
        await fetchAndUpsertOrdersRange({
          storeId,
          accessToken,
          q,
          createdAtMin: dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`) : null,
          createdAtMax: dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : null,
          maxPages: BACKFILL_PAGES_PER_RUN,
          modeLabel: 'filtered_sync',
        })
      );
    } else if (localBoundsBefore.count === 0) {
      runs.push(
        await fetchAndUpsertOrdersRange({
          storeId,
          accessToken,
          maxPages: INITIAL_SYNC_MAX_PAGES,
          modeLabel: 'initial_history',
        })
      );
    } else {
      const recentFrom = subtractDays(localBoundsBefore.latestOrderUpdatedAt || new Date(), RECENT_LOOKBACK_DAYS);
      runs.push(
        await fetchAndUpsertOrdersRange({
          storeId,
          accessToken,
          createdAtMin: recentFrom,
          maxPages: Math.min(20, BACKFILL_PAGES_PER_RUN),
          modeLabel: 'recent_sync',
        })
      );

      if (localBoundsBefore.earliestOrderCreatedAt) {
        runs.push(
          await fetchAndUpsertOrdersRange({
            storeId,
            accessToken,
            createdAtMax: new Date(localBoundsBefore.earliestOrderCreatedAt.getTime() - 1),
            maxPages: BACKFILL_PAGES_PER_RUN,
            modeLabel: 'historical_backfill',
          })
        );
      }
    }

    const localBoundsAfter = await getLocalOrderBounds(storeId);
    const durationMs = Date.now() - startedAt;
    const pagesFetched = sumRunValues(runs, 'pagesFetched');
    const ordersFetched = sumRunValues(runs, 'ordersFetched');
    const ordersUpserted = sumRunValues(runs, 'ordersUpserted');
    const itemsUpserted = sumRunValues(runs, 'itemsUpserted');
    const customersTouched = sumRunValues(runs, 'customersTouched');
    const hasMoreHistory = runs.some((run) => run.mode === 'initial_history' || run.mode === 'historical_backfill')
      ? runs.some((run) => (run.mode === 'initial_history' || run.mode === 'historical_backfill') && !run.exhausted)
      : false;

    await prisma.customerSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'SUCCESS',
        finishedAt: new Date(),
        pagesFetched,
        ordersFetched,
        ordersUpserted,
        customersTouched,
        message: hasMoreHistory
          ? 'Sync lista. Queda histórico por traer en próximas corridas.'
          : 'Sync lista. Histórico completo o sin más páginas disponibles.',
      },
    });

    return {
      ok: true,
      mode: hasManualFilters ? 'filtered' : localBoundsBefore.count === 0 ? 'initial' : 'recent+backfill',
      pagesFetched,
      ordersFetched,
      ordersUpserted,
      itemsUpserted,
      customersTouched,
      durationMs,
      localOrdersBefore: localBoundsBefore.count,
      localOrdersAfter: localBoundsAfter.count,
      hasMoreHistory,
      orderRuns: runs,
      message: hasMoreHistory
        ? 'Sync lista. Se actualizaron pedidos recientes y se avanzó con el histórico.'
        : 'Sync lista. Se actualizaron pedidos y no quedan más páginas históricas para traer.',
    };
  } catch (error) {
    await prisma.customerSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'ERROR',
        finishedAt: new Date(),
        message: error?.message || 'Error sincronizando pedidos',
      },
    });

    throw error;
  } finally {
    syncState.running = false;
    syncState.startedAt = null;
  }
}
