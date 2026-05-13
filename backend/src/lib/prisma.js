import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

function resolveDatabaseUrl() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const configuredLimit = String(process.env.PRISMA_CONNECTION_LIMIT || '3').trim();
    const configuredPoolTimeout = String(process.env.PRISMA_POOL_TIMEOUT || '10').trim();

    if (configuredLimit && configuredLimit !== '0' && !url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', configuredLimit);
    }

    if (configuredPoolTimeout && configuredPoolTimeout !== '0' && !url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', configuredPoolTimeout);
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

const databaseUrl = resolveDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['error', 'warn'],
    ...(databaseUrl
      ? {
          datasources: {
            db: {
              url: databaseUrl,
            },
          },
        }
      : {}),
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
