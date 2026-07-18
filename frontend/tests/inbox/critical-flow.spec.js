import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const mockUser = {
	id: 'user-demo',
	email: 'admin@example.test',
	name: 'Admin Demo',
	role: 'ADMIN',
	workspaceId: 'workspace-demo',
	workspace: {
		id: 'workspace-demo',
		name: 'Marca Demo',
		slug: 'marca-demo',
		status: 'ACTIVE',
		branding: null,
	},
};

const contacts = [
	{
		conversationId: 'conversation-demo-1',
		displayName: 'Cliente Demo',
		phoneDisplay: '+54 11 0000 0001',
		preview: 'Necesito ayuda con mi pedido',
		lastMessageAt: '2026-07-17T15:30:00.000Z',
		lastMessageDirection: 'INBOUND',
		queue: 'AUTO',
		aiEnabled: true,
		unreadCount: 2,
		hasUnread: true,
		avatar: { initials: 'CD' },
	},
	{
		conversationId: 'conversation-demo-2',
		displayName: 'Consulta Sintética',
		phoneDisplay: '+54 11 0000 0002',
		preview: 'Gracias por la información',
		lastMessageAt: '2026-07-17T14:00:00.000Z',
		lastMessageDirection: 'OUTBOUND',
		queue: 'AUTO',
		aiEnabled: true,
		unreadCount: 0,
		hasUnread: false,
		avatar: { initials: 'CS' },
	},
];

const conversation = {
	id: 'conversation-demo-1',
	queue: 'AUTO',
	aiEnabled: true,
	unreadCount: 2,
	hasUnread: true,
	contact: {
		name: 'Cliente Demo',
		phone: '+54 11 0000 0001',
		profileImageUrl: '',
	},
	state: {
		lastDetectedIntent: 'ORDER_STATUS',
		lastUserGoal: 'Consultar pedido',
		needsHuman: false,
	},
	messages: [
		{
			id: 'message-demo-1',
			direction: 'INBOUND',
			body: 'Hola, necesito ayuda con mi pedido.',
			type: 'text',
			createdAt: '2026-07-17T15:30:00.000Z',
			createdAtLabel: '17/7/2026, 12:30',
		},
	],
	messagesPage: { limit: 80, hasMore: false, nextBefore: null },
};

function json(body, status = 200) {
	return {
		status,
		contentType: 'application/json',
		body: JSON.stringify(body),
	};
}

async function installInboxApi(page, {
	failInboxAttempts = 0,
	failConversationAttempts = 0,
	failureControl = null,
	queueControl = null,
} = {}) {
	let sendAttempts = 0;
	let inboxAttempts = 0;
	let conversationAttempts = 0;
	let activeQueue = 'AUTO';

	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname.replace(/^\/api/, '');

		if (pathname === '/auth/me') {
			await route.fulfill(json({ ok: true, user: mockUser }));
			return;
		}

		if (pathname === '/dashboard/inbox/stream') {
			await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
			return;
		}

		if (pathname === '/dashboard/inbox') {
			inboxAttempts += 1;
			if (failureControl ? !failureControl.allowInbox : inboxAttempts <= failInboxAttempts) {
				await route.fulfill(json({ ok: false, error: 'Bandeja temporalmente no disponible.' }, 503));
				return;
			}
			activeQueue = String(new URL(request.url()).searchParams.get('queue') || 'AUTO').toUpperCase();
			const queueContacts = contacts.map((contact) => ({
				...contact,
				queue: activeQueue,
				aiEnabled: activeQueue === 'AUTO',
			}));
			await route.fulfill(json({
				ok: true,
				contacts: queueContacts,
				counts: { ALL: 2, AUTO: 2, HUMAN: 0, PAYMENT_REVIEW: 0 },
				nextOffset: null,
				selectedContact: queueContacts[0],
			}));
			return;
		}

		if (pathname === '/dashboard/conversations/conversation-demo-1/messages' && request.method() === 'GET') {
			conversationAttempts += 1;
			if (failureControl ? !failureControl.allowConversation : conversationAttempts <= failConversationAttempts) {
				await route.fulfill(json({ ok: false, error: 'Historial temporalmente no disponible.' }, 503));
				return;
			}
			await route.fulfill(json({
				ok: true,
				conversation: {
					...conversation,
					queue: activeQueue,
					aiEnabled: activeQueue === 'AUTO',
				},
			}));
			return;
		}

		if (pathname === '/dashboard/conversations/conversation-demo-1/read') {
			await route.fulfill(json({ ok: true, conversationId: conversation.id, unreadCount: 0 }));
			return;
		}

		if (
			pathname === '/dashboard/conversations/conversation-demo-1/payment-review/actions' &&
			request.method() === 'GET'
		) {
			await route.fulfill(json({
				ok: true,
				actions: [{
					id: 'payment-review-action-demo-1',
					conversationId: conversation.id,
					action: 'REJECT',
					previousQueue: 'PAYMENT_REVIEW',
					resultQueue: 'HUMAN',
					reason: 'El comprobante necesita una imagen más nítida.',
					actorUserId: 'user-demo',
					createdAt: '2026-07-17T15:20:00.000Z',
				}],
			}));
			return;
		}

		if (
			pathname === '/dashboard/conversations/conversation-demo-1/payment-review/actions' &&
			request.method() === 'POST'
		) {
			const payload = request.postDataJSON();
			queueControl?.requests?.push(payload);
			if (queueControl?.allowAction === false) {
				await route.fulfill(json({ ok: false, error: 'No pudimos actualizar la revisión.' }, 503));
				return;
			}
			activeQueue = 'HUMAN';
			await route.fulfill(json({
				ok: true,
				action: { action: payload.action, resultQueue: 'HUMAN', replayed: false },
				conversationId: conversation.id,
				queue: 'HUMAN',
				replayed: false,
			}, 201));
			return;
		}

		if (pathname === '/dashboard/conversations/conversation-demo-1/queue' && request.method() === 'PATCH') {
			const payload = request.postDataJSON();
			queueControl?.requests?.push(payload);
			if (queueControl?.failNext) {
				queueControl.failNext = false;
				await route.fulfill(json({ ok: false, error: 'No pudimos actualizar la revisión.' }, 503));
				return;
			}
			activeQueue = payload.queue;
			await route.fulfill(json({
				ok: true,
				conversationId: conversation.id,
				queue: payload.queue,
				aiEnabled: payload.queue === 'AUTO',
			}));
			return;
		}

		if (pathname === '/dashboard/conversations/conversation-demo-1/messages' && request.method() === 'POST') {
			sendAttempts += 1;
			if (sendAttempts === 1) {
				await route.fulfill(json({ ok: false, error: 'No se pudo enviar el mensaje de prueba.' }, 503));
				return;
			}

			await route.fulfill(json({ ok: true }));
			return;
		}

		await route.fulfill(json({ ok: true }));
	});

	return () => sendAttempts;
}

async function expectNoHorizontalPageOverflow(page) {
	await expect.poll(async () => page.evaluate(() => {
		const shell = document.querySelector('.admin-shell');
		const sidebar = document.querySelector('.admin-sidebar');
		const main = document.querySelector('.admin-main');
		const shellRect = shell?.getBoundingClientRect();
		const sidebarRect = sidebar?.getBoundingClientRect();
		const mainRect = main?.getBoundingClientRect();
		const insideViewport = (rect) => Boolean(rect)
			&& rect.left >= -1
			&& rect.right <= window.innerWidth + 1
			&& rect.width > 0;
		return document.documentElement.scrollWidth <= window.innerWidth
			&& Math.round(shellRect?.width || 0) === window.innerWidth
			&& insideViewport(sidebarRect)
			&& insideViewport(mainRect);
	})).toBe(true);
}

test('selecciona la primera conversación en desktop y conserva el borrador si falla el envío', async ({ page }) => {
	const getSendAttempts = await installInboxApi(page);
	await page.goto('/inbox/automatico');

	await expect(page).toHaveURL(/conversation=conversation-demo-1/);
	await expect(page.locator('.inbox-chat-workspace')).toBeVisible();
	await expect(
		page.locator('.inbox-contact-card').filter({ hasText: 'Cliente Demo' })
	).toHaveAttribute('aria-current', 'true');

	const composer = page.getByLabel('Mensaje', { exact: true });
	await composer.fill('Borrador que no debe perderse');
	await page.locator('button[title="Enviar"]').click();

	await expect(page.getByRole('alert')).toContainText('No se pudo enviar');
	await expect(composer).toHaveValue('Borrador que no debe perderse');
	await page.locator('button[title="Enviar"]').click();

	await expect(composer).toHaveValue('');
	expect(getSendAttempts()).toBe(2);
});

test('muestra contexto real en desktop y lo convierte en drawer en viewport compacto', async ({ page }) => {
	await installInboxApi(page);
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto('/inbox/automatico');

	const context = page.getByRole('complementary', { name: 'Contexto de la conversación' });
	await expect(context).toBeVisible();
	await expect(context).toContainText('Cliente Demo');
	await expect(context).toContainText('Estado de pedido');
	await expect(context).toContainText('Consultar pedido');
	await expect(page.getByRole('button', { name: 'Mostrar contexto' })).toBeHidden();

	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(context).toBeHidden();
	const toggle = page.getByRole('button', { name: 'Mostrar contexto' });
	await expect(toggle).toBeVisible();
	await toggle.click();
	await expect(context).toBeVisible();
	await expect(page.getByRole('button', { name: 'Cerrar contexto' })).toBeVisible();
	await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.getByRole('button', { name: 'Cerrar contexto' }).click();
	await expect(context).toBeHidden();
});

test('separa errores de lista e historial y permite reintentar sin perder el flujo', async ({ page }) => {
	const failureControl = { allowInbox: false, allowConversation: false };
	await installInboxApi(page, { failureControl });
	await page.goto('/inbox/automatico');

	const listError = page.getByRole('alert').filter({ hasText: 'No pudimos cargar las conversaciones' });
	await expect(listError).toBeVisible();
	await expect(page.getByText('No hay conversaciones en esta vista')).toHaveCount(0);
	await page.screenshot({ path: 'audit-artifacts/screenshots/after/inbox-list-error-1440x960.png', fullPage: true });
	failureControl.allowInbox = true;
	await listError.getByRole('button', { name: 'Reintentar' }).click();

	await expect(page.locator('.inbox-contact-card')).toHaveCount(2);
	await expect(page).toHaveURL(/conversation=conversation-demo-1/);

	const historyError = page.getByRole('alert').filter({ hasText: 'No pudimos cargar el historial' });
	await expect(historyError).toBeVisible();
	await expect(page.getByText('Todavia no hay mensajes.')).toHaveCount(0);
	await expect(page.getByLabel('Mensaje', { exact: true })).toBeDisabled();
	await page.screenshot({ path: 'audit-artifacts/screenshots/after/inbox-history-error-1440x960.png', fullPage: true });
	failureControl.allowConversation = true;
	await historyError.getByRole('button', { name: 'Reintentar historial' }).click();

	await expect(page.getByText('Hola, necesito ayuda con mi pedido.')).toBeVisible();
	await expect(page.getByLabel('Mensaje', { exact: true })).toBeEnabled();
});

test('revisión de comprobantes comunica errores y conserva la conversación al derivarla', async ({ page }) => {
	const queueControl = { allowAction: false, requests: [] };
	await installInboxApi(page, { queueControl });
	await page.setViewportSize({ width: 768, height: 1024 });
	await page.goto('/inbox/comprobantes');

	const selectedContact = page.locator('.inbox-contact-card').filter({ hasText: 'Cliente Demo' });
	await expect(selectedContact.getByLabel('2 mensajes sin leer')).toBeVisible();
	await expect(page.getByRole('group', { name: 'Filtrar conversaciones por estado de lectura' })).toBeVisible();
	await selectedContact.click();
	await expect(page).toHaveURL(/\/inbox\/comprobantes\?conversation=conversation-demo-1/);
	await expect(page.locator('.inbox-chat-workspace')).toBeVisible();

	const actionsTrigger = page.getByRole('button', { name: 'Acciones de conversacion' });
	await actionsTrigger.focus();
	await actionsTrigger.press('Enter');
	await expect(page.getByRole('menuitem', { name: 'Comprobantes' })).toHaveAttribute('aria-current', 'true');
	await expect(page.getByRole('menuitem', { name: 'Comprobante verificado' })).toHaveCount(0);
	await page.getByRole('menuitem', { name: 'Finalizar revisión y derivar' }).press('Enter');

	const actionError = page.getByRole('alert').filter({ hasText: 'No pudimos actualizar la revisión.' });
	await expect(actionError).toBeVisible();
	await expect(page).toHaveURL(/\/inbox\/comprobantes\?conversation=conversation-demo-1/);
	await page.screenshot({
		path: 'audit-artifacts/screenshots/after/inbox-payment-review-error-768x1024.png',
		fullPage: true,
	});

	queueControl.allowAction = true;
	await actionsTrigger.press('Enter');
	await page.getByRole('menuitem', { name: 'Finalizar revisión y derivar' }).press('Enter');

	await expect(page).toHaveURL(/\/inbox\/atencion-humana\?conversation=conversation-demo-1/);
	await expect(page.getByRole('status')).toContainText(
		'Revisión finalizada. La conversación pasó a atención humana.'
	);
	expect(queueControl.requests).toHaveLength(2);
	expect(queueControl.requests[0]).toMatchObject({
		action: 'HANDOFF',
		reason: 'Derivación manual desde revisión de comprobantes',
	});
	expect(queueControl.requests[1]).toMatchObject({
		action: 'HANDOFF',
		reason: 'Derivación manual desde revisión de comprobantes',
	});
	expect(queueControl.requests[1].idempotencyKey).toBe(queueControl.requests[0].idempotencyKey);
});

test('revisión de comprobantes exige motivo para rechazar y registra la acción', async ({ page }) => {
	const queueControl = { allowAction: true, requests: [] };
	await installInboxApi(page, { queueControl });
	await page.goto('/inbox/comprobantes');

	await page.getByText('Historial de comprobantes').click();
	await expect(page.getByText('Comprobante rechazado')).toBeVisible();
	await expect(page.getByText('El comprobante necesita una imagen más nítida.')).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.screenshot({
		path: 'audit-artifacts/screenshots/after/inbox-payment-review-history-1440x960.png',
		fullPage: true,
	});
	await page.setViewportSize({ width: 768, height: 1024 });
	await page.goto('/inbox/comprobantes');
	const paymentReviewContact = page.locator('.inbox-contact-card').filter({ hasText: 'Cliente Demo' });
	await expect(paymentReviewContact).toBeVisible();
	await paymentReviewContact.click();
	await expect(page.locator('.inbox-chat-workspace')).toBeVisible();
	await page.getByRole('button', { name: 'Acciones de conversacion' }).press('Enter');
	await page.getByRole('menuitem', { name: 'Rechazar comprobante' }).press('Enter');

	await expect(page.getByRole('dialog', { name: 'Rechazar comprobante' })).toBeVisible();
	await page.screenshot({
		path: 'audit-artifacts/screenshots/after/inbox-payment-review-reject-dialog-768x1024.png',
		fullPage: true,
	});
	await page.getByLabel('Motivo', { exact: true }).fill('El monto no coincide con el pedido.');
	await page.getByRole('button', { name: 'Rechazar y derivar' }).click();

	await expect(page).toHaveURL(/\/inbox\/atencion-humana\?conversation=conversation-demo-1/);
	await expect(page.getByRole('status')).toContainText('Rechazo registrado');
	expect(queueControl.requests[0]).toMatchObject({
		action: 'REJECT',
		reason: 'El monto no coincide con el pedido.',
	});
});

test.describe('inbox móvil progresivo', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('empieza en conversaciones y avanza al chat al seleccionar una', async ({ page }) => {
		await installInboxApi(page);
		await page.goto('/inbox/automatico');

		await expect(page).not.toHaveURL(/conversation=/);
		await expect(page.locator('.inbox-chat-empty')).toBeHidden();
		await expectNoHorizontalPageOverflow(page);

		const contact = page.locator('.inbox-contact-card').filter({ hasText: 'Cliente Demo' });
		await expect(contact).toHaveCount(1);
		await contact.click();

		await expect(page).toHaveURL(/conversation=conversation-demo-1/);
		await expect(page.locator('.inbox-page')).toHaveClass(/inbox-page--contacts-hidden/);
		await expect(page.locator('.inbox-chat-workspace')).toBeVisible();
		await expect(page.getByLabel('Mensaje', { exact: true })).toBeInViewport();
		await expectNoHorizontalPageOverflow(page);
	});
});

test('genera capturas deterministas del inbox mejorado', async ({ page }) => {
	await installInboxApi(page);
	const outputDir = 'audit-artifacts/screenshots/after';
	await mkdir(outputDir, { recursive: true });

	for (const viewport of [
		{ width: 1440, height: 960, name: 'inbox-auto-1440x960' },
		{ width: 1280, height: 800, name: 'inbox-auto-1280x800' },
	]) {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		await page.goto('/inbox/automatico');
		await expect(page).toHaveURL(/conversation=conversation-demo-1/);
		await expect(page.locator('.inbox-chat-workspace')).toBeVisible();
		await page.screenshot({ path: `${outputDir}/${viewport.name}.png`, fullPage: true });
	}

	await page.setViewportSize({ width: 768, height: 1024 });
	await page.goto('/inbox/automatico');
	await expect(page).not.toHaveURL(/conversation=/);
	await expect(page.locator('.inbox-contact-card')).toHaveCount(2);
	await expectNoHorizontalPageOverflow(page);
	await page.screenshot({ path: `${outputDir}/inbox-conversations-768x1024.png`, fullPage: true });
	const tabletContact = page.locator('.inbox-contact-card').filter({ hasText: 'Cliente Demo' });
	await expect(tabletContact).toHaveCount(1);
	await tabletContact.click();
	await expect(page.locator('.inbox-chat-workspace')).toBeVisible();
	await expectNoHorizontalPageOverflow(page);
	await page.screenshot({ path: `${outputDir}/inbox-chat-768x1024.png`, fullPage: true });

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/inbox/automatico');
	await expect(page).not.toHaveURL(/conversation=/);
	await expect(page.locator('.inbox-contact-card')).toHaveCount(2);
	await expectNoHorizontalPageOverflow(page);
	await page.screenshot({ path: `${outputDir}/inbox-conversations-390x844.png`, fullPage: true });

	const contact = page.locator('.inbox-contact-card').filter({ hasText: 'Cliente Demo' });
	await expect(contact).toHaveCount(1);
	await contact.click();
	await expect(page.locator('.inbox-chat-workspace')).toBeVisible();
	await expectNoHorizontalPageOverflow(page);
	await page.screenshot({ path: `${outputDir}/inbox-chat-390x844.png`, fullPage: true });

	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto('/inbox/comprobantes?conversation=conversation-demo-1');
	await expect(page.locator('.inbox-chat-workspace')).toBeVisible();
	await page.screenshot({ path: `${outputDir}/inbox-payment-review-1440x960.png`, fullPage: true });
});
