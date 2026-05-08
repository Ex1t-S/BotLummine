import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_WORKSPACE_ID = process.env.DEFAULT_WORKSPACE_ID || 'workspace_default';
const DEFAULT_WORKSPACE_SLUG = process.env.DEFAULT_WORKSPACE_SLUG || 'default';

async function ensureDefaultWorkspace() {
  const workspace = await prisma.workspace.upsert({
    where: { id: DEFAULT_WORKSPACE_ID },
    update: {
      name: process.env.BUSINESS_NAME || 'Marca demo',
      slug: DEFAULT_WORKSPACE_SLUG,
      status: 'ACTIVE'
    },
    create: {
      id: DEFAULT_WORKSPACE_ID,
      name: process.env.BUSINESS_NAME || 'Marca demo',
      slug: DEFAULT_WORKSPACE_SLUG,
      status: 'ACTIVE'
    }
  });

  await prisma.workspaceAiConfig.upsert({
    where: { workspaceId: DEFAULT_WORKSPACE_ID },
    update: {
      businessName: process.env.BUSINESS_NAME || 'Marca demo',
      agentName: process.env.AGENT_NAME || 'Sofi',
      tone: process.env.BRAND_TONE || 'cercano, claro y comercial',
      catalogMode: 'TIENDANUBE'
    },
    create: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      businessName: process.env.BUSINESS_NAME || 'Marca demo',
      agentName: process.env.AGENT_NAME || 'Sofi',
      tone: process.env.BRAND_TONE || 'cercano, claro y comercial',
      catalogMode: 'TIENDANUBE'
    }
  });

  await prisma.workspaceBranding.upsert({
    where: { workspaceId: DEFAULT_WORKSPACE_ID },
    update: {},
    create: { workspaceId: DEFAULT_WORKSPACE_ID }
  });

  return workspace;
}

async function upsertUser({ workspaceId, name, email, password, role }) {
  const passwordHash = await bcrypt.hash(password, 10);

  return prisma.user.upsert({
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
}

async function main() {
  const workspace = await ensureDefaultWorkspace();
  const admin = await upsertUser({
    workspaceId: workspace.id,
    name: process.env.SEED_ADMIN_NAME || 'Admin',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.SEED_ADMIN_PASSWORD || 'Admin1234!',
    role: 'ADMIN'
  });

  const agent = await upsertUser({
    workspaceId: workspace.id,
    name: process.env.SEED_AGENT_NAME || 'Agente',
    email: process.env.SEED_AGENT_EMAIL || 'agent@example.com',
    password: process.env.SEED_AGENT_PASSWORD || 'Agent1234!',
    role: 'AGENT'
  });

  const waId = '5490000000000';

  const contact = await prisma.contact.upsert({
    where: {
      workspaceId_waId: {
        workspaceId: workspace.id,
        waId
      }
    },
    update: {
      name: 'Cliente Demo',
      phone: waId
    },
    create: {
      workspaceId: workspace.id,
      waId,
      phone: waId,
      name: 'Cliente Demo'
    }
  });

  let conversation = await prisma.conversation.findFirst({
    where: { workspaceId: workspace.id, contactId: contact.id }
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        workspaceId: workspace.id,
        contactId: contact.id,
        aiEnabled: true,
        lastSummary: 'Cliente demo interesada en body modelador, talle y promo por transferencia.',
        lastMessageAt: new Date(),
        messages: {
          create: [
            {
              workspaceId: workspace.id,
              direction: 'INBOUND',
              senderName: 'Cliente Demo',
              body: 'Hola, me interesa el body modelador. ¿Tenés talle M/L?'
            },
            {
              workspaceId: workspace.id,
              direction: 'OUTBOUND',
              senderName: process.env.BUSINESS_NAME || 'Marca demo',
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
