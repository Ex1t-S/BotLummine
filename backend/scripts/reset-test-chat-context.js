import { prisma } from '../src/lib/prisma.js';

const TEST_PHONE = '5492923562286';

async function main() {
	const contact = await prisma.contact.findFirst({
		where: {
			OR: [
				{ waId: TEST_PHONE },
				{ phone: TEST_PHONE }
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

	const deletedMessages = await prisma.message.deleteMany({
		where: {
			conversationId: {
				in: conversationIds
			}
		}
	});

	const resetState = await prisma.conversationState.updateMany({
		where: {
			conversationId: {
				in: conversationIds
			}
		},
		data: {
			customerName: null,
			lastIntent: null,
			lastDetectedIntent: null,
			lastUserGoal: null,
			lastOrderNumber: null,
			lastOrderId: null,
			preferredTone: null,
			customerMood: null,
			urgencyLevel: null,
			frequentSize: null,
			paymentPreference: null,
			deliveryPreference: null,
			interestedProducts: [],
			objections: [],
			needsHuman: false,
			handoffReason: null,
			interactionCount: 0,
			notes: null
		}
	});

	const resetConversations = await prisma.conversation.updateMany({
		where: {
			id: {
				in: conversationIds
			}
		},
		data: {
			lastSummary: null,
			lastMessageAt: null,
			queue: 'AUTO',
			aiEnabled: true,
			status: 'OPEN'
		}
	});

	console.log('✅ Limpieza completa hecha');
	console.log(`Contacto: ${contact.id}`);
	console.log(`Conversaciones afectadas: ${conversationIds.join(', ')}`);
	console.log(`Mensajes borrados: ${deletedMessages.count}`);
	console.log(`ConversationState reseteados: ${resetState.count}`);
	console.log(`Conversations reseteadas: ${resetConversations.count}`);
}

main()
	.catch((error) => {
		console.error('Error reseteando contexto del chat:', error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});