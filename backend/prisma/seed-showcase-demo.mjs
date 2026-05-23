import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const WORKSPACE_SLUG = process.env.SHOWCASE_WORKSPACE_SLUG || 'bladeia-showcase';
const WORKSPACE_NAME = process.env.SHOWCASE_WORKSPACE_NAME || 'BladeIA Showcase';
const DEMO_EMAIL = process.env.SHOWCASE_ADMIN_EMAIL || 'showcase@bladeia.local';
const DEMO_PASSWORD = process.env.SHOWCASE_ADMIN_PASSWORD || 'DemoBladeIA2026!';
const NOW = new Date();

const PRODUCTS = [
	'Body seamless negro',
	'Pack remeras basicas',
	'Campera liviana urban',
	'Zapatillas daily white',
	'Jean wide fit azul',
	'Bolso city compact',
];

const CITIES = [
	['CABA', 'Buenos Aires'],
	['Rosario', 'Santa Fe'],
	['Cordoba', 'Cordoba'],
	['Mendoza', 'Mendoza'],
	['La Plata', 'Buenos Aires'],
];

function daysAgo(days, hours = 0) {
	return new Date(NOW.getTime() - (days * 24 + hours) * 60 * 60 * 1000);
}

function phoneAt(index) {
	return `549110000${String(index).padStart(4, '0')}`;
}

function cartProducts(index) {
	const first = PRODUCTS[index % PRODUCTS.length];
	const second = PRODUCTS[(index + 2) % PRODUCTS.length];
	return [
		{ name: first, quantity: 1, price: 32900 + index * 90 },
		{ name: second, quantity: index % 3 === 0 ? 2 : 1, price: 18900 + index * 45 },
	];
}

async function resetWorkspace() {
	await prisma.workspace.deleteMany({ where: { slug: WORKSPACE_SLUG } });

	return prisma.workspace.create({
		data: {
			name: WORKSPACE_NAME,
			slug: WORKSPACE_SLUG,
			status: 'ACTIVE',
			branding: {
				create: {
					primaryColor: '#36d399',
					secondaryColor: '#0f172a',
					accentColor: '#7dd3fc',
				},
			},
			aiConfig: {
				create: {
					businessName: 'BladeIA Demo Store',
					agentName: 'Asistente',
					tone: 'humana, directa y util',
					aiProfile: 'GENERIC_ECOMMERCE',
					vertical: 'ECOMMERCE',
					businessContext: 'Cuenta de demostracion sin clientes reales. Muestra inbox, campanas, pagos y recuperacion.',
					catalogConfig: {
						vertical: 'ECOMMERCE',
						aiProfile: 'GENERIC_ECOMMERCE',
					},
				},
			},
		},
	});
}

async function createAdmin(workspaceId) {
	const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
	return prisma.user.upsert({
		where: { email: DEMO_EMAIL },
		update: {
			name: 'Admin Showcase',
			passwordHash,
			role: 'ADMIN',
			workspaceId,
		},
		create: {
			name: 'Admin Showcase',
			email: DEMO_EMAIL,
			passwordHash,
			role: 'ADMIN',
			workspaceId,
		},
	});
}

async function createTemplates(workspaceId) {
	return prisma.whatsAppTemplate.createMany({
		data: [
			{
				workspaceId,
				wabaId: 'showcase-waba',
				metaTemplateId: 'tmpl-cart-recovery',
				name: 'carrito_abandonado_showcase',
				language: 'es_AR',
				category: 'MARKETING',
				status: 'APPROVED',
				qualityScore: 'GREEN',
				previewText: 'Hola {{1}}, guardamos tu carrito. Si queres, te ayudo a terminar la compra.',
				lastSyncedAt: daysAgo(1),
			},
			{
				workspaceId,
				wabaId: 'showcase-waba',
				metaTemplateId: 'tmpl-payment-pending',
				name: 'pago_pendiente_showcase',
				language: 'es_AR',
				category: 'UTILITY',
				status: 'APPROVED',
				qualityScore: 'GREEN',
				previewText: 'Vimos tu pedido {{1}}. Si ya pagaste, podes enviarnos el comprobante por aca.',
				lastSyncedAt: daysAgo(1),
			},
			{
				workspaceId,
				wabaId: 'showcase-waba',
				metaTemplateId: 'tmpl-shipment-ready',
				name: 'pedido_despachado_showcase',
				language: 'es_AR',
				category: 'UTILITY',
				status: 'APPROVED',
				qualityScore: 'GREEN',
				previewText: 'Tu pedido {{1}} ya fue despachado. Te compartimos el seguimiento.',
				lastSyncedAt: daysAgo(2),
			},
		],
	});
}

async function createInboxSample(workspaceId) {
	const queues = ['AUTO', 'HUMAN', 'PAYMENT_REVIEW'];
	const contacts = [];

	for (let index = 0; index < 12; index += 1) {
		const queue = queues[index % queues.length];
		const phone = phoneAt(index + 1);
		const contact = await prisma.contact.create({
			data: {
				workspaceId,
				waId: phone,
				phone,
				name: ['Julieta', 'Marcos', 'Camila', 'Nicolas'][index % 4] + ` Demo ${index + 1}`,
			},
		});

		const lastMessageAt = daysAgo(index % 4, index);
		const conversation = await prisma.conversation.create({
			data: {
				workspaceId,
				contactId: contact.id,
				queue,
				aiEnabled: queue === 'AUTO',
				status: 'OPEN',
				lastSummary:
					queue === 'PAYMENT_REVIEW'
						? 'Cliente envio comprobante y espera validacion.'
						: queue === 'HUMAN'
							? 'Consulta comercial derivada a una persona.'
							: 'Conversacion respondida automaticamente con seguimiento comercial.',
				lastMessageAt,
				lastInboundMessageAt: lastMessageAt,
				lastReadAt: index % 2 === 0 ? daysAgo(0, index + 1) : null,
				unreadCount: index % 2 === 0 ? 0 : 2 + (index % 3),
				state: {
					create: {
						customerName: contact.name,
						lastDetectedIntent:
							queue === 'PAYMENT_REVIEW'
								? 'payment_proof'
								: queue === 'HUMAN'
									? 'needs_advisor'
									: 'product_interest',
						needsHuman: queue !== 'AUTO',
						handoffReason: queue === 'AUTO' ? null : queue === 'HUMAN' ? 'Pidio hablar con una persona' : 'Comprobante recibido',
						interactionCount: 4 + index,
						customerMood: index % 3 === 0 ? 'positive' : 'neutral',
						salesStage: queue === 'PAYMENT_REVIEW' ? 'payment_validation' : 'consideration',
						commercialSummary: 'Registro ficticio para material de demostracion.',
					},
				},
				messages: {
					create: [
						{
							workspaceId,
							direction: 'INBOUND',
							senderName: contact.name,
							body:
								queue === 'PAYMENT_REVIEW'
									? 'Te mando el comprobante del pedido para validar.'
									: queue === 'HUMAN'
										? 'Quiero ver si puedo cambiar talle antes de pagar.'
										: 'Hola, me interesa ese producto. Tenes stock?',
							type: queue === 'PAYMENT_REVIEW' ? 'document' : 'text',
							attachmentName: queue === 'PAYMENT_REVIEW' ? `comprobante-demo-${index + 1}.pdf` : null,
							attachmentMimeType: queue === 'PAYMENT_REVIEW' ? 'application/pdf' : null,
							attachmentUrl: queue === 'PAYMENT_REVIEW' ? 'https://example.com/demo-comprobante.pdf' : null,
							createdAt: daysAgo(index % 4, index + 2),
						},
						{
							workspaceId,
							direction: 'OUTBOUND',
							senderName: 'Asistente',
							body:
								queue === 'PAYMENT_REVIEW'
									? 'Recibido. Lo dejamos para revision y te confirmamos por este chat.'
									: queue === 'HUMAN'
										? 'Te derivo con el equipo para resolverlo bien.'
										: 'Si, hay stock. Si queres, te paso opciones y formas de compra.',
							model: queue === 'AUTO' ? 'showcase-auto-reply' : 'showcase-route-note',
							createdAt: lastMessageAt,
						},
					],
				},
			},
		});

		contacts.push({ contact, conversation });
	}

	return contacts;
}

async function createAbandonedCarts(workspaceId) {
	const records = Array.from({ length: 200 }, (_, index) => {
		const [shippingCity, shippingProvince] = CITIES[index % CITIES.length];
		const status = index % 5 === 0 ? 'CONTACTED' : index % 11 === 0 ? 'RECOVERED' : 'NEW';
		const checkoutCreatedAt = daysAgo(index % 14, index % 20);
		const totalAmount = 47900 + index * 375;

		return {
			workspaceId,
			provider: 'TIENDANUBE',
			storeId: 'showcase-store',
			checkoutId: `showcase-checkout-${String(index + 1).padStart(3, '0')}`,
			token: `showcase-token-${index + 1}`,
			contactName: `Cliente Carrito ${index + 1}`,
			contactEmail: `cliente${index + 1}@demo.local`,
			contactPhone: phoneAt(index + 100),
			abandonedCheckoutUrl: `https://example.com/demo-cart/${index + 1}`,
			subtotal: totalAmount - 3900,
			totalAmount,
			currency: 'ARS',
			gateway: index % 2 === 0 ? 'Mercado Pago' : 'Transferencia',
			shipping: 'Envio a domicilio',
			shippingCity,
			shippingProvince,
			shippingZipcode: `1${String(index).padStart(3, '0')}`,
			status,
			contactedAt: status === 'CONTACTED' ? daysAgo(index % 5, 2) : null,
			recoveredAt: status === 'RECOVERED' ? daysAgo(index % 3, 1) : null,
			lastMessageSentAt: status === 'CONTACTED' ? daysAgo(index % 5, 1) : null,
			products: cartProducts(index),
			checkoutCreatedAt,
			createdAt: checkoutCreatedAt,
			updatedAt: status === 'NEW' ? checkoutCreatedAt : daysAgo(index % 4, 1),
		};
	});

	await prisma.abandonedCart.createMany({ data: records });
}

async function createCampaigns(workspaceId, adminId) {
	const campaigns = [];
	const definitions = [
		{
			name: 'Recuperacion fin de semana',
			templateName: 'carrito_abandonado_showcase',
			templateMetaId: 'tmpl-cart-recovery',
			templateCategory: 'MARKETING',
			status: 'FINISHED',
			startedAt: daysAgo(4),
			finishedAt: daysAgo(3),
			totalRecipients: 120,
			sentRecipients: 120,
			deliveredRecipients: 112,
			readRecipients: 87,
			failedRecipients: 3,
		},
		{
			name: 'Pagos pendientes hoy',
			templateName: 'pago_pendiente_showcase',
			templateMetaId: 'tmpl-payment-pending',
			templateCategory: 'UTILITY',
			status: 'RUNNING',
			startedAt: daysAgo(0, 3),
			totalRecipients: 48,
			pendingRecipients: 9,
			sentRecipients: 39,
			deliveredRecipients: 31,
			readRecipients: 18,
			failedRecipients: 1,
		},
		{
			name: 'Despachos de la tarde',
			templateName: 'pedido_despachado_showcase',
			templateMetaId: 'tmpl-shipment-ready',
			templateCategory: 'UTILITY',
			status: 'QUEUED',
			totalRecipients: 32,
			pendingRecipients: 32,
		},
	];

	for (const definition of definitions) {
		const campaign = await prisma.campaign.create({
			data: {
				workspaceId,
				launchedByUserId: adminId,
				templateLanguage: 'es_AR',
				audienceSource: definition.templateName.includes('carrito') ? 'abandoned_carts' : 'workspace_segment',
				previewText: `Plantilla demo ${definition.templateName}`,
				notes: 'Campana ficticia para capturas comerciales.',
				...definition,
			},
		});
		campaigns.push(campaign);
	}

	const recipients = [];
	for (let index = 0; index < 48; index += 1) {
		const campaign = campaigns[index % campaigns.length];
		const status = index % 7 === 0 ? 'FAILED' : index % 4 === 0 ? 'READ' : index % 3 === 0 ? 'DELIVERED' : 'SENT';
		recipients.push({
			workspaceId,
			campaignId: campaign.id,
			phone: phoneAt(index + 400),
			waId: phoneAt(index + 400),
			contactName: `Destinatario Demo ${index + 1}`,
			status,
			waMessageId: `showcase-wa-message-${index + 1}`,
			renderedPreviewText: 'Hola, te escribimos con una accion configurada para esta audiencia.',
			sentAt: status === 'PENDING' ? null : daysAgo(index % 3, 1),
			deliveredAt: ['DELIVERED', 'READ'].includes(status) ? daysAgo(index % 2, 1) : null,
			readAt: status === 'READ' ? daysAgo(0, index % 5) : null,
			failedAt: status === 'FAILED' ? daysAgo(0, index % 5) : null,
		});
	}
	await prisma.campaignRecipient.createMany({ data: recipients });

	const storedRecipients = await prisma.campaignRecipient.findMany({
		where: { workspaceId, status: 'READ' },
		take: 8,
		orderBy: { createdAt: 'asc' },
	});

	await prisma.campaignConversion.createMany({
		data: storedRecipients.map((recipient, index) => ({
			workspaceId,
			campaignId: recipient.campaignId,
			recipientId: recipient.id,
			conversionKey: `showcase-conversion-${index + 1}`,
			source: 'ORDER',
			confidence: 'HIGH',
			orderId: `showcase-order-${index + 1}`,
			orderNumber: `#BIA-${1200 + index}`,
			contactName: recipient.contactName,
			phone: recipient.phone,
			email: `conversion${index + 1}@demo.local`,
			amount: 78900 + index * 2100,
			currency: 'ARS',
			paymentStatus: 'PAID',
			sentAt: recipient.sentAt,
			convertedAt: daysAgo(index % 2, index + 1),
			matchReason: 'Mismo telefono que el destinatario de la campana.',
		})),
	});

	return campaigns;
}

async function createAutomationSettings(workspaceId, campaigns) {
	await prisma.abandonedCartAutomationSetting.create({
		data: {
			workspaceId,
			enabled: true,
			templateName: 'carrito_abandonado_showcase',
			templateLanguage: 'es_AR',
			filters: { minAmount: 35000, status: ['NEW'] },
			intervalMinutes: 60,
			minCartAgeMinutes: 90,
			lastRunAt: daysAgo(0, 2),
			lastCampaignId: campaigns[0]?.id || null,
			runCount: 14,
		},
	});

	await prisma.pendingPaymentAutomationSetting.create({
		data: {
			workspaceId,
			enabled: true,
			templateName: 'pago_pendiente_showcase',
			templateLanguage: 'es_AR',
			filters: { paymentStatus: 'PENDING' },
			variableMapping: { orderNumber: '1', customerName: '2' },
			intervalMinutes: 60,
			minOrderAgeMinutes: 120,
			lastRunAt: daysAgo(0, 1),
			lastCampaignId: campaigns[1]?.id || null,
			runCount: 9,
		},
	});

	await prisma.shipmentNotificationSetting.create({
		data: {
			workspaceId,
			enabled: false,
			templateName: 'pedido_despachado_showcase',
			templateLanguage: 'es_AR',
			variableMapping: { orderNumber: '1', trackingUrl: '2' },
			daysBack: 7,
			lastRunAt: daysAgo(1),
			lastCampaignId: campaigns[2]?.id || null,
			runCount: 4,
		},
	});
}

async function main() {
	const workspace = await resetWorkspace();
	const admin = await createAdmin(workspace.id);

	await createTemplates(workspace.id);
	await createInboxSample(workspace.id);
	await createAbandonedCarts(workspace.id);
	const campaigns = await createCampaigns(workspace.id, admin.id);
	await createAutomationSettings(workspace.id, campaigns);

	console.log('SHOWCASE DEMO READY');
	console.log(`workspace: ${workspace.slug}`);
	console.log(`email: ${DEMO_EMAIL}`);
	console.log(`password: ${DEMO_PASSWORD}`);
	console.log('carts: 200');
	console.log('campaigns: 3');
	console.log('templates: 3');
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
