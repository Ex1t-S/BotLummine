import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const workspace = {
	id: 'workspace-synthetic',
	name: 'Marca Sintetica',
	slug: 'marca-sintetica',
	status: 'ACTIVE',
	branding: null,
	aiConfig: {},
	commerceConnections: [],
	storeInstallations: [],
	whatsappChannels: [],
	logisticsConnections: [],
};

function json(body, status = 200) {
	return {
		status,
		contentType: 'application/json',
		body: JSON.stringify(body),
	};
}

async function installAdminApi(page, { role, control }) {
	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname.replace(/^\/api/, '');

		if (pathname === '/auth/me') {
			await route.fulfill(json({
				ok: true,
				user: {
					id: 'user-synthetic',
					email: 'admin@example.test',
					name: 'Admin Sintetico',
					role,
					workspaceId: role === 'PLATFORM_ADMIN' ? null : workspace.id,
					workspace: role === 'PLATFORM_ADMIN' ? null : workspace,
				},
			}));
			return;
		}

		if (pathname === '/admin/workspaces') {
			if (!control.allowWorkspaces) {
				await route.fulfill(json({ ok: false, error: 'Servicio de marcas temporalmente no disponible.' }, 503));
				return;
			}
			await route.fulfill(json({ workspaces: [workspace] }));
			return;
		}

		if (pathname === '/admin/analytics/workspaces') {
			if (!control.allowAnalytics) {
				await route.fulfill(json({ ok: false, error: 'Servicio de estadisticas temporalmente no disponible.' }, 503));
				return;
			}
			await route.fulfill(json({ totals: {}, workspaces: [] }));
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

		await route.fulfill(json({}));
	});
}

test.beforeAll(async () => {
	await mkdir('audit-artifacts/screenshots/after', { recursive: true });
});

test('separa el error de marcas del estado vacio y permite reintentar', async ({ page }) => {
	const control = { allowWorkspaces: false, allowAnalytics: true };
	await installAdminApi(page, { role: 'PLATFORM_ADMIN', control });
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto('/admin');

	const errorState = page.getByRole('alert').filter({ hasText: 'No pudimos cargar las marcas' });
	await expect(errorState).toBeVisible();
	await expect(page.getByText('Todavia no hay marcas creadas.')).toHaveCount(0);
	await errorState.scrollIntoViewIfNeeded();
	await page.screenshot({
		path: 'audit-artifacts/screenshots/after/admin-workspaces-error-1440x960.png',
	});

	control.allowWorkspaces = true;
	await errorState.getByRole('button', { name: 'Reintentar' }).click();
	await expect(page.locator('.tenant-admin-workspace-card').filter({ hasText: 'Marca Sintetica' })).toBeVisible();
});

test('separa el error de analytics de las metricas y conserva recuperacion', async ({ page }) => {
	const control = { allowWorkspaces: true, allowAnalytics: false };
	await installAdminApi(page, { role: 'ADMIN', control });
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto('/analytics');

	const errorState = page.getByRole('alert').filter({ hasText: 'No pudimos cargar las estadisticas' });
	await expect(errorState).toBeVisible();
	await expect(page.getByText('Campañas: 0')).toHaveCount(0);
	await expect(page.getByText('No hay marcas para mostrar')).toHaveCount(0);
	await errorState.scrollIntoViewIfNeeded();
	await page.screenshot({
		path: 'audit-artifacts/screenshots/after/admin-analytics-error-1440x960.png',
	});

	control.allowAnalytics = true;
	await errorState.getByRole('button', { name: 'Reintentar' }).click();
	await expect(page.getByText('No hay marcas para mostrar')).toBeVisible();
	await expect(page.getByRole('alert').filter({ hasText: 'No pudimos cargar las estadisticas' })).toHaveCount(0);
});
