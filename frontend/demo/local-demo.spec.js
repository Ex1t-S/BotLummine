import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
	await request.post('/api/demo/reset');
});

test('recorre el entorno demo sin depender del backend ni de Railway', async ({ page }) => {
	await page.goto('/operations');
	await expect(page.getByRole('status', { name: 'Modo demo local activo' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Lummine Demo', level: 1 })).toBeVisible();
	await expect(page.getByText('Problemas o tareas detectadas')).toBeVisible();

	await page.goto('/abandoned-carts');
	const cartsTable = page.getByRole('table', { name: 'Carritos abandonados ordenados desde el más reciente' });
	await expect(cartsTable).toBeVisible();
	await expect(cartsTable.getByText('Valentina Demo')).toBeVisible();
	await expect(cartsTable.getByText('$ 184.900,00')).toBeVisible();

	await page.goto('/campaigns/library');
	await expect(page.getByRole('button', { name: 'recuperacion_carrito_demo' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'novedad_pedido_demo' })).toBeVisible();

	await page.goto('/campaigns/tracking');
	await expect(page.getByRole('button', { name: 'Ver tracking de Clientes frecuentes · Julio' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Ver tracking de Recuperación carritos · Semana 28' })).toBeVisible();

	await page.goto('/inbox/automatico');
	await expect(page.getByRole('heading', { name: 'Martina Demo' })).toBeVisible();
	await expect(page.getByLabel('Mensaje')).toBeVisible();
	await page.getByLabel('Mensaje').fill('Respuesta guardada sólo en el demo local.');
	await page.locator('button[title="Enviar"]').click();
	await expect(page.getByLabel('Historial de conversacion').getByText('Respuesta guardada sólo en el demo local.')).toBeVisible();

	await page.goto('/analytics');
	await expect(page.getByRole('main').getByRole('heading', { name: 'Estadísticas', level: 2 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Embudo de entrega' })).toBeVisible();
	await expect(page.getByRole('table', { name: 'Rendimiento de campañas recientes' })).toBeVisible();

	await page.goto('/ai-lab');
	await expect(page.getByLabel('Mensaje de prueba')).toBeEnabled();
	await page.getByLabel('Mensaje de prueba').fill('¿Tenés stock del producto demo?');
	await page.getByRole('button', { name: 'Enviar' }).click();
	await expect(page.getByText('En el modo demo no se consulta Gemini ni se envía contenido externo.', { exact: false })).toBeVisible();
});

test('mantiene el shell compacto y sin overflow en móvil', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	for (const route of ['/inbox/automatico', '/campaigns/segment', '/analytics', '/abandoned-carts']) {
		await page.goto(route);
		await expect(page.locator('.admin-demo-mobile')).toBeVisible();
		await expect(page.locator('.admin-topbar')).toBeHidden();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	}
});

test('simula creación y lanzamiento sin delivery externo', async ({ request }) => {
	const createdResponse = await request.post('/api/campaigns', {
		data: {
			name: 'Campaña creada por smoke demo',
			templateId: 'template-demo-approved',
			audienceSource: 'segment',
			totalRecipients: 12,
		},
	});
	expect(createdResponse.ok()).toBeTruthy();
	const created = await createdResponse.json();

	const launchedResponse = await request.post(`/api/campaigns/${created.campaign.id}/launch`);
	expect(launchedResponse.ok()).toBeTruthy();
	const launched = await launchedResponse.json();
	expect(launched.campaign.status).toBe('RUNNING');
	expect(launched.deliveredExternally).toBe(false);

	const sentResponse = await request.post('/api/dashboard/conversations/conversation-demo-auto/messages', {
		data: { body: 'Mensaje sintético de prueba' },
	});
	const sent = await sentResponse.json();
	expect(sent.deliveredExternally).toBe(false);
});
