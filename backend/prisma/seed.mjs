import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function upsertUser({ name, email, password, role }) {
  const passwordHash = await bcrypt.hash(password, 10);

  return prisma.user.upsert({
    where: { email: email.trim().toLowerCase() },
    update: {
      name,
      passwordHash,
      role
    },
    create: {
      name,
      email: email.trim().toLowerCase(),
      passwordHash,
      role
    }
  });
}

async function main() {
  const admin = await upsertUser({
    name: process.env.SEED_ADMIN_NAME || 'Admin',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.SEED_ADMIN_PASSWORD || 'Admin1234!',
    role: 'ADMIN'
  });

  const agent = await upsertUser({
    name: process.env.SEED_AGENT_NAME || 'Agente',
    email: process.env.SEED_AGENT_EMAIL || 'agent@example.com',
    password: process.env.SEED_AGENT_PASSWORD || 'Agent1234!',
    role: 'AGENT'
  });

  const waId = '5490000000000';

  const existingContact = await prisma.contact.findFirst({
    where: { waId },
    orderBy: { updatedAt: 'desc' }
  });

  const contact = existingContact
    ? await prisma.contact.update({
      where: { id: existingContact.id },
      data: {
        name: 'Cliente Demo',
        phone: waId
      }
    })
    : await prisma.contact.create({
      data: {
        waId,
        phone: waId,
        name: 'Cliente Demo'
      }
    });

  let conversation = await prisma.conversation.findFirst({
    where: { contactId: contact.id }
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        contactId: contact.id,
        aiEnabled: true,
        lastSummary: 'Cliente demo interesada en body modelador, talle y promo por transferencia.',
        lastMessageAt: new Date(),
        messages: {
          create: [
            {
              direction: 'INBOUND',
              senderName: 'Cliente Demo',
              body: 'Hola, me interesa el body modelador. ¿Tenés talle M/L?'
            },
            {
              direction: 'OUTBOUND',
              senderName: process.env.BUSINESS_NAME || 'Lummine',
              body: '¡Hola! Sí, trabajamos ese modelo. Si querés te ayudo con talle, promo y envío.'
            }
          ]
        }
      }
    });
  }

  console.log('======================================');
  console.log('Seed lista');
  console.log(`ADMIN: ${admin.email} / ${process.env.SEED_ADMIN_PASSWORD || 'Admin1234!'}`);
  console.log(`AGENT: ${agent.email} / ${process.env.SEED_AGENT_PASSWORD || 'Agent1234!'}`);
  console.log(`CHAT DEMO: ${conversation.id}`);
  console.log('======================================');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
