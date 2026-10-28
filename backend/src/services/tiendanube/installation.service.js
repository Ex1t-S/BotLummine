import { prisma } from '../../lib/prisma.js';
import { encryptSecret } from '../../lib/secret-crypto.js';
import { requireWorkspaceScope } from '../workspaces/workspace-scope.js';

function conflict(message) {
	const error = new Error(message);
	error.status = 409;
	error.code = 'TIENDANUBE_STORE_WORKSPACE_CONFLICT';
	return error;
}

export async function saveTiendanubeInstallation({ workspaceId, data }, { prismaClient = prisma } = {}) {
	const scope = requireWorkspaceScope(workspaceId);
	const storeId = String(data?.user_id || '').trim();
	if (!/^\d+$/.test(storeId) || !data?.access_token) throw new Error('Tiendanube no devolvió un ID de tienda y un token válidos.');
	const envStore = String(process.env.TIENDANUBE_STORE_ID || '').trim();
	if (envStore && envStore === storeId && scope !== (process.env.DEFAULT_WORKSPACE_ID || 'workspace_default')) {
		throw conflict('La tienda autorizada ya pertenece a otra marca. Iniciá sesión en Tiendanube con la cuenta de esta marca y volvé a conectar.');
	}
	return prismaClient.$transaction(async (tx) => {
		const installation = await tx.storeInstallation.findUnique({ where: { storeId } });
		const connections = await tx.commerceConnection.findMany({
			where: { provider: 'TIENDANUBE', OR: [{ externalStoreId: storeId }, { workspaceId: scope }] },
			select: { workspaceId: true, externalStoreId: true },
		});
		if ((installation?.workspaceId && installation.workspaceId !== scope) || connections.some((c) => c.workspaceId !== scope)) {
			throw conflict('La tienda autorizada ya está conectada a otra marca. Iniciá sesión en Tiendanube con la cuenta de esta marca y volvé a conectar.');
		}
		if (connections.some((c) => c.workspaceId === scope && c.externalStoreId !== storeId)) {
			throw conflict('Este workspace ya tiene otra tienda conectada. Revisá la cuenta de Tiendanube antes de reemplazar la conexión.');
		}
		const accessToken = encryptSecret(data.access_token);
		const credentials = { provider: 'TIENDANUBE', accessToken, scope: data.scope || null };
		await tx.storeInstallation.upsert({
			where: { storeId },
			update: { ...credentials, workspaceId: scope },
			create: { workspaceId: scope, storeId, ...credentials },
		});
		const connectionData = { externalStoreId: storeId, accessToken, scope: data.scope || null, status: 'ACTIVE', rawPayload: { source: 'oauth-callback', userId: storeId, scope: data.scope || null } };
		return tx.commerceConnection.upsert({
			where: { workspaceId_provider: { workspaceId: scope, provider: 'TIENDANUBE' } },
			update: connectionData,
			create: { workspaceId: scope, provider: 'TIENDANUBE', ...connectionData },
		});
	}, { isolationLevel: 'Serializable' });
}
