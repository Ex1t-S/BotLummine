import {
	getWhatsAppMenuSettings,
	getWhatsAppMenuRuntimeConfig,
	resetWhatsAppMenuSettings,
	updateWhatsAppMenuSettings
} from '../services/whatsapp/whatsapp-menu.service.js';
import { requireRequestWorkspaceId } from '../services/workspaces/workspace-context.service.js';

export async function getWhatsAppMenu(req, res) {
	const workspaceId = requireRequestWorkspaceId(req);
	const settings = await getWhatsAppMenuSettings({ workspaceId });
	const runtime = await getWhatsAppMenuRuntimeConfig({ workspaceId, forceRefresh: true });

	return res.json({
		ok: true,
		settings: {
			id: settings.id,
			key: settings.key,
			name: settings.name,
			isActive: settings.isActive,
			config: settings.config
		},
		runtime: {
			mainMenuKey: runtime.mainMenuKey,
			menus: Object.values(runtime.menusByKey || {}).map((menu) => ({
				key: menu.key,
				title: menu.title,
				headerText: menu.headerText,
				body: menu.body,
				buttonText: menu.buttonText,
				footerText: menu.footerText,
				textFallback: menu.textFallback,
				sections: menu.sections,
				options: menu.options
			}))
		}
	});
}

export async function updateWhatsAppMenu(req, res) {
	const workspaceId = requireRequestWorkspaceId(req);
	const { name, config } = req.body || {};

	if (!config || typeof config !== 'object') {
		return res.status(400).json({
			ok: false,
			error: 'Falta una configuración de menú válida.'
		});
	}

	const settings = await updateWhatsAppMenuSettings({ workspaceId, name, config });
	const runtime = await getWhatsAppMenuRuntimeConfig({ workspaceId, forceRefresh: true });

	return res.json({
		ok: true,
		message: 'Menú actualizado correctamente.',
		settings: {
			id: settings.id,
			key: settings.key,
			name: settings.name,
			isActive: settings.isActive,
			config: settings.config
		},
		runtime: {
			mainMenuKey: runtime.mainMenuKey,
			menus: Object.values(runtime.menusByKey || {})
		}
	});
}

export async function restoreDefaultWhatsAppMenu(req, res) {
	const workspaceId = requireRequestWorkspaceId(req);
	const settings = await resetWhatsAppMenuSettings({ workspaceId });
	const runtime = await getWhatsAppMenuRuntimeConfig({ workspaceId, forceRefresh: true });

	return res.json({
		ok: true,
		message: 'Menú restaurado a la configuración por defecto.',
		settings: {
			id: settings.id,
			key: settings.key,
			name: settings.name,
			isActive: settings.isActive,
			config: settings.config
		},
		runtime: {
			mainMenuKey: runtime.mainMenuKey,
			menus: Object.values(runtime.menusByKey || {})
		}
	});
}
