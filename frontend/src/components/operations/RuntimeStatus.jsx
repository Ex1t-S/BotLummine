import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { runtimePresentation } from '../../lib/automationStatus.js';
import './RuntimeStatus.css';

export function useRuntimeStatus(enabled = true) {
	const { user } = useAuth();
	return useQuery({ queryKey: ['workspace-runtime-status', user?.workspaceId, user?.id], queryFn: async () => (await api.get('/dashboard/runtime-status')).data,
		enabled: enabled && Boolean(user), staleTime: 10000, refetchInterval: 15000, retry: 1 });
}
export function RuntimeStatus({ query }) {
	const state = runtimePresentation(query.isError ? null : query.data);
	return <section className={`runtime-status tone-${state.tone}`} role="status" aria-live="polite">
		<div><strong>{query.isPending ? 'Verificando permisos de envío' : state.title}</strong><p>{state.detail}</p></div>
		{query.isError ? <button type="button" onClick={() => query.refetch()} disabled={query.isFetching}>Reintentar estado</button>
			: query.data?.updatedAt ? <small>Verificado {new Date(query.data.updatedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</small> : null}
	</section>;
}
