import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_WORKSPACE_ID = process.env.DEFAULT_WORKSPACE_ID || 'workspace_default';

async function main() {
  const name = process.argv[2];
  const email = process.argv[3];
  const password = process.argv[4];
  const role = (process.argv[5] || 'AGENT').toUpperCase();
  const workspaceId = process.argv[6] || (role === 'PLATFORM_ADMIN' ? null : DEFAULT_WORKSPACE_ID);

  if (!name || !email || !password) {
    console.log('Uso: node scripts/create-user.mjs "Nombre" "mail@dominio.com" "Password123!" "PLATFORM_ADMIN|ADMIN|AGENT" "workspaceId"');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email: email.trim().toLowerCase() },
    update: {
      name,
      passwordHash,
      role,
      workspaceId
    },
    create: {
      workspaceId,
      name,
      email: email.trim().toLowerCase(),
      passwordHash,
      role
    }
  });

  console.log(`Usuario creado/actualizado: ${user.email} (${user.role})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
