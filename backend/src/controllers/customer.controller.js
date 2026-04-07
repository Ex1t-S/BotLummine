import prisma from '../lib/prisma.js';
import { syncCustomers } from '../services/customer.service.js';

function cleanString(value) {
  const text = String(value ?? '').trim();
  return text || '';
}

function normalizeSearch(value) {
  return cleanString(value);
}

function normalizeBoolean(value) {
  if (value === true || value === 'true' || value === '1' || value === 1 || value === 'on') return true;
  if (value === false || value === 'false' || value === '0' || value === 0 || value === '') return false;
  return false;
}

function toPositiveInt(value, fallback, { min = 1, max = 1000 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseDateQuery(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfDay(date) {
  if (!date) return null;
  const next = new Date(date);
  next.setUTCHours(23, 59, 59, 999);
  return next;
}

function normalizeStatus(value) {
  const text = normalizeSearch(value).toLowerCase();
  return text || '';
}

function formatCurrency(value, currency = 'ARS') {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: currency || 'ARS',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$ ${amount.toLocaleString('es-AR')}`;
  }
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function getInitials(value) {
  const text = cleanString(value);
  if (!text) return '?';
  const parts = text.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || '?') + (parts[1]?.[0] || '');
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function buildOrderWhere({ q, productQuery, orderNumber, minSpent, hasPhoneOnly, dateFrom, dateTo, paymentStatus, shippingStatus }) {
  const where = { AND: [] };

  if (q) {
    where.AND.push({
      OR: [
        { contactName: { contains: q, mode: 'insensitive' } },
        { contactEmail: { contains: q, mode: 'insensitive' } },
        { contactPhone: { contains: q, mode: 'insensitive' } },
        { contactIdentification: { contains: q, mode: 'insensitive' } },
        { orderNumber: { contains: q, mode: 'insensitive' } },
        {
          items: {
            some: {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { sku: { contains: q, mode: 'insensitive' } },
                { variantName: { contains: q, mode: 'insensitive' } },
              ],
            },
          },
        },
      ],
    });
  }

  if (productQuery) {
    where.AND.push({
      items: {
        some: {
          OR: [
            { name: { contains: productQuery, mode: 'insensitive' } },
            { normalizedName: { contains: normalizeText(productQuery) } },
            { variantName: { contains: productQuery, mode: 'insensitive' } },
            { sku: { contains: productQuery, mode: 'insensitive' } },
          ],
        },
      },
    });
  }

  if (orderNumber) {
    where.AND.push({ orderNumber: { contains: orderNumber, mode: 'insensitive' } });
  }

  if (minSpent !== null) {
    where.AND.push({ totalAmount: { gte: minSpent } });
  }

  if (hasPhoneOnly) {
    where.AND.push({ normalizedPhone: { not: null } });
  }

  if (dateFrom || dateTo) {
    where.AND.push({
      orderCreatedAt: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      },
    });
  }

  if (paymentStatus) {
    where.AND.push({ paymentStatus: paymentStatus });
  }

  if (shippingStatus) {
    where.AND.push({ shippingStatus: shippingStatus });
  }

  if (!where.AND.length) return {};
  return where;
}

function buildOrderBy(sort) {
  switch (sort) {
    case 'purchase_asc':
      return [{ orderCreatedAt: 'asc' }, { createdAt: 'asc' }];
    case 'total_desc':
      return [{ totalAmount: 'desc' }, { orderCreatedAt: 'desc' }];
    case 'total_asc':
      return [{ totalAmount: 'asc' }, { orderCreatedAt: 'desc' }];
    case 'name_asc':
      return [{ contactName: 'asc' }, { orderCreatedAt: 'desc' }];
    case 'name_desc':
      return [{ contactName: 'desc' }, { orderCreatedAt: 'desc' }];
    case 'number_desc':
      return [{ orderNumber: 'desc' }, { orderCreatedAt: 'desc' }];
    case 'number_asc':
      return [{ orderNumber: 'asc' }, { orderCreatedAt: 'desc' }];
    case 'purchase_desc':
    default:
      return [{ orderCreatedAt: 'desc' }, { createdAt: 'desc' }];
  }
}

function serializeOrder(order) {
  const productsPreview = (order.items || []).map((item) => {
    const qty = Number(item.quantity || 0);
    const variant = cleanString(item.variantName);
    const sku = cleanString(item.sku);
    const parts = [item.name];
    if (variant) parts.push(variant);
    if (sku) parts.push(`SKU ${sku}`);
    if (qty > 1) parts.push(`x${qty}`);
    return parts.join(' · ');
  });

  return {
    id: order.id,
    displayName: order.contactName || 'Cliente sin nombre',
    email: order.contactEmail || '',
    phone: order.contactPhone || '',
    initials: getInitials(order.contactName || order.contactEmail || order.contactPhone),
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    lastOrderLabel: order.orderNumber ? `#${order.orderNumber}` : `ID ${order.orderId}`,
    totalSpent: Number(order.totalAmount || 0),
    totalSpentLabel: formatCurrency(order.totalAmount || 0, order.currency || 'ARS'),
    currency: order.currency || 'ARS',
    orderCount: 1,
    totalUnitsPurchased: (order.items || []).reduce((acc, item) => acc + Number(item.quantity || 0), 0),
    firstOrderDateLabel: formatDate(order.orderCreatedAt),
    lastOrderDateLabel: formatDate(order.orderCreatedAt),
    lastOrderStatusLabel: [order.paymentStatus, order.shippingStatus].filter(Boolean).join(' · ') || '-',
    lastOrderProductsPreview: productsPreview,
    topProductsPreview: productsPreview,
    distinctProductsCount: (order.items || []).length,
    paymentStatus: order.paymentStatus || '',
    shippingStatus: order.shippingStatus || '',
    updatedAt: order.orderUpdatedAt || order.updatedAt,
  };
}

export async function getCustomers(req, res, next) {
  try {
    const q = normalizeSearch(req.query?.q);
    const productQuery = normalizeSearch(req.query?.productQuery);
    const orderNumber = normalizeSearch(req.query?.orderNumber);
    const page = toPositiveInt(req.query?.page, 1, { min: 1, max: 100000 }) || 1;
    const pageSize = toPositiveInt(req.query?.pageSize, 24, { min: 1, max: 100 }) || 24;
    const skip = (page - 1) * pageSize;
    const sort = normalizeSearch(req.query?.sort) || 'purchase_desc';
    const minSpent = toNumberOrNull(req.query?.minSpent);
    const hasPhoneOnly = normalizeBoolean(req.query?.hasPhoneOnly);
    const dateFrom = parseDateQuery(req.query?.dateFrom);
    const dateTo = endOfDay(parseDateQuery(req.query?.dateTo));
    const paymentStatus = normalizeStatus(req.query?.paymentStatus);
    const shippingStatus = normalizeStatus(req.query?.shippingStatus);

    const where = buildOrderWhere({
      q,
      productQuery,
      orderNumber,
      minSpent,
      hasPhoneOnly,
      dateFrom,
      dateTo,
      paymentStatus,
      shippingStatus,
    });

    const [
      totalOrders,
      paidOrders,
      withPhone,
      totalSpentAgg,
      orders,
      distinctProfiles,
    ] = await Promise.all([
      prisma.customerOrder.count({ where }),
      prisma.customerOrder.count({ where: { ...where, paymentStatus: 'paid' } }),
      prisma.customerOrder.count({ where: { ...where, normalizedPhone: { not: null } } }),
      prisma.customerOrder.aggregate({ where, _sum: { totalAmount: true } }),
      prisma.customerOrder.findMany({
        where,
        orderBy: buildOrderBy(sort),
        skip,
        take: pageSize,
        select: {
          id: true,
          orderId: true,
          orderNumber: true,
          contactName: true,
          contactEmail: true,
          contactPhone: true,
          paymentStatus: true,
          shippingStatus: true,
          totalAmount: true,
          currency: true,
          orderCreatedAt: true,
          orderUpdatedAt: true,
          updatedAt: true,
          customerProfileId: true,
          items: {
            take: 5,
            orderBy: [{ quantity: 'desc' }, { name: 'asc' }],
            select: {
              name: true,
              sku: true,
              variantName: true,
              quantity: true,
            },
          },
        },
      }),
      prisma.customerOrder.findMany({
        where,
        distinct: ['customerProfileId'],
        select: { customerProfileId: true },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));
    const showingFrom = totalOrders === 0 ? 0 : skip + 1;
    const showingTo = Math.min(skip + orders.length, totalOrders);
    const totalSpent = Number(totalSpentAgg?._sum?.totalAmount || 0);
    const ticketAverage = totalOrders > 0 ? totalSpent / totalOrders : 0;

    return res.json({
      customers: orders.map(serializeOrder),
      stats: {
        totalOrders,
        totalCustomers: distinctProfiles.length,
        paidOrders,
        withPhone,
        totalSpent,
        avgTicket: ticketAverage,
        currency: orders[0]?.currency || 'ARS',
        showingFrom,
        showingTo,
      },
      pagination: {
        page,
        pageSize,
        totalPages,
        totalItems: totalOrders,
      },
      filters: {
        q,
        productQuery,
        orderNumber,
        sort,
        minSpent,
        hasPhoneOnly,
        dateFrom: req.query?.dateFrom || '',
        dateTo: req.query?.dateTo || '',
        paymentStatus,
        shippingStatus,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function postSyncCustomers(req, res) {
  try {
    const q = normalizeSearch(req.body?.q || req.query?.q || '');
    const dateFrom = normalizeSearch(req.body?.dateFrom || req.query?.dateFrom || '');
    const dateTo = normalizeSearch(req.body?.dateTo || req.query?.dateTo || '');
    const result = await syncCustomers({ q, dateFrom, dateTo });
    return res.json(result);
  } catch (error) {
    console.error('[CUSTOMERS SYNC ERROR]', error);
    const message = error?.message || 'Error sincronizando pedidos';
    const status = message.includes('Ya hay una sincronización') ? 409 : 500;
    return res.status(status).json({ message });
  }
}

export async function postFullSyncCustomers(_req, res) {
  return res.status(410).json({
    ok: false,
    message: 'La sync full separada ya no se usa. Usá /customers/sync desde el único botón.',
  });
}

export async function postRepairCustomers(_req, res) {
  return res.status(410).json({
    ok: false,
    message: 'La reparación manual fue removida de esta versión.',
  });
}
