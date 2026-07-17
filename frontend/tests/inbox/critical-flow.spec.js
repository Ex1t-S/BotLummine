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

async function installInboxApi(page) {
	let sendAttempts = 0;
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
		const shellStyle = shell ? getComputedStyle(shell) : null;
		const availableWidth = window.innerWidth
			- Number.parseFloat(shellStyle?.paddingLeft || '0')
			- Number.parseFloat(shellStyle?.paddingRight || '0');
		return document.documentElement.scrollWidth <= window.innerWidth
			&& Math.round(shell?.getBoundingClientRect().width || 0) === window.innerWidth
			&& (sidebar?.getBoundingClientRect().width || 0) >= availableWidth - 1
			&& (main?.getBoundingClientRect().width || 0) >= availableWidth - 1;
	})).toBe(true);
}

test('selecciona la primera conversación en desktop y conserva el borrador si falla el envío', async ({ page }) => {
	const getSendAttempts = await installInboxApi(page);
	await page.goto('/inbox/automatico');

	await expect(page).toHaveURL(/conversation=conversation-demo-1/);
	await expect(page.locator('.inbox-chat-workspace')).toBeVisible();

	const composer = page.getByLabel('Mensaje', { exact: true });
	await composer.fill('Borrador que no debe perderse');
	await page.locator('button[title="Enviar"]').click();

	await expect(page.getByRole('alert')).toContainText('No se pudo enviar');
	await expect(composer).toHaveValue('Borrador que no debe perderse');
	await page.locator('button[title="Enviar"]').click();

	await expect(composer).toHaveValue('');
	expect(getSendAttempts()).toBe(2);
});

test.describe('inbox móvil progresivo', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('empieza en conversaciones y avanza al chat al seleccionar una', async ({ page }) => {
		await installInboxApi(page);
		await page.goto('/inbox/automatico');

		await expect(page).not.toHaveURL(/conversation=/);
		await expect(page.locator('.inbox-chat-empty')).toBeVisible();
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
