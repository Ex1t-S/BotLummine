import { useQueries } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { fetchAbandonedCartAutomationSettings, fetchPendingPaymentAutomationSettings, fetchShipmentNotificationSettings } from '../../lib/campaigns.js';
import { automationStatus, contactWindowLabel } from '../../lib/automationStatus.js';
import { RuntimeStatus, useRuntimeStatus } from '../../components/operations/RuntimeStatus.jsx';
import { StatusBadge } from '../../components/ui/InternalPage.jsx';
import './CampaignAutomationHub.css';

const rules = [
	{ id: 'carts', title: 'Recuperación de carritos', description: 'Contactá carritos nuevos según la espera y los filtros definidos.', fetch: fetchAbandonedCartAutomationSettings, to: '/campaigns/abandoned-carts' },
	{ id: 'payments', title: 'Recordatorios de pago', description: 'Recordá completar pedidos pendientes de pago.', fetch: fetchPendingPaymentAutomationSettings, to: '/campaigns/pending-payments' },
	{ id: 'shipments', title: 'Avisos de despacho', description: 'Informá el seguimiento de los pedidos despachados.', fetch: fetchShipmentNotificationSettings, to: '/campaigns/shipments' },
];
export function CampaignAutomationHub() {
	const navigate = useNavigate();
	const { user } = useAuth();
	const runtime = useRuntimeStatus();
	const queries = useQueries({ queries: rules.map(rule => ({ queryKey: ['automation-rule', user?.workspaceId, user?.id, rule.id], queryFn: rule.fetch, staleTime: 15000, refetchInterval: 30000, retry: 1 })) });
	const runtimeData = runtime.isError ? null : runtime.data;
	return <div className="automation-hub">
		<div className="automation-hub-intro"><div><h2>Reglas automáticas</h2><p>Configurá cada regla sin crear una campaña manual.</p></div><span>{contactWindowLabel(runtimeData)}</span></div>
		<RuntimeStatus query={runtime} />
		<div className="automation-hub-table-wrap"><table className="automation-hub-table">
			<caption className="sr-only">Configuración y permisos de envío de cada automatización</caption>
			<thead><tr><th scope="col">Regla</th><th scope="col">Configuración</th><th scope="col">Estado de envío</th><th scope="col">Última ejecución</th><th scope="col">Acción</th></tr></thead>
			<tbody>{rules.map((rule, index) => {
				const query = queries[index];
				const settings = query.isError ? null : query.data?.settings ?? query.data;
				const known = typeof settings?.enabled === 'boolean';
				const status = automationStatus({ settings, failed: query.isError, loading: query.isPending, runtime: runtimeData });
				return <tr key={rule.id} aria-busy={query.isFetching}>
					<th scope="row"><strong>{rule.title}</strong><p>{rule.description}</p></th>
					<td>{known ? settings.enabled ? 'Habilitada' : 'Deshabilitada' : 'Sin verificar'}</td>
					<td><StatusBadge tone={status.tone}>{status.label}</StatusBadge></td>
					<td>{known && settings.lastRunAt ? <time dateTime={settings.lastRunAt}>{new Date(settings.lastRunAt).toLocaleString('es-AR', { timeZone: runtimeData?.timezone || 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' })}</time> : '—'}</td>
					<td>{query.isError ? <button type="button" onClick={() => query.refetch()} disabled={query.isFetching} aria-label={`Reintentar ${rule.title}`}>Reintentar</button>
						: <button type="button" disabled={!known} onClick={() => navigate(rule.to)} aria-label={`Configurar ${rule.title}`}>Configurar</button>}</td>
				</tr>;
			})}</tbody>
		</table></div>
		{queries.some(query => query.isError) ? <p role="alert">No pudimos verificar algunas reglas. Reintentá su consulta antes de modificarlas; las demás conservan su estado.</p> : null}
		<p className="automation-hub-note">Habilitar una regla no garantiza un envío: también se verifican permisos, horario, plantilla y destinatarios. Revisá las ejecuciones en Diagnóstico.</p>
	</div>;
}
