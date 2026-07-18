import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, Eye, MessageCircle, RefreshCw, ShoppingCart, Send } from 'lucide-react';
import api from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ActionButton, EmptyState, PageHeader } from '../components/ui/InternalPage.jsx';
import { useInternalDarkOverrides } from '../hooks/useInternalDarkOverrides.js';
import { formatCampaignStatusLabel } from '../utils/statusLabels.js';
import './AnalyticsPage.css';

function number(value) {
	return new Intl.NumberFormat('es-AR').format(Number(value || 0));
}

function currency(value, code = 'ARS') {
	return new Intl.NumberFormat('es-AR', {
		style: 'currency',
		currency: code || 'ARS',
		maximumFractionDigits: 0,
	}).format(Number(value || 0));
}

function percent(value) {
	return `${Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`;
}

function date(value) {
	if (!value) return 'Sin actividad';
	return new Date(value).toLocaleString('es-AR', {
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	});
}

function ratio(part, total) {
	return total > 0 ? (Number(part || 0) / Number(total)) * 100 : 0;
}

function AnalyticsMetric({ label, value, helper, tone = 'neutral' }) {
	return (
		<div className={`analytics-v2-metric tone-${tone}`.trim()}>
			<span>{label}</span>
			<strong>{value}</strong>
			<small>{helper}</small>
		</div>
	);
}

function ProgressRow({ icon: Icon, label, value, total, helper }) {
	const width = Math.min(100, Math.max(0, ratio(value, total)));
	return (
		<div className="analytics-v2-progress-row">
			<div className="analytics-v2-progress-icon" aria-hidden="true"><Icon size={17} /></div>
			<div>
				<div className="analytics-v2-progress-label">
					<span>{label}</span>
					<strong>{number(value)}</strong>
				</div>
				<div className="analytics-v2-progress-track" aria-label={`${label}: ${percent(width)}`}>
					<span style={{ width: `${width}%` }} />
				</div>
				<small>{helper}</small>
			</div>
		</div>
	);
}

function CampaignTable({ campaigns }) {
	return (
		<div className="analytics-v2-table-wrap">
			<table className="analytics-v2-table" aria-label="Rendimiento de campañas recientes">
				<thead><tr><th>Campaña</th><th>Estado</th><th>Enviados</th><th>Leídos</th><th>Fallidos</th><th>Inicio</th></tr></thead>
				<tbody>
					{campaigns.map((campaign) => (
						<tr key={campaign.id}>
							<td><strong>{campaign.name}</strong><span>{campaign.templateName || 'Sin plantilla'}</span></td>
							<td><span className={`analytics-v2-status status-${String(campaign.status || '').toLowerCase()}`}>{formatCampaignStatusLabel(campaign.status)}</span></td>
							<td>{number(campaign.sentRecipients ?? campaign.sentCount)}</td>
							<td>{number(campaign.readRecipients ?? campaign.readCount)}</td>
							<td>{number(campaign.failedRecipients ?? campaign.failedCount)}</td>
							<td>{date(campaign.startedAt || campaign.createdAt)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export default function AnalyticsPage() {
	useInternalDarkOverrides();
	const { user } = useAuth();
	const workspaceId = user?.workspaceId || user?.workspace?.id || '';
	const analyticsQuery = useQuery({
		queryKey: ['admin', 'analytics', 'brand', workspaceId],
		queryFn: async () => {
			const response = await api.get('/admin/analytics/workspaces', {
				params: workspaceId ? { workspaceId } : {},
			});
			return response.data || {};
		},
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});

	const data = analyticsQuery.data || {};
	const selected = useMemo(() => {
		const workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
		return workspaces.find((item) => item?.workspace?.id === workspaceId) || workspaces[0] || null;
	}, [data.workspaces, workspaceId]);
	const metrics = selected?.metrics || data.totals || {};
	const detail = data.detail || {};
	const campaigns = Array.isArray(detail.campaigns) ? detail.campaigns : [];
	const sent = Number(metrics.sentRecipientsCount || 0);
	const delivered = Number(metrics.deliveredRecipientsCount || 0);
	const read = Number(metrics.readRecipientsCount || 0);
	const failed = Number(metrics.failedRecipientsCount || 0);
	const deliveryRate = ratio(delivered, sent);
	const readRate = ratio(read, delivered);
	const totalMessages = Number(metrics.messages30dInbound || 0) + Number(metrics.messages30dOutbound || 0);
	const hasMetrics = Boolean(selected || Object.keys(data.totals || {}).length);

	return (
		<section className="analytics-v2-page">
			<PageHeader
				eyebrow="Rendimiento operativo"
				title="Estadísticas"
				description={`Señales para decidir sobre atención, campañas y recuperación durante los últimos ${number(data.activityWindowDays || 30)} días.`}
			>
				<ActionButton variant="secondary" icon={RefreshCw} disabled={analyticsQuery.isFetching} onClick={() => analyticsQuery.refetch()}>
					{analyticsQuery.isFetching ? 'Actualizando' : 'Actualizar'}
				</ActionButton>
			</PageHeader>

			{analyticsQuery.isLoading ? (
				<EmptyState tone="loading" title="Cargando estadísticas" description="Calculando actividad, entregas y resultados." />
			) : analyticsQuery.isError ? (
				<EmptyState tone="error" title="No pudimos cargar las estadísticas" description={analyticsQuery.error?.response?.data?.error || analyticsQuery.error?.message || 'Reintentá en unos segundos.'}>
					<ActionButton variant="secondary" onClick={() => analyticsQuery.refetch()}>Reintentar</ActionButton>
				</EmptyState>
			) : !hasMetrics ? (
				<EmptyState title="Todavía no hay actividad para analizar" description="Las métricas aparecerán cuando existan conversaciones, campañas o carritos recuperados." />
			) : (
				<>
					<div className="analytics-v2-metrics" aria-label="Indicadores principales">
						<AnalyticsMetric label="Conversaciones activas" value={number(metrics.activeConversations30d)} helper={`${number(metrics.unreadMessagesCount)} mensajes requieren lectura`} tone={metrics.unreadMessagesCount ? 'warning' : 'neutral'} />
						<AnalyticsMetric label="Entrega de campañas" value={percent(deliveryRate)} helper={`${number(delivered)} de ${number(sent)} mensajes enviados`} tone={deliveryRate >= 90 ? 'success' : 'warning'} />
						<AnalyticsMetric label="Lectura efectiva" value={percent(readRate)} helper={`${number(read)} mensajes leídos`} />
						<AnalyticsMetric label="Carritos recuperados" value={number(metrics.recoveredCartsCount)} helper={currency(metrics.recoveredCartValue, metrics.currency || 'ARS')} tone="success" />
					</div>

					<div className="analytics-v2-overview">
						<section className="analytics-v2-section" aria-labelledby="analytics-delivery-title">
							<div className="analytics-v2-section-head">
								<div><span>Campañas</span><h3 id="analytics-delivery-title">Embudo de entrega</h3></div>
								<small>{number(failed)} fallidos</small>
							</div>
							<div className="analytics-v2-progress-list">
								<ProgressRow icon={Send} label="Enviados" value={sent} total={sent} helper="Base de comparación" />
								<ProgressRow icon={ArrowDownToLine} label="Entregados" value={delivered} total={sent} helper={`${percent(deliveryRate)} de los enviados`} />
								<ProgressRow icon={Eye} label="Leídos" value={read} total={sent} helper={`${percent(readRate)} de los entregados`} />
							</div>
						</section>

						<section className="analytics-v2-section" aria-labelledby="analytics-activity-title">
							<div className="analytics-v2-section-head">
								<div><span>Atención y ventas</span><h3 id="analytics-activity-title">Actividad que requiere contexto</h3></div>
							</div>
							<dl className="analytics-v2-facts">
								<div><dt><MessageCircle size={16} aria-hidden="true" /> Mensajes 30d</dt><dd>{number(totalMessages)}</dd><small>{number(metrics.messages30dInbound)} recibidos · {number(metrics.messages30dOutbound)} enviados</small></div>
								<div><dt><ShoppingCart size={16} aria-hidden="true" /> Recuperación</dt><dd>{currency(metrics.recoveredCartValue, metrics.currency || 'ARS')}</dd><small>{number(metrics.recoveredCartsCount)} carritos con recuperación atribuida</small></div>
								<div><dt><Eye size={16} aria-hidden="true" /> Conversiones</dt><dd>{number(metrics.conversionCount)}</dd><small>Ventas y carritos con señal atribuida</small></div>
							</dl>
						</section>
					</div>

					<section className="analytics-v2-section analytics-v2-section--table" aria-labelledby="analytics-campaigns-title">
						<div className="analytics-v2-section-head">
							<div><span>Detalle</span><h3 id="analytics-campaigns-title">Campañas recientes</h3></div>
							<small>Hasta 8 campañas</small>
						</div>
						{campaigns.length ? <CampaignTable campaigns={campaigns} /> : <p className="analytics-v2-inline-empty">No hay campañas recientes para esta marca.</p>}
					</section>
				</>
			)}
		</section>
	);
}
