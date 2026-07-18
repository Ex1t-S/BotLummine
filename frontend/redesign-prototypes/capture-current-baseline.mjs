import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(frontendRoot, 'audit-artifacts/redesign-current');
const baseURL = 'http://127.0.0.1:4173';
const workspace = { id: 'workspace-redesign', name: 'Marca Demo', slug: 'marca-demo', status: 'ACTIVE', branding: null };
const user = { id: 'user-redesign', email: 'operador@example.test', name: 'Operador Demo', role: 'ADMIN', workspaceId: workspace.id, workspace };
const contacts = [
	{ conversationId: 'conversation-1', displayName: 'Lucía Gómez', phoneDisplay: '+54 11 0000 0001', preview: '¿Me queda en talle M?', lastMessageAt: '2026-07-18T13:42:00.000Z', lastMessageDirection: 'INBOUND', queue: 'AUTO', aiEnabled: true, unreadCount: 2, hasUnread: true, avatar: { initials: 'LG' } },
	{ conversationId: 'conversation-2', displayName: 'Tomás R.', phoneDisplay: '+54 11 0000 0002', preview: 'Mandé el comprobante recién.', lastMessageAt: '2026-07-18T13:30:00.000Z', lastMessageDirection: 'INBOUND', queue: 'AUTO', aiEnabled: true, unreadCount: 0, hasUnread: false, avatar: { initials: 'TR' } },
];
const conversation = {
	id: 'conversation-1', queue: 'AUTO', aiEnabled: true, unreadCount: 2, hasUnread: true,
	contact: { name: 'Lucía Gómez', phone: '+54 11 0000 0001', profileImageUrl: '' },
	state: { lastDetectedIntent: 'PRODUCT_QUERY', lastUserGoal: 'Consultar talle', needsHuman: false },
	messages: [
		{ id: 'message-1', direction: 'INBOUND', body: 'Hola, ¿tenés el body modelador en talle M?', type: 'text', createdAt: '2026-07-18T13:40:00.000Z', createdAtLabel: '18/7/2026, 10:40' },
		{ id: 'message-2', direction: 'OUTBOUND', body: 'Sí, tenemos M disponible. ¿Preferís negro o nude?', type: 'text', createdAt: '2026-07-18T13:41:00.000Z', createdAtLabel: '18/7/2026, 10:41' },
	],
	messagesPage: { limit: 80, hasMore: false, nextBefore: null },
};
const cart = { id: 'cart-1', contactName: 'Lucía Gómez', contactPhone: '+54 11 0000 0001', contactEmail: 'lucia@example.test', checkoutCreatedAt: '2026-07-18T11:00:00.000Z', createdAt: '2026-07-18T11:00:00.000Z', status: 'NEW', statusLabel: 'Nuevo', totalLabel: '$ 42.800,00', lastMessageSentLabel: 'Nunca', responsibleName: null, canOpenCart: true, abandonedCheckoutUrl: 'https://example.test/cart/synthetic', productsPreview: ['Body modelador negro'], displayCreatedAt: '18/7/2026, 08:00', shippingCity: 'Ciudad demo', shippingProvince: 'Provincia demo' };

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
function payload(pathname, request) {
	if (pathname === '/auth/me') return { ok: true, user };
	if (pathname === '/dashboard/operations/summary') return { totals: { activeConversations30d: 12, messages30dInbound: 40, messages30dOutbound: 31, paymentReview: 2, unreadConversations: 3, unreadMessages: 5, abandonedCartsNew: 1 }, workspaces: [{ workspace, metrics: { activeConversations30d: 12, unreadConversations: 3, unreadMessages: 5, paymentReview: 2, customersCount: 48, campaignsCount: 3 }, issues: [] }] };
	if (pathname.includes('/campaigns/abandoned-cart-automation/settings') || pathname.includes('/campaigns/pending-payment-automation/settings') || pathname.includes('/campaigns/shipment-notifications/settings')) return { settings: { enabled: false, configured: false, lastError: null } };
	if (pathname === '/dashboard/inbox') return { ok: true, contacts, counts: { ALL: 3, AUTO: 2, HUMAN: 1, PAYMENT_REVIEW: 1 }, nextOffset: null, selectedContact: contacts[0] };
	if (pathname === '/dashboard/inbox/stream') return null;
	if (pathname === '/dashboard/conversations/conversation-1/messages' && request.method() === 'GET') return { ok: true, conversation };
	if (pathname === '/dashboard/conversations/conversation-1/read') return { ok: true, conversationId: conversation.id, unreadCount: 0 };
	if (pathname.endsWith('/payment-review/actions')) return { ok: true, actions: [] };
	if (pathname === '/dashboard/abandoned-carts') return { ok: true, carts: [cart], stats: { total: 18, totalNew: 12, totalContacted: 6, showingFrom: 1, showingTo: 1 }, pagination: { page: 1, totalPages: 1, total: 18 } };
	if (pathname === '/campaigns/stats') return { overview: { total: 3, active: 1, sent: 420, delivered: 408, read: 286 }, stats: {} };
	if (pathname === '/campaigns/templates') return { templates: [] };
	if (pathname === '/campaigns') return { campaigns: [] };
	if (pathname === '/campaigns/schedules') return { schedules: [] };
	if (pathname.includes('/campaigns/')) return {};
	return {};
}

async function waitForPreview() {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		try { if ((await fetch(baseURL)).ok) return; } catch {}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error('Vite preview did not become ready.');
}

await mkdir(outputRoot, { recursive: true });
const preview = spawn('npm run preview -- --host 127.0.0.1', [], {
	cwd: frontendRoot,
	windowsHide: true,
	stdio: 'ignore',
	shell: true,
});
let browser;
try {
	await waitForPreview();
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname.replace(/^\/api/, '');
		if (pathname === '/dashboard/inbox/stream') { await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }); return; }
		await route.fulfill(json(payload(pathname, request)));
	});
	const viewports = [{ name: '1440x960', width: 1440, height: 960 }, { name: '1280x800', width: 1280, height: 800 }, { name: '768x1024', width: 768, height: 1024 }, { name: '390x844', width: 390, height: 844 }];
	const screens = [{ name: 'operations', path: '/operations' }, { name: 'inbox', path: '/inbox/automatico' }, { name: 'campaigns', path: '/campaigns/library' }, { name: 'carts', path: '/abandoned-carts' }];
	for (const viewport of viewports) {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		for (const screen of screens) {
			await page.goto(`${baseURL}${screen.path}`, { waitUntil: 'domcontentloaded' });
			await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
			await page.screenshot({ path: path.join(outputRoot, `${screen.name}-${viewport.name}.png`), fullPage: true });
		}
	}
	console.log(`Captured 16 current baselines into ${outputRoot}`);
} finally {
	await browser?.close();
	preview.kill();
}
