import { prisma } from '../src/lib/prisma.js';

const TEST_PHONE = '5492923562286';

async function main() {
	const contact = await prisma.contact.findFirst({
		where: {
			OR: [
				{ phone: TEST_PHONE },
				{ waId: TEST_PHONE }
			]
		},
		include: {
			conversations: {
				select: {
					id: true
				}
			}
		}
	});

	if (!contact) {
		console.log(`No se encontró contacto para ${TEST_PHONE}`);
		return;
	}

	const conversationIds = contact.conversations.map((c) => c.id);

	if (!conversationIds.length) {
		console.log(`El contacto ${TEST_PHONE} no tiene conversaciones`);
		return;
	}

	const result = await prisma.conversationState.deleteMany({
		where: {
			conversationId: {
				in: conversationIds
			}
		}
	});

	console.log(`ConversationState borrados: ${result.count}`);
	console.log(`Conversation IDs afectados:`, conversationIds);
}

main()
	.catch((error) => {
		console.error('Error borrando ConversationState:', error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});