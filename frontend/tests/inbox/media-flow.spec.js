import { expect, test } from '@playwright/test';

const mockUser = {
	id: 'user-media-demo',
	email: 'admin@example.test',
	name: 'Admin Demo',
	role: 'ADMIN',
	workspaceId: 'workspace-media-demo',
	workspace: {
		id: 'workspace-media-demo',
		name: 'Marca Demo',
		slug: 'marca-demo',
		status: 'ACTIVE',
		branding: null,
	},
};

const conversation = {
	id: 'conversation-media-demo',
	queue: 'AUTO',
	aiEnabled: true,
	unreadCount: 0,
	hasUnread: false,
	contact: {
		name: 'Tomas',
		phone: '+54 11 0000 0001',
		profileImageUrl: '',
	},
	state: {
		lastDetectedIntent: '',
		lastUserGoal: '',
		needsHuman: false,
	},
	messages: [
		{
			id: 'message-audio-inbound',
			direction: 'INBOUND',
			body: '[Audio recibido]',
			type: 'audio',
			attachmentUrl: '/api/media/inbox/audio-demo.ogg',
			attachmentMimeType: 'audio/ogg; codecs=opus',
			rawPayload: { attachment: { type: 'audio', downloadPending: true } },
			createdAt: '2026-07-31T14:34:11.000Z',
		},
		{
			id: 'message-sticker-outbound',
			direction: 'OUTBOUND',
			body: '[Sticker recibido]',
			type: 'sticker',
			attachmentUrl: '/api/media/inbox/sticker-demo.webp',
			attachmentMimeType: 'image/webp',
			rawPayload: { attachment: { type: 'sticker' } },
			createdAt: '2026-07-31T14:35:11.000Z',
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

async function installMediaApi(page, { failAudioOnce = false } = {}) {
	let audioAttempts = 0;
	const stickerWebp = Buffer.from(
		'UklGRiIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
		'base64',
	);

	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const pathname = url.pathname;

		if (pathname === '/api/auth/me') {
			await route.fulfill(json({ ok: true, user: mockUser }));
			return;
		}

		if (pathname === '/api/dashboard/inbox') {
			await route.fulfill(json({
				ok: true,
				contacts: [{
					conversationId: conversation.id,
					displayName: 'Tomas',
					phoneDisplay: conversation.contact.phone,
					preview: 'Audio',
					lastMessageAt: conversation.messages.at(-1).createdAt,
					lastMessageDirection: 'OUTBOUND',
					queue: 'AUTO',
					aiEnabled: true,
					unreadCount: 0,
					hasUnread: false,
					avatar: { initials: 'TO' },
				}],
				counts: { ALL: 1, AUTO: 1, HUMAN: 0, PAYMENT_REVIEW: 0 },
				nextOffset: null,
				selectedContact: null,
			}));
			return;
		}

		if (pathname === '/api/dashboard/inbox/stream') {
			await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
			return;
		}

		if (pathname === `/api/dashboard/conversations/${conversation.id}/messages`) {
			await route.fulfill(json({ ok: true, conversation }));
			return;
		}

		if (pathname === `/api/dashboard/conversations/${conversation.id}/read`) {
			await route.fulfill(json({ ok: true, conversationId: conversation.id, unreadCount: 0 }));
			return;
		}

		if (pathname === '/api/media/inbox/audio-demo.ogg') {
			audioAttempts += 1;
			if (failAudioOnce && audioAttempts === 1) {
				await route.fulfill(json({ ok: false, error: 'Archivo no encontrado.' }, 404));
				return;
			}
			await route.fulfill({ status: 200, contentType: 'audio/ogg', body: Buffer.from('OggS-demo-audio') });
			return;
		}

		if (pathname === '/api/media/inbox/sticker-demo.webp') {
			await route.fulfill({ status: 200, contentType: 'image/webp', body: stickerWebp });
			return;
		}

		await route.fulfill(json({ ok: true }));
	});

	return () => audioAttempts;
}

test('carga audios y stickers autenticados de mensajes entrantes y enviados', async ({ page }) => {
	await installMediaApi(page);
	await page.goto('/inbox/automatico');

	await expect(page.locator('audio.inbox-attachment-audio')).toBeVisible();
	await expect(page.locator('audio.inbox-attachment-audio')).toHaveAttribute('src', /^blob:/);
	await expect(page.locator('img.inbox-attachment-sticker')).toBeVisible();
	await expect(page.locator('img.inbox-attachment-sticker')).toHaveAttribute('src', /^blob:/);
	await expect(page.getByText('Cargando audio')).toHaveCount(0);
});

test('permite reintentar un audio histórico que inicialmente no está disponible', async ({ page }) => {
	const getAudioAttempts = await installMediaApi(page, { failAudioOnce: true });
	await page.goto('/inbox/automatico');

	const errorCard = page.getByRole('alert').filter({ hasText: 'No se pudo cargar este archivo multimedia' });
	await expect(errorCard).toBeVisible();
	await errorCard.getByRole('button', { name: 'Reintentar' }).click();

	await expect(page.locator('audio.inbox-attachment-audio')).toBeVisible();
	await expect(page.locator('audio.inbox-attachment-audio')).toHaveAttribute('src', /^blob:/);
	expect(getAudioAttempts()).toBe(2);
});
