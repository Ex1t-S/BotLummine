import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
	getShopifyStatus,
	handleShopifyCallback,
	startShopifyInstall
} from '../controllers/shopify.controller.js';

const router = Router();

function resolveFrontendBaseUrl() {
	return String(
		process.env.FRONTEND_URL_PROD ||
		process.env.FRONTEND_URL ||
		process.env.PUBLIC_APP_URL ||
		process.env.APP_URL ||
		''
	).trim().replace(/\/+$/, '');
}

function requireShopifyInstallAuth(req, res, next) {
	if (req.user) return next();

	const frontendBaseUrl = resolveFrontendBaseUrl();
	if (!frontendBaseUrl) {
		return res.status(401).json({
			ok: false,
			error: 'No autenticado. Inicia la conexion desde el panel de Blade IA.'
		});
	}

	const url = new URL('/admin', `${frontendBaseUrl}/`);
	url.searchParams.set('tab', 'integrations');
	url.searchParams.set('shopify', 'error');
	url.searchParams.set('message', 'Inicia la conexion desde el panel de Blade IA para validar tu sesion.');
	return res.redirect(url.toString());
}

router.get('/callback', handleShopifyCallback);
router.get('/install', requireShopifyInstallAuth, requireAdmin, startShopifyInstall);
router.get('/status', requireShopifyInstallAuth, requireAdmin, getShopifyStatus);

export default router;
