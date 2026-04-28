import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import {
	ensureWorkspaceAccess,
	getWorkspaceOrThrow,
	getWorkspacePublicPayload,
	isPlatformAdmin,
	requireRequestWorkspaceId,
} from '../services/workspaces/workspace-context.service.js';

function normalizeString(value = '') {
	return String(value || '').trim();
}

function normalizeSlug(value = '') {
	return normalizeString(value)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
}

function normalizeRole(value = '') {
	const role = normalizeString(value).toUpperCase();
	return ['ADMIN', 'AGENT', 'PLATFORM_ADMIN'].includes(role) ? role : 'AGENT';
}

function normalizeCommerceProvider(value = '') {
	const provider = normalizeString(value).toUpperCase();
	return ['TIENDANUBE', 'SHOPIFY'].includes(provider) ? provider : '';
}

function normalizeShopDomain(value = '') {
	return normalizeString(value)
		.replace(/^https?:\/\//i, '')
		.replace(/\/+$/, '')
		.toLowerCase();
}

function assertPlatformAdmin(req) {
	if (!isPlatformAdmin(req.user)) {
		const error = new Error('Solo un superadmin puede realizar esta accion.');
		error.status = 403;
		throw error;
	}
}

function assertWorkspaceAdmin(req, workspaceId) {
	if (isPlatformAdmin(req.user)) return;
	if (req.user?.role !== 'ADMIN' || !ensureWorkspaceAccess(req, workspaceId)) {
		const error = new Error('No autorizado.');
		error.status = 403;
		throw error;
	}
}

function parseJsonObject(value, fallback = null) {
	if (value === undefined) return fallback;
	if (value === null || value === '') return null;
	if (typeof value === 'object' && !Array.isArray(value)) return value;

	try {
		const parsed = JSON.parse(String(value));
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
	} catch {
		return fallback;
	}
}

async function buildWorkspacePayload(workspaceId) {
	const workspace = await prisma.workspace.findUnique({
		where: { id: workspaceId },
		include: {
			branding: true,
			aiConfig: true,
			commerceConnections: {
				select: {
					id: true,
					provider: true,
					externalStoreId: true,
					shopDomain: true,
					scope: true,
					status: true,
					storeName: true,
					storeUrl: true,
					installedAt: true,
					updatedAt: true,
				},
			},
			storeInstallations: {
				select: {
					id: true,
					provider: true,
					storeId: true,
					scope: true,
					storeName: true,
					storeUrl: true,
					installedAt: true,
					updatedAt: true,
				},
			},
			whatsappChannels: {
				select: {
					id: true,
					name: true,
					wabaId: true,
					phoneNumberId: true,
					displayPhoneNumber: true,
					graphVersion: true,
					status: true,
					createdAt: true,
					updatedAt: true,
				},
				orderBy: { updatedAt: 'desc' },
			},
		},
	});

	return workspace ? getWorkspacePublicPayload(workspace) : null;
}

export async function listWorkspaces(req, res, next) {
	try {
		assertPlatformAdmin(req);

		const workspaces = await prisma.workspace.findMany({
			include: {
				branding: true,
				aiConfig: true,
				_count: {
					select: {
						users: true,
						contacts: true,
						campaigns: true,
					},
				},
			},
			orderBy: { createdAt: 'desc' },
		});

		return res.json({
			ok: true,
			workspaces: workspaces.map((workspace) => ({
				...getWorkspacePublicPayload(workspace),
				counts: workspace._count,
			})),
		});
	} catch (error) {
		next(error);
	}
}

export async function createWorkspace(req, res, next) {
	try {
		assertPlatformAdmin(req);

		const name = normalizeString(req.body?.name);
		const slug = normalizeSlug(req.body?.slug || name);

		if (!name || !slug) {
			return res.status(400).json({
				ok: false,
				error: 'Nombre y slug son obligatorios.',
			});
		}

		const workspace = await prisma.workspace.create({
			data: {
				name,
				slug,
				status: normalizeString(req.body?.status || 'ACTIVE').toUpperCase(),
				aiConfig: {
					create: {
						businessName: normalizeString(req.body?.businessName) || name,
						agentName: normalizeString(req.body?.agentName) || 'Sofi',
						tone: normalizeString(req.body?.tone) || 'humana, directa y comercial',
						systemPrompt: normalizeString(req.body?.systemPrompt) || null,
						businessContext: normalizeString(req.body?.businessContext) || null,
					},
				},
				branding: {
					create: {
						logoUrl: normalizeString(req.body?.logoUrl) || null,
						primaryColor: normalizeString(req.body?.primaryColor) || null,
						secondaryColor: normalizeString(req.body?.secondaryColor) || null,
						accentColor: normalizeString(req.body?.accentColor) || null,
					},
				},
			},
			include: {
				branding: true,
				aiConfig: true,
			},
		});

		return res.status(201).json({
			ok: true,
			workspace: getWorkspacePublicPayload(workspace),
		});
	} catch (error) {
		next(error);
	}
}

export async function getWorkspace(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req, {
			allowDefaultForPlatformAdmin: Boolean(req.params?.workspaceId),
		});
		assertWorkspaceAdmin(req, workspaceId);

		const workspace = await buildWorkspacePayload(workspaceId);
		if (!workspace) {
			return res.status(404).json({ ok: false, error: 'Workspace no encontrado.' });
		}

		return res.json({ ok: true, workspace });
	} catch (error) {
		next(error);
	}
}

export async function updateWorkspace(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		await getWorkspaceOrThrow(workspaceId);

		const updateData = {};
		if (isPlatformAdmin(req.user)) {
			if (req.body?.name !== undefined) updateData.name = normalizeString(req.body.name);
			if (req.body?.slug !== undefined) updateData.slug = normalizeSlug(req.body.slug);
			if (req.body?.status !== undefined) updateData.status = normalizeString(req.body.status).toUpperCase();
		}

		if (Object.keys(updateData).length) {
			await prisma.workspace.update({
				where: { id: workspaceId },
				data: updateData,
			});
		}

		if (req.body?.branding) {
			const branding = req.body.branding || {};
			await prisma.workspaceBranding.upsert({
				where: { workspaceId },
				update: {
					logoUrl: normalizeString(branding.logoUrl) || null,
					primaryColor: normalizeString(branding.primaryColor) || null,
					secondaryColor: normalizeString(branding.secondaryColor) || null,
					accentColor: normalizeString(branding.accentColor) || null,
				},
				create: {
					workspaceId,
					logoUrl: normalizeString(branding.logoUrl) || null,
					primaryColor: normalizeString(branding.primaryColor) || null,
					secondaryColor: normalizeString(branding.secondaryColor) || null,
					accentColor: normalizeString(branding.accentColor) || null,
				},
			});
		}

		if (req.body?.aiConfig) {
			const ai = req.body.aiConfig || {};
			await prisma.workspaceAiConfig.upsert({
				where: { workspaceId },
				update: {
					businessName: normalizeString(ai.businessName) || undefined,
					agentName: normalizeString(ai.agentName) || undefined,
					tone: normalizeString(ai.tone) || undefined,
					systemPrompt: normalizeString(ai.systemPrompt) || null,
					businessContext: normalizeString(ai.businessContext) || null,
					paymentConfig: parseJsonObject(ai.paymentConfig, null),
					policyConfig: parseJsonObject(ai.policyConfig, null),
					catalogConfig: parseJsonObject(ai.catalogConfig, null),
				},
				create: {
					workspaceId,
					businessName: normalizeString(ai.businessName) || 'Marca',
					agentName: normalizeString(ai.agentName) || 'Sofi',
					tone: normalizeString(ai.tone) || 'humana, directa y comercial',
					systemPrompt: normalizeString(ai.systemPrompt) || null,
					businessContext: normalizeString(ai.businessContext) || null,
					paymentConfig: parseJsonObject(ai.paymentConfig, null),
					policyConfig: parseJsonObject(ai.policyConfig, null),
					catalogConfig: parseJsonObject(ai.catalogConfig, null),
				},
			});
		}

		const workspace = await buildWorkspacePayload(workspaceId);
		return res.json({ ok: true, workspace });
	} catch (error) {
		next(error);
	}
}

export async function listWorkspaceUsers(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const users = await prisma.user.findMany({
			where: { workspaceId },
			select: {
				id: true,
				name: true,
				email: true,
				role: true,
				workspaceId: true,
				createdAt: true,
				updatedAt: true,
			},
			orderBy: { createdAt: 'desc' },
		});

		return res.json({ ok: true, users });
	} catch (error) {
		next(error);
	}
}

export async function createWorkspaceUser(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const name = normalizeString(req.body?.name);
		const email = normalizeString(req.body?.email).toLowerCase();
		const password = normalizeString(req.body?.password);
		const role = normalizeRole(req.body?.role);

		if (!name || !email || !password) {
			return res.status(400).json({
				ok: false,
				error: 'Nombre, email y password son obligatorios.',
			});
		}

		if (role === 'PLATFORM_ADMIN' && !isPlatformAdmin(req.user)) {
			return res.status(403).json({
				ok: false,
				error: 'Solo superadmin puede crear superadmins.',
			});
		}

		const passwordHash = await bcrypt.hash(password, 10);
		const user = await prisma.user.create({
			data: {
				name,
				email,
				passwordHash,
				role,
				workspaceId: role === 'PLATFORM_ADMIN' ? null : workspaceId,
			},
			select: {
				id: true,
				name: true,
				email: true,
				role: true,
				workspaceId: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		return res.status(201).json({ ok: true, user });
	} catch (error) {
		next(error);
	}
}

export async function updateWorkspaceUser(req, res, next) {
	try {
		const userId = normalizeString(req.params.userId);
		const user = await prisma.user.findUnique({ where: { id: userId } });

		if (!user) {
			return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });
		}

		assertWorkspaceAdmin(req, user.workspaceId || '');

		const data = {};
		if (req.body?.name !== undefined) data.name = normalizeString(req.body.name);
		if (req.body?.role !== undefined) {
			const role = normalizeRole(req.body.role);
			if (role === 'PLATFORM_ADMIN' && !isPlatformAdmin(req.user)) {
				return res.status(403).json({ ok: false, error: 'Solo superadmin puede asignar ese rol.' });
			}
			data.role = role;
			data.workspaceId = role === 'PLATFORM_ADMIN' ? null : user.workspaceId;
		}
		if (req.body?.password) {
			data.passwordHash = await bcrypt.hash(normalizeString(req.body.password), 10);
		}

		const updated = await prisma.user.update({
			where: { id: userId },
			data,
			select: {
				id: true,
				name: true,
				email: true,
				role: true,
				workspaceId: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		return res.json({ ok: true, user: updated });
	} catch (error) {
		next(error);
	}
}

export async function upsertWhatsAppChannel(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const channelId = normalizeString(req.params.channelId || req.body?.id);
		const data = {
			workspaceId,
			name: normalizeString(req.body?.name) || 'Canal principal',
			wabaId: normalizeString(req.body?.wabaId),
			phoneNumberId: normalizeString(req.body?.phoneNumberId),
			displayPhoneNumber: normalizeString(req.body?.displayPhoneNumber) || null,
			accessToken: normalizeString(req.body?.accessToken),
			verifyToken: normalizeString(req.body?.verifyToken) || null,
			graphVersion: normalizeString(req.body?.graphVersion) || null,
			status: normalizeString(req.body?.status || 'ACTIVE').toUpperCase(),
		};

		const existingChannel = channelId
			? await prisma.whatsAppChannel.findFirst({
					where: { id: channelId, workspaceId },
			  })
			: null;

		if (channelId && !existingChannel) {
			return res.status(404).json({
				ok: false,
				error: 'Canal de WhatsApp no encontrado para este workspace.',
			});
		}

		if (!data.accessToken && existingChannel?.accessToken) {
			data.accessToken = existingChannel.accessToken;
		}

		if (!data.verifyToken && existingChannel?.verifyToken) {
			data.verifyToken = existingChannel.verifyToken;
		}

		if (!data.wabaId || !data.phoneNumberId || !data.accessToken) {
			return res.status(400).json({
				ok: false,
				error: 'wabaId, phoneNumberId y accessToken son obligatorios.',
			});
		}

		if (!channelId) {
			const existingPhone = await prisma.whatsAppChannel.findUnique({
				where: { phoneNumberId: data.phoneNumberId },
				select: { workspaceId: true },
			});

			if (existingPhone?.workspaceId && existingPhone.workspaceId !== workspaceId) {
				return res.status(409).json({
					ok: false,
					error: 'Ese phoneNumberId ya esta asignado a otro workspace.',
				});
			}
		}

		const channel = channelId
			? await prisma.whatsAppChannel.update({
					where: { id: channelId },
					data,
			  })
			: await prisma.whatsAppChannel.upsert({
					where: { phoneNumberId: data.phoneNumberId },
					update: data,
					create: data,
			  });

		return res.json({
			ok: true,
			channel: {
				...channel,
				accessToken: undefined,
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function upsertCommerceConnection(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const provider = normalizeCommerceProvider(req.params.provider || req.body?.provider);
		if (!provider) {
			return res.status(400).json({
				ok: false,
				error: 'Proveedor invalido. Usa TIENDANUBE o SHOPIFY.',
			});
		}

		const shopDomain = provider === 'SHOPIFY'
			? normalizeShopDomain(req.body?.shopDomain || req.body?.externalStoreId)
			: normalizeString(req.body?.shopDomain) || null;
		const externalStoreId = normalizeString(req.body?.externalStoreId) || shopDomain;
		let accessToken = normalizeString(req.body?.accessToken);

		const existingConnection = await prisma.commerceConnection.findUnique({
			where: {
				workspaceId_provider: {
					workspaceId,
					provider,
				},
			},
			select: { accessToken: true, refreshToken: true },
		});

		if (!accessToken && existingConnection?.accessToken) {
			accessToken = existingConnection.accessToken;
		}

		if (!externalStoreId || !accessToken) {
			return res.status(400).json({
				ok: false,
				error: 'externalStoreId y accessToken son obligatorios.',
			});
		}

		const existingExternal = await prisma.commerceConnection.findUnique({
			where: {
				provider_externalStoreId: {
					provider,
					externalStoreId,
				},
			},
			select: { workspaceId: true },
		});

		if (existingExternal?.workspaceId && existingExternal.workspaceId !== workspaceId) {
			return res.status(409).json({
				ok: false,
				error: 'Esa tienda ya esta conectada a otro workspace.',
			});
		}

		const connection = await prisma.commerceConnection.upsert({
			where: {
				workspaceId_provider: {
					workspaceId,
					provider,
				},
			},
			update: {
				externalStoreId,
				shopDomain,
				accessToken,
				refreshToken: normalizeString(req.body?.refreshToken) || null,
				scope: normalizeString(req.body?.scope) || null,
				status: normalizeString(req.body?.status || 'ACTIVE').toUpperCase(),
				storeName: normalizeString(req.body?.storeName) || null,
				storeUrl: normalizeString(req.body?.storeUrl) || (shopDomain ? `https://${shopDomain}` : null),
				rawPayload: parseJsonObject(req.body?.rawPayload, {
					apiVersion: normalizeString(req.body?.apiVersion) || null,
				}),
			},
			create: {
				workspaceId,
				provider,
				externalStoreId,
				shopDomain,
				accessToken,
				refreshToken: normalizeString(req.body?.refreshToken) || null,
				scope: normalizeString(req.body?.scope) || null,
				status: normalizeString(req.body?.status || 'ACTIVE').toUpperCase(),
				storeName: normalizeString(req.body?.storeName) || null,
				storeUrl: normalizeString(req.body?.storeUrl) || (shopDomain ? `https://${shopDomain}` : null),
				rawPayload: parseJsonObject(req.body?.rawPayload, {
					apiVersion: normalizeString(req.body?.apiVersion) || null,
				}),
			},
		});

		return res.json({
			ok: true,
			connection: {
				...connection,
				accessToken: undefined,
				refreshToken: undefined,
			},
		});
	} catch (error) {
		next(error);
	}
}
