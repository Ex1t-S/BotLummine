import { expect, test } from '@playwright/test';

const workspace = {
	id: 'workspace-kaisy-demo',
	name: 'Kaisy (demo)',
	slug: 'kaisy-demo',
	status: 'ACTIVE',
	aiConfig: {},
	commerceConnections: [],
	storeInstallations: [],
	whatsappChannels: [],
	whatsappApps: [{
		id: 'meta-app-demo',
		name: 'App Kaisy (demo)',
		metaAppId: '1234567890',
		embeddedSignupConfigId: 'https://example.test/invalid-config-link',
		callbackUrl: 'https://api.bladeia.com/api/webhook/whatsapp/demo-callback',
		status: 'ACTIVE',
	}],
	logisticsConnections: [],
};

function json(body, status = 200) {
	return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

test('guía manual: comprueba antes de vincular y no ofrece Embedded Signup con un enlace inválido', async ({ page }) => {
	const requests = { checks: 0, saves: 0 };
	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname.replace(/^\/api/, '');
		if (pathname === '/auth/me') {
			await route.fulfill(json({ ok: true, user: { id: 'admin-demo', name: 'Admin demo', email: 'admin@example.test', role: 'PLATFORM_ADMIN' } }));
			return;
		}
		if (pathname === '/admin/workspaces') {
			await route.fulfill(json({ workspaces: [workspace] }));
			return;
		}
		if (pathname === `/admin/workspaces/${workspace.id}`) {
			await route.fulfill(json({ workspace }));
			return;
		}
		if (pathname === `/admin/workspaces/${workspace.id}/users`) {
			await route.fulfill(json({ users: [] }));
			return;
		}
		if (pathname === `/admin/workspaces/${workspace.id}/whatsapp-channel/check`) {
			requests.checks += 1;
			await route.fulfill(json({
				ok: true,
				displayPhoneNumber: '+54 9 11 0000-0000',
				messagingPermissionCheck: { checked: true, missingScopes: [] },
				subscription: { checked: true, subscribed: false },
			}));
			return;
		}
		if (pathname === `/admin/workspaces/${workspace.id}/whatsapp-channel` && request.method() === 'PUT') {
			requests.saves += 1;
			await route.fulfill(json({ ok: true, subscription: { success: true } }));
			return;
		}
		await route.fulfill(json({}));
	});

	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto('/admin');
	await page.getByRole('button', { name: 'Integraciones' }).click();
	await page.getByText('Guía de configuración manual y requisitos de Meta').click();
	await expect(page.getByText('Conexión manual de WhatsApp Cloud API')).toBeVisible();
	await expect(page.getByText('Alternativa: Embedded Signup para una App habilitada por Meta')).toHaveCount(0);
	await expect(page.getByText('https://api.bladeia.com/api/webhook/whatsapp/demo-callback', { exact: true })).toBeVisible();

	const channelForm = page.locator('form').filter({ has: page.getByLabel('WABA ID') });
	await channelForm.getByLabel('WABA ID').fill('9876543210');
	await channelForm.getByLabel('Phone Number ID (no el teléfono visible)').fill('1122334455');
	await channelForm.getByLabel('Token de usuario del sistema').fill('demo-token-not-real');
	const connect = channelForm.getByRole('button', { name: 'Vincular y suscribir webhooks' });
	await expect(connect).toBeDisabled();
	await channelForm.getByRole('button', { name: 'Comprobar con Meta' }).click();
	await expect(page.getByText(/Meta reconoce \+54 9 11/)).toBeVisible();
	await expect(connect).toBeEnabled();

	await channelForm.getByLabel('Phone Number ID (no el teléfono visible)').fill('5544332211');
	await expect(connect).toBeDisabled();
	await channelForm.getByRole('button', { name: 'Comprobar con Meta' }).click();
	await connect.click();
	await expect(page.getByText(/Canal vinculado y App suscrita/)).toBeVisible();
	expect(requests).toEqual({ checks: 2, saves: 1 });
});
