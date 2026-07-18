import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ request }) => {
	await request.post('/api/demo/reset');
});

test('el resumen usa contadores de API y no mezcla borradores con fallos', async ({ page }) => {
	await page.goto('/campaigns');
	const deliveryMetric = page.locator('.campaign-os-metric').filter({ hasText: 'Entrega' });
	await expect(deliveryMetric).toContainText('94');
	await expect(deliveryMetric).not.toContainText('0%');
	const attentionMetric = page.locator('.campaign-os-metric').filter({ hasText: 'Errores pendientes' });
	await expect(attentionMetric).toContainText('2');
	await expect(attentionMetric).toContainText('Sólo campañas fallidas o parciales');
});

test('recorre el entorno demo sin depender del backend ni de Railway', async ({ page }) => {
	await page.goto('/operations');
	await expect(page.getByRole('status', { name: 'Modo demo local activo' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Lo que requiere tu atención', level: 2 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Prioridades de hoy' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Salud operativa' })).toBeVisible();

	await page.goto('/campaigns');
	await expect(page.getByRole('heading', { name: 'Centro de campañas', level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Campañas recientes' })).toBeVisible();

	await page.goto('/campaigns/audiences');
	await expect(page.getByRole('heading', { name: 'Elegí primero a quién querés contactar' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Usar esta audiencia' })).toBeVisible();

	await page.goto('/campaigns/automations');
	await expect(page.getByRole('heading', { name: 'Automatizaciones con propósito claro' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Configurar' })).toHaveCount(3);

	await page.goto('/campaigns/results');
	await expect(page.getByRole('heading', { name: 'Qué funcionó y qué necesita atención' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Campañas', level: 3 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Clientes frecuentes · Julio' })).toBeVisible();

	await page.goto('/abandoned-carts');
	const cartsTable = page.getByRole('table', { name: 'Carritos abandonados ordenados desde el más reciente' });
	await expect(cartsTable).toBeVisible();
	await expect(cartsTable.getByText('Valentina Demo')).toBeVisible();
	await expect(cartsTable.getByText('$ 184.900,00')).toBeVisible();
	await expect(cartsTable.getByRole('columnheader', { name: 'Responsable' })).toHaveCount(0);
	expect(await cartsTable.getByText('No contactado', { exact: true }).count()).toBeGreaterThan(0);

	await page.goto('/campaigns/library');
	await expect(page.getByRole('heading', { name: 'recuperacion_carrito_demo' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'novedad_pedido_demo' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'beneficio_invierno_demo' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'recordatorio_evento_demo' })).toBeVisible();

	await page.goto('/campaigns/tracking');
	await expect(page.getByRole('button', { name: 'Ver seguimiento de Clientes frecuentes · Julio' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Ver seguimiento de Recuperación carritos · Semana 28' })).toBeVisible();

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

test('conecta resumen, resultados y seguimiento con la campaña elegida en la URL', async ({ page }) => {
	await page.goto('/campaigns');
	const finishedCampaign = page.locator('.campaign-os-row').filter({ hasText: 'Recuperación carritos · Semana 28' });
	await expect(finishedCampaign).toHaveCount(1);
	await finishedCampaign.getByRole('button', { name: 'Ver resultados' }).click();
	await expect(page).toHaveURL(/\/campaigns\/results\?campaign=campaign-demo-finished$/);
	await expect(page.getByRole('heading', { name: 'Recuperación carritos · Semana 28' })).toBeVisible();

	await page.getByRole('button', { name: 'Ver destinatarios' }).click();
	await expect(page).toHaveURL(/\/campaigns\/tracking\?campaign=campaign-demo-finished$/);
	await expect(page.getByRole('button', { name: 'Ver seguimiento de Recuperación carritos · Semana 28' })).toHaveAttribute('aria-pressed', 'true');
});

test('reintenta sólo fallidos de una campaña finalizada y protege los envíos aceptados', async ({ page }) => {
	await page.goto('/campaigns/tracking?campaign=campaign-demo-finished');
	const retryButton = page.getByRole('button', { name: 'Reintentar fallidos' });
	await expect(retryButton).toBeVisible();
	await expect(page.locator('.campaign-tracking-kpis--essential').getByText('86', { exact: true })).toBeVisible();
	await expect(page.getByText('2 fallidos · 0 pendientes')).toBeVisible();
	await expect(page.getByText('Error Meta 132000: las variables no coinciden con la plantilla.')).toBeVisible();

	await retryButton.click();
	const dialog = page.getByRole('dialog', { name: 'Reintentar envíos sin duplicar' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('2 fallidos', { exact: true })).toBeVisible();
	await expect(dialog.getByText('0 pendientes', { exact: true })).toBeVisible();
	await expect(dialog.getByText('86 ya enviados, protegidos', { exact: true })).toBeVisible();
	await expect(dialog.getByText('No se puede reintentar todavía.')).toBeVisible();
	const cancelRetry = dialog.getByRole('button', { name: 'Cancelar' });
	const confirmRetry = dialog.getByRole('button', { name: 'Confirmar reintento' });
	await expect(cancelRetry).toBeFocused();
	await expect(confirmRetry).toBeDisabled();
	await page.keyboard.press('Shift+Tab');
	await expect(cancelRetry).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();

	await page.getByRole('button', { name: 'Ver seguimiento de Aviso de temporada · Completada' }).click();
	await expect(page).toHaveURL(/campaign=campaign-demo-clean$/);
	await expect(page.getByRole('button', { name: 'Reintentar fallidos' })).toHaveCount(0);
});

for (const viewport of [
	{ name: 'desktop', width: 1440, height: 960 },
	{ name: 'tablet', width: 768, height: 1024 },
	{ name: 'mobile', width: 390, height: 844 },
]) {
	test(`muestra las cuatro plantillas completas en ${viewport.name}`, async ({ page }) => {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		await page.goto('/campaigns/library');

		const library = page.getByRole('list', { name: 'Plantillas disponibles' });
		const cards = library.getByRole('listitem');
		await expect(cards).toHaveCount(4);

		for (const name of [
			'beneficio_invierno_demo',
			'recuperacion_carrito_demo',
			'novedad_pedido_demo',
			'recordatorio_evento_demo',
		]) {
			await expect(page.getByRole('heading', { name })).toBeVisible();
		}

		const layout = await library.evaluate((element) => {
			const style = window.getComputedStyle(element);
			const bounds = element.getBoundingClientRect();
			const children = Array.from(element.children).map((child) => child.getBoundingClientRect());
			return {
				overflowY: style.overflowY,
				columns: style.gridTemplateColumns.split(' ').length,
				allCardsInsideWidth: children.every((card) => card.left >= bounds.left - 1 && card.right <= bounds.right + 1),
				lastCardInsideList: children.at(-1)?.bottom <= bounds.bottom + 1,
			};
		});

		expect(layout.overflowY).not.toBe('auto');
		expect(layout.overflowY).not.toBe('scroll');
		expect(layout.allCardsInsideWidth).toBe(true);
		expect(layout.lastCardInsideList).toBe(true);
		expect(layout.columns).toBe(viewport.width <= 620 ? 1 : 2);

		const pendingCard = library.getByRole('listitem', { name: /beneficio_invierno_demo/ });
		const chooseButton = pendingCard.getByRole('button', { name: 'Elegir plantilla' });
		await chooseButton.click();
		await expect(pendingCard.getByRole('button', { name: 'Plantilla elegida' })).toHaveAttribute('aria-pressed', 'true');
		await expect(pendingCard.getByText('Elegida', { exact: true })).toBeVisible();

		if (viewport.name === 'mobile') {
			await page.screenshot({
				path: `audit-artifacts/campaign-template-picker-patch/templates-${viewport.width}x${viewport.height}.png`,
			});
			await page.locator('.admin-content').evaluate((element) => {
				element.scrollTop = element.scrollHeight;
			});
			await page.screenshot({
				path: `audit-artifacts/campaign-template-picker-patch/templates-${viewport.width}x${viewport.height}-final.png`,
			});
		} else {
			await page.locator('.template-library-shell').screenshot({
				path: `audit-artifacts/campaign-template-picker-patch/templates-${viewport.width}x${viewport.height}.png`,
			});
		}
	});
}

test('mantiene visible el encabezado al recorrer una operación extensa', async ({ page }) => {
	await page.goto('/operations');
	await page.getByText('Administrar', { exact: true }).click();
	await page.locator('.admin-content').evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});

	const topbar = page.locator('.admin-topbar');
	await expect(topbar).toBeVisible();
	await expect(topbar).toHaveCSS('opacity', '1');
	expect(await topbar.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m42)).toBe(0);
});

test('guía la creación de campaña sin duplicar la navegación anterior', async ({ page }) => {
	await page.goto('/campaigns/segment?audience=customers');
	await expect(page.getByRole('heading', { name: 'Centro de campañas', level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Crear campaña', level: 3 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Campañas de WhatsApp' })).toBeHidden();
	await expect(page.getByText('Nombre de campaña')).toBeVisible();

	await page.getByRole('button', { name: /2 Audiencia/ }).click();
	await expect(page.getByRole('heading', { name: 'Elegí a quién escribirle' })).toBeVisible();
});

test('mantiene el shell compacto y sin overflow en móvil', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	for (const route of ['/inbox/automatico', '/campaigns', '/campaigns/audiences', '/campaigns/automations', '/campaigns/results', '/campaigns/segment', '/analytics', '/abandoned-carts']) {
		await page.goto(route);
		await expect(page.locator('.admin-demo-mobile')).toBeVisible();
		await expect(page.locator('.admin-topbar')).toBeHidden();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	}
});

test('permite diseñar y comprobar el menú de WhatsApp en tiempo real', async ({ page }) => {
	await page.goto('/whatsapp-menu');
	await expect(page.getByRole('heading', { name: 'Diseñador de menú' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Así lo verá tu cliente' })).toBeVisible();

	await page.getByLabel('Mensaje principal').fill('Hola, elegí cómo podemos ayudarte hoy.');
	await expect(page.locator('.wam-phone__bubble').getByText('Hola, elegí cómo podemos ayudarte hoy.')).toBeVisible();

	const previewOption = page.locator('.wam-phone').getByRole('button', { name: '01 Ver productos Catálogo y recomendaciones' });
	await expect(previewOption).toBeVisible();
	await previewOption.click();
	await expect(page.locator('.wam-phone').getByText('La IA continúa con: Producto')).toBeVisible();
	await page.getByRole('button', { name: 'Guardar menú' }).click();
	await expect(page.getByText('Menú guardado correctamente.')).toBeVisible();

	await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
	await expect(page.locator('html')).toHaveClass(/dark/);
	await expect(page.locator('.wam-preview')).toBeVisible();
});

test('mantiene visible y usable el diseñador de menú en móvil', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/whatsapp-menu');
	await expect(page.getByRole('heading', { name: 'Así lo verá tu cliente' })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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

for (const viewport of [
	{ name: 'móvil', width: 390, height: 844 },
	{ name: 'tablet', width: 768, height: 1024 },
]) {
	test(`mantiene completas y separadas las filas del inbox en ${viewport.name}`, async ({ page }) => {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		await page.goto('/inbox/automatico');

		const rows = page.locator('.inbox-contact-card');
		await expect(rows.first()).toBeVisible();
		expect(await rows.count()).toBeGreaterThanOrEqual(2);

		const layout = await rows.evaluateAll((elements) => elements.slice(0, 8).map((row, index, visibleRows) => {
			const rowRect = row.getBoundingClientRect();
			const metaRect = row.querySelector('.inbox-contact-meta-v2')?.getBoundingClientRect();
			const nextRect = visibleRows[index + 1]?.getBoundingClientRect();
			return {
				height: rowRect.height,
				containsMetadata: !metaRect || metaRect.bottom <= rowRect.bottom + 0.5,
				doesNotOverlapNext: !nextRect || rowRect.bottom <= nextRect.top + 0.5,
			};
		}));

		expect(layout.every((row) => row.height >= 80)).toBe(true);
		expect(layout.every((row) => row.containsMetadata)).toBe(true);
		expect(layout.every((row) => row.doesNotOverlapNext)).toBe(true);
		const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		expect(horizontalOverflow).toBeLessThanOrEqual(1);
		if (viewport.width === 390) {
			await mkdir('audit-artifacts/inbox-card-cutoff', { recursive: true });
			await page.screenshot({
				path: 'audit-artifacts/inbox-card-cutoff/inbox-mobile-390x844.png',
				fullPage: true,
			});
		}
	});
}
