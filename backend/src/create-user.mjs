import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { resolveCreateUserScope } from './lib/create-user-scope.js';

const prisma = new PrismaClient();

async function main() {
  const name = process.argv[2];
  const email = process.argv[3];
  const password = process.argv[4];
  const requestedRole = process.argv[5] || 'AGENT';
  const requestedWorkspaceId = process.argv[6] || '';

	if (!name || !email || !password) {
		console.log('Uso: node src/create-user.mjs "Nombre" "mail@dominio.com" "Password123!" "PLATFORM_ADMIN|ADMIN|AGENT" "workspaceId"');
		process.exit(1);
	}

	const { role, workspaceId } = resolveCreateUserScope({
		role: requestedRole,
		workspaceId: requestedWorkspaceId,
	});

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
