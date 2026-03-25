import axios from 'axios';
import { prisma } from '../../lib/prisma.js';

function buildHeaders(accessToken) {
  return {
    Authentication: `bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': `${process.env.TIENDANUBE_APP_NAME || 'LummineBot'} ${process.env.TIENDANUBE_APP_SUPPORT_EMAIL || 'soporte@lummine.com'}`
  };
}

export async function getTiendanubeInstallation() {
  if (process.env.TIENDANUBE_STORE_ID && process.env.TIENDANUBE_ACCESS_TOKEN) {
    return {
      storeId: process.env.TIENDANUBE_STORE_ID,
      accessToken: process.env.TIENDANUBE_ACCESS_TOKEN,
      scope: process.env.TIENDANUBE_SCOPE || '',
      storeName: process.env.TIENDANUBE_STORE_NAME || null,
      storeUrl: process.env.TIENDANUBE_STORE_URL || null
    };
  }

  const preferredStoreId = process.env.TIENDANUBE_STORE_ID || null;

  if (preferredStoreId) {
    return prisma.storeInstallation.findUnique({
      where: { storeId: preferredStoreId }
    });
  }

  return prisma.storeInstallation.findFirst({
    orderBy: { installedAt: 'desc' }
  });
}

export async function getTiendanubeClient() {
  const installation = await getTiendanubeInstallation();

  if (!installation?.storeId || !installation?.accessToken) {
    throw new Error('No hay integración activa con Tiendanube. Instalá la app o configurá TIENDANUBE_STORE_ID y TIENDANUBE_ACCESS_TOKEN.');
  }

  const client = axios.create({
    baseURL: `https://api.tiendanube.com/2025-03/${installation.storeId}`,
    headers: buildHeaders(installation.accessToken)
  });

  return { client, installation };
}
