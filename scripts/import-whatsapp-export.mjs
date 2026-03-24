import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const [, , filePath, businessNameArg, waIdArg, contactNameArg] = process.argv;

if (!filePath || !businessNameArg || !waIdArg) {
  console.log('Uso: node scripts/import-whatsapp-export.mjs "./chat.txt" "Mi Negocio" "+549221..." "Cliente"');
  process.exit(1);
}

const businessName = businessNameArg.trim();
const waId = waIdArg.trim();
const contactName = (contactNameArg || 'Contacto importado').trim();

function parseDate(datePart, timePart) {
  const cleanDate = datePart.trim().replace(/\[/g, '').replace(/\]/g, '');
  const cleanTime = timePart.trim().replace(/\[/g, '').replace(/\]/g, '');

  const [day, month, yearShort] = cleanDate.split(/[\/.-]/).map((v) => Number(v));
  const [hour, minute, second = 0] = cleanTime.split(':').map((v) => Number(v));
  const year = yearShort < 100 ? 2000 + yearShort : yearShort;

  return new Date(year, month - 1, day, hour, minute, second);
}

function parseLine(line) {
  const patterns = [
    /^(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s-\s([^:]+):\s([\s\S]+)$/,
    /^\[(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\]\s([^:]+):\s([\s\S]+)$/
  ];

  for (const regex of patterns) {
    const match = line.match(regex);
    if (match) {
      return {
        date: parseDate(match[1], match[2]),
        sender: match[3].trim(),
        body: match[4].trim()
      };
    }
  }

  return null;
}

async function main() {
  const absolutePath = path.resolve(filePath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const rawLines = content.split(/\r?\n/);

  const entries = [];
  let current = null;

  for (const line of rawLines) {
    const parsed = parseLine(line);
    if (parsed) {
      if (current) entries.push(current);
      current = parsed;
    } else if (current && line.trim()) {
      current.body += `\n${line}`;
    }
  }

  if (current) entries.push(current);

  const contact = await prisma.contact.upsert({
    where: { waId },
    update: {
      name: contactName,
      phone: waId
    },
    create: {
      waId,
      phone: waId,
      name: contactName
    }
  });

  const existingConversation = await prisma.conversation.findFirst({
    where: { contactId: contact.id }
  });

  const conversation = existingConversation || await prisma.conversation.create({
    data: {
      contactId: contact.id,
      aiEnabled: false,
      lastMessageAt: new Date()
    }
  });

  for (const entry of entries) {
    const direction = entry.sender.toLowerCase() === businessName.toLowerCase()
      ? 'OUTBOUND'
      : 'INBOUND';

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderName: entry.sender,
        direction,
        body: entry.body,
        createdAt: entry.date
      }
    });
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: entries.at(-1)?.date || new Date()
    }
  });

  console.log(`Importadas ${entries.length} líneas al chat ${conversation.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
