import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import {
	ArrowRight,
	BarChart3,
	CheckCircle2,
	CircleDot,
	LayoutDashboard,
	Megaphone,
	Plus,
	RefreshCw,
	Settings2,
	ShoppingCart,
	Sparkles,
	Truck,
	Users,
	WalletCards,
	Workflow,
} from 'lucide-react';
import api from '../../lib/api.js';
import {
	fetchAbandonedCartAutomationSettings,
	fetchCampaignOverview,
	fetchCampaigns,
	fetchPendingPaymentAutomationSettings,
	fetchShipmentNotificationSettings,
	fetchTemplates,
} from '../../lib/campaigns.js';
import { ActionButton, EmptyState } from '../../components/ui/InternalPage.jsx';
import './CampaignCommandCenter.css';

const NAV_ITEMS = [
	{ id: 'overview', to: '/campaigns', label: 'Resumen', icon: LayoutDashboard, exact: true },
	{ id: 'create', to: '/campaigns/segment', label: 'Crear', icon: Plus },
	{ id: 'audiences', to: '/campaigns/audiences', label: 'Audiencias', icon: Users },
	{ id: 'automations', to: '/campaigns/automations', label: 'Automatizaciones', icon: Workflow, paths: ['/campaigns/automations', '/campaigns/abandoned-carts', '/campaigns/pending-payments', '/campaigns/shipments', '/campaigns/schedules'] },
	{ id: 'templates', to: '/campaigns/library', label: 'Plantillas', icon: Sparkles, paths: ['/campaigns/library', '/campaigns/builder'] },
	{ id: 'results', to: '/campaigns/results', label: 'Resultados', icon: BarChart3, paths: ['/campaigns/results', '/campaigns/tracking'] },
];

function getCollection(data, keys = []) {
	if (Array.isArray(data)) return data;
	for (const key of keys) {
		if (Array.isArray(data?.[key])) return data[key];
	}
	return [];
}

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
	if (!value) return 'Sin fecha';
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return 'Sin fecha';
	return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(parsed);
}

function statusMeta(status = '') {
	const value = String(status || 'DRAFT').toUpperCase();
	if (['RUNNING', 'QUEUED'].includes(value)) return { label: 'En curso', tone: 'running' };
	if (['FINISHED', 'COMPLETED'].includes(value)) return { label: 'Finalizada', tone: 'finished' };
	if (['FAILED', 'PARTIAL'].includes(value)) return { label: 'Requiere atención', tone: 'attention' };
	if (value === 'CANCELLED') return { label: 'Cancelada', tone: 'muted' };
	return { label: 'Borrador', tone: 'draft' };
}

function audienceLabel(source = '') {
	const value = String(source || '').toLowerCase();
	if (value.includes('cart')) return 'Carritos recuperables';
	if (value.includes('customer')) return 'Clientes';
	if (value.includes('manual')) return 'Lista manual';
	return 'Segmento personalizado';
}

function nextCampaignAction(campaign = {}) {
	const status = String(campaign.status || '').toUpperCase();
	if (status === 'DRAFT') return { label: 'Completar', to: `/campaigns/segment?draft=${campaign.id}` };
	if (['RUNNING', 'QUEUED'].includes(status)) return { label: 'Monitorear', to: `/campaigns/tracking?campaign=${campaign.id}` };
	if (['FAILED', 'PARTIAL'].includes(status)) return { label: 'Resolver', to: `/campaigns/tracking?campaign=${campaign.id}` };
	return { label: 'Ver resultados', to: `/campaigns/results?campaign=${campaign.id}` };
}

function CampaignMetric({ label, value, helper, tone = 'neutral' }) {
	return (
		<div className={`campaign-os-metric tone-${tone}`}>
			<span>{label}</span>
			<strong>{value}</strong>
			<small>{helper}</small>
		</div>
	);
}

export function CampaignOsLayout({ pathname, children }) {
	const navigate = useNavigate();
	return (
		<section className="campaign-os">
			<header className="campaign-os-header">
				<div>
					<span className="campaign-os-eyebrow">Campañas Lummine</span>
					<h1>Centro de campañas</h1>
					<p>Planificá, lanzá y medí campañas sin perderte entre configuraciones.</p>
				</div>
				{!pathname.startsWith('/campaigns/segment') ? (
					<ActionButton icon={Plus} onClick={() => navigate('/campaigns/segment')}>Nueva campaña</ActionButton>
				) : null}
			</header>

			<nav className="campaign-os-nav" aria-label="Navegación de campañas">
				{NAV_ITEMS.map((item) => {
					const Icon = item.icon;
					const active = item.exact
						? pathname === item.to
						: (item.paths || [item.to]).some((path) => pathname.startsWith(path));
					return (
						<NavLink key={item.id} to={item.to} className={`campaign-os-nav-link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
							<Icon size={16} strokeWidth={2.1} aria-hidden="true" />
							<span>{item.label}</span>
						</NavLink>
					);
				})}
			</nav>

			<div className="campaign-os-content">{children}</div>
		</section>
	);
}

export function CampaignOverview() {
	const navigate = useNavigate();
	const overviewQuery = useQuery({
		queryKey: ['campaign-os', 'overview'],
		queryFn: async () => {
			const [campaignData, templateData, statsData] = await Promise.all([
				fetchCampaigns({ page: 1, pageSize: 12 }),
				fetchTemplates(),
				fetchCampaignOverview(),
			]);
			return { campaignData, templateData, statsData };
		},
		staleTime: 30_000,
	});

	if (overviewQuery.isLoading) {
		return <EmptyState tone="loading" title="Preparando el centro de campañas" description="Ordenando campañas, resultados y próximos pasos." />;
	}

	if (overviewQuery.isError) {
		return (
			<EmptyState tone="error" title="No pudimos cargar las campañas" description="Reintentá para recuperar el estado y las métricas.">
				<ActionButton variant="secondary" icon={RefreshCw} onClick={() => overviewQuery.refetch()}>Reintentar</ActionButton>
			</EmptyState>
		);
	}

	const campaigns = getCollection(overviewQuery.data?.campaignData, ['campaigns', 'items']);
	const templates = getCollection(overviewQuery.data?.templateData, ['templates', 'items']);
	const stats = overviewQuery.data?.statsData?.stats || overviewQuery.data?.statsData || {};
	const active = campaigns.filter((item) => ['RUNNING', 'QUEUED'].includes(String(item.status || '').toUpperCase())).length;
	const attention = campaigns.filter((item) => ['DRAFT', 'FAILED', 'PARTIAL'].includes(String(item.status || '').toUpperCase())).length;
	const sent = campaigns.reduce((total, item) => total + Number(item.sentCount || 0), 0);
	const delivered = campaigns.reduce((total, item) => total + Number(item.deliveredCount || 0), 0);
	const deliveryRate = sent ? (delivered / sent) * 100 : 0;
	const approvedTemplates = templates.filter((item) => String(item.status || '').toUpperCase() === 'APPROVED').length;
	const nextAttention = campaigns.find((item) => ['FAILED', 'PARTIAL', 'DRAFT'].includes(String(item.status || '').toUpperCase()));

	return (
		<div className="campaign-os-overview">
			<div className="campaign-os-intro">
				<div><span>Estado de hoy</span><h2>Campañas que están moviendo el negocio</h2><p>Primero el estado y la próxima decisión; después, las métricas.</p></div>
				<button type="button" onClick={() => overviewQuery.refetch()} disabled={overviewQuery.isFetching}><RefreshCw size={16} aria-hidden="true" />{overviewQuery.isFetching ? 'Actualizando' : 'Actualizar'}</button>
			</div>

			<div className="campaign-os-metrics" aria-label="Indicadores principales de campañas">
				<CampaignMetric label="En curso" value={number(active)} helper="Campañas enviando ahora" tone="primary" />
				<CampaignMetric label="Entrega" value={percent(deliveryRate)} helper={`${number(delivered)} mensajes entregados`} tone={deliveryRate >= 90 ? 'success' : 'warning'} />
				<CampaignMetric label="Requieren acción" value={number(attention)} helper="Borradores o campañas con error" tone={attention ? 'warning' : 'success'} />
				<CampaignMetric label="Ingresos atribuidos" value={currency(stats.attributedRevenue, stats.attributedCurrency || 'ARS')} helper={`${number(stats.purchasedRecipients)} compras con señal`} />
			</div>

			<div className="campaign-os-dashboard-grid">
				<section className="campaign-os-list" aria-labelledby="campaign-os-active-title">
					<div className="campaign-os-section-head"><div><span>Portafolio</span><h3 id="campaign-os-active-title">Campañas recientes</h3></div><button type="button" onClick={() => navigate('/campaigns/results')}>Ver todas</button></div>
					{campaigns.length ? campaigns.slice(0, 6).map((campaign) => {
						const status = statusMeta(campaign.status);
						const action = nextCampaignAction(campaign);
						const progress = Number(campaign.totalRecipients || 0) ? (Number(campaign.sentCount || 0) / Number(campaign.totalRecipients || 1)) * 100 : 0;
						return (
							<article className="campaign-os-row" key={campaign.id}>
								<div className="campaign-os-row-main"><strong>{campaign.name || 'Campaña sin nombre'}</strong><span>{audienceLabel(campaign.audienceSource)} · {number(campaign.totalRecipients)} destinatarios</span></div>
								<span className={`campaign-os-status tone-${status.tone}`}><CircleDot size={12} aria-hidden="true" />{status.label}</span>
								<div className="campaign-os-progress"><span><i style={{ width: `${Math.min(100, progress)}%` }} /></span><small>{percent(progress)}</small></div>
								<button type="button" className="campaign-os-row-action" onClick={() => navigate(action.to)}>{action.label}<ArrowRight size={15} aria-hidden="true" /></button>
							</article>
						);
					}) : <div className="campaign-os-empty"><Megaphone size={20} aria-hidden="true" /><div><strong>Todavía no hay campañas</strong><span>Creá la primera para empezar a medir resultados.</span></div></div>}
				</section>

				<aside className="campaign-os-next" aria-labelledby="campaign-os-next-title">
					<span>Próximo desbloqueo</span>
					<h3 id="campaign-os-next-title">{nextAttention ? nextAttention.name : 'Todo está encaminado'}</h3>
					<p>{nextAttention ? 'Completá el borrador o resolvé el bloqueo para avanzar.' : 'No hay borradores ni errores pendientes.'}</p>
					{nextAttention ? <ActionButton icon={ArrowRight} onClick={() => navigate(nextCampaignAction(nextAttention).to)}>{nextCampaignAction(nextAttention).label}</ActionButton> : <div className="campaign-os-all-clear"><CheckCircle2 size={18} aria-hidden="true" />Sin tareas pendientes</div>}
					<div className="campaign-os-ready"><span>Plantillas listas</span><strong>{approvedTemplates}/{templates.length}</strong><small>Aprobadas para usar</small></div>
				</aside>
			</div>
		</div>
	);
}

export function CampaignAudienceStudio() {
	const navigate = useNavigate();
	const audienceQuery = useQuery({
		queryKey: ['campaign-os', 'audiences'],
		queryFn: async () => {
			const [customersResponse, cartsResponse] = await Promise.all([
				api.get('/dashboard/customers', { params: { page: 1, pageSize: 1 } }),
				api.get('/dashboard/abandoned-carts', { params: { page: 1, pageSize: 100 } }),
			]);
			return { customers: customersResponse.data || {}, carts: cartsResponse.data || {} };
		},
		staleTime: 30_000,
	});

	const customerItems = getCollection(audienceQuery.data?.customers, ['customers', 'items']);
	const cartItems = getCollection(audienceQuery.data?.carts, ['carts', 'items']);
	const customerTotal = Number(audienceQuery.data?.customers?.pagination?.total || audienceQuery.data?.customers?.pagination?.totalItems || customerItems.length);
	const recoverableCarts = cartItems.filter((item) => String(item.status || '').toUpperCase() === 'NEW').length;
	const recipes = [
		{ id: 'customers', eyebrow: 'Base de clientes', title: 'Clientes con historial', description: 'Filtrá por compra, producto, gasto o fecha de última orden.', count: audienceQuery.isLoading ? '—' : number(customerTotal), countLabel: 'clientes disponibles', action: 'Usar esta audiencia' },
		{ id: 'abandoned_carts', eyebrow: 'Recuperación', title: 'Carritos con intención', description: 'Trabajá sobre oportunidades nuevas según antigüedad, importe y producto.', count: audienceQuery.isLoading ? '—' : number(recoverableCarts), countLabel: 'carritos recuperables', action: 'Crear recuperación' },
		{ id: 'manual', eyebrow: 'Lista propia', title: 'Carga manual controlada', description: 'Pegá una lista puntual cuando el segmento no existe en la plataforma.', count: 'CSV', countLabel: 'o lista copiada', action: 'Cargar destinatarios' },
	];

	return (
		<div className="campaign-os-audiences">
			<div className="campaign-os-intro"><div><span>Audiencias</span><h2>Elegí primero a quién querés contactar</h2><p>Tres caminos claros. Los filtros avanzados aparecen después de elegir el objetivo.</p></div></div>
			{audienceQuery.isError ? <div className="campaign-os-inline-error" role="alert">No pudimos calcular los tamaños. Podés continuar y reintentar dentro del creador.</div> : null}
			<div className="campaign-os-recipe-list">
				{recipes.map((recipe, index) => (
					<article className="campaign-os-recipe" key={recipe.id}>
						<span className="campaign-os-recipe-number">0{index + 1}</span>
						<div className="campaign-os-recipe-copy"><span>{recipe.eyebrow}</span><h3>{recipe.title}</h3><p>{recipe.description}</p></div>
						<div className="campaign-os-recipe-count"><strong>{recipe.count}</strong><span>{recipe.countLabel}</span></div>
						<button type="button" onClick={() => navigate(`/campaigns/segment?audience=${recipe.id}`)}>{recipe.action}<ArrowRight size={15} aria-hidden="true" /></button>
					</article>
				))}
			</div>
			<div className="campaign-os-audience-note"><strong>La audiencia no se guarda a ciegas.</strong><span>Antes de crear la campaña vas a ver el total, una muestra de destinatarios y cualquier dato faltante.</span></div>
		</div>
	);
}

export function CampaignAutomationHub() {
	const navigate = useNavigate();
	const automationQuery = useQuery({
		queryKey: ['campaign-os', 'automations'],
		queryFn: async () => {
			const [carts, payments, shipments] = await Promise.all([
				fetchAbandonedCartAutomationSettings(),
				fetchPendingPaymentAutomationSettings(),
				fetchShipmentNotificationSettings(),
			]);
			return { carts, payments, shipments };
		},
		staleTime: 30_000,
	});

	const rows = [
		{
			id: 'carts',
			icon: ShoppingCart,
			title: 'Recuperación de carritos',
			description: 'Detecta oportunidades nuevas y prepara el contacto con una regla controlada.',
			settings: automationQuery.data?.carts?.settings || automationQuery.data?.carts || {},
			to: '/campaigns/abandoned-carts',
		},
		{
			id: 'payments',
			icon: WalletCards,
			title: 'Recordatorio de pedidos pendientes',
			description: 'Recuerda completar el pago sin mezclar la revisión humana de comprobantes.',
			settings: automationQuery.data?.payments?.settings || automationQuery.data?.payments || {},
			to: '/campaigns/pending-payments',
		},
		{
			id: 'shipments',
			icon: Truck,
			title: 'Avisos de despacho',
			description: 'Informa el seguimiento cuando el pedido está listo para salir.',
			settings: automationQuery.data?.shipments?.settings || automationQuery.data?.shipments || {},
			to: '/campaigns/shipments',
		},
	];
	const activeCount = rows.filter((row) => Boolean(row.settings?.enabled)).length;
	const errorCount = rows.filter((row) => Boolean(row.settings?.lastError)).length;

	return (
		<div className="campaign-os-automations">
			<div className="campaign-os-intro">
				<div><span>Centro de control</span><h2>Automatizaciones con propósito claro</h2><p>Revisá el estado primero. Entrá a configurar sólo la regla que necesita cambios.</p></div>
				<div className="campaign-os-inline-totals" aria-label="Resumen de automatizaciones"><span><strong>{number(activeCount)}</strong> activas</span><span className={errorCount ? 'has-error' : ''}><strong>{number(errorCount)}</strong> con error</span></div>
			</div>
			{automationQuery.isError ? <div className="campaign-os-inline-error" role="alert">No pudimos leer todas las reglas. Reintentá antes de modificar una automatización.</div> : null}
			<div className="campaign-os-automation-list">
				{rows.map((row) => {
					const Icon = row.icon;
					const enabled = Boolean(row.settings?.enabled);
					const hasError = Boolean(row.settings?.lastError);
					return (
						<article className="campaign-os-automation-row" key={row.id}>
							<span className="campaign-os-automation-icon"><Icon size={19} aria-hidden="true" /></span>
							<div><span>{hasError ? 'Requiere atención' : enabled ? 'Activa' : 'Pausada'}</span><h3>{row.title}</h3><p>{row.description}</p></div>
							<strong className={`campaign-os-automation-state ${hasError ? 'has-error' : enabled ? 'is-active' : ''}`}>{hasError ? 'Error' : enabled ? 'Funcionando' : 'Pausada'}</strong>
							<button type="button" onClick={() => navigate(row.to)}><Settings2 size={15} aria-hidden="true" />Configurar</button>
						</article>
					);
				})}
			</div>
			<div className="campaign-os-audience-note"><strong>Configura con contexto.</strong><span>Cada regla conserva su editor completo, pero la complejidad queda detrás de una decisión explícita.</span></div>
		</div>
	);
}

export function CampaignResultsHub() {
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const resultsQuery = useQuery({
		queryKey: ['campaign-os', 'results'],
		queryFn: async () => {
			const [campaignData, statsData] = await Promise.all([
				fetchCampaigns({ limit: 100 }),
				fetchCampaignOverview(),
			]);
			return { campaignData, statsData };
		},
		staleTime: 30_000,
	});

	const campaigns = getCollection(resultsQuery.data?.campaignData, ['campaigns', 'items']);
	const withActivity = campaigns.filter((campaign) => Number(campaign.sentCount || campaign.sentRecipients || 0) > 0);
	const requestedCampaignId = searchParams.get('campaign');
	const selectedCampaign = campaigns.find((campaign) => campaign.id === requestedCampaignId)
		|| withActivity[0]
		|| campaigns[0]
		|| null;

	useEffect(() => {
		if (!selectedCampaign?.id || requestedCampaignId === selectedCampaign.id) return;
		setSearchParams({ campaign: selectedCampaign.id }, { replace: true });
	}, [requestedCampaignId, selectedCampaign?.id, setSearchParams]);

	if (resultsQuery.isLoading) return <EmptyState tone="loading" title="Preparando resultados" description="Consolidando entrega, respuesta y compras atribuidas." />;
	if (resultsQuery.isError) return <EmptyState tone="error" title="No pudimos cargar los resultados" description="Reintentá para volver a calcular la lectura operativa."><ActionButton variant="secondary" icon={RefreshCw} onClick={() => resultsQuery.refetch()}>Reintentar</ActionButton></EmptyState>;

	const totals = withActivity.reduce((acc, campaign) => {
		acc.sent += Number(campaign.sentCount || 0);
		acc.delivered += Number(campaign.deliveredCount || 0);
		acc.replied += Number(campaign.analytics?.repliedRecipients || 0);
		acc.purchased += Number(campaign.analytics?.purchasedRecipients || 0);
		acc.revenue += Number(campaign.analytics?.attributedRevenue || 0);
		return acc;
	}, { sent: 0, delivered: 0, replied: 0, purchased: 0, revenue: 0 });
	const stats = resultsQuery.data?.statsData?.stats || resultsQuery.data?.statsData || {};
	const revenue = totals.revenue || Number(stats.attributedRevenue || 0);
	const selectedAnalytics = selectedCampaign?.analytics || {};
	const selectedSent = Number(selectedCampaign?.sentCount || selectedCampaign?.sentRecipients || 0);
	const selectedDelivered = Number(selectedCampaign?.deliveredCount || selectedCampaign?.deliveredRecipients || 0);
	const selectedStatus = statusMeta(selectedCampaign?.status);
	const selectedAction = selectedCampaign ? nextCampaignAction(selectedCampaign) : null;
	const selectedHasActivity = selectedSent > 0;

	function selectCampaign(campaignId) {
		setSearchParams({ campaign: campaignId });
	}

	return (
		<div className="campaign-os-results">
			<div className="campaign-os-intro campaign-os-intro--results">
				<div><span>Resultados</span><h2>Qué funcionó y qué necesita atención</h2><p>Elegí una campaña para entender su rendimiento y abrir el seguimiento sólo cuando necesites investigar destinatarios.</p></div>
				<button type="button" onClick={() => resultsQuery.refetch()} disabled={resultsQuery.isFetching}><RefreshCw size={16} aria-hidden="true" />{resultsQuery.isFetching ? 'Actualizando' : 'Actualizar'}</button>
			</div>
			<div className="campaign-os-result-summary" aria-label="Resumen general de resultados">
				<div><span>Entrega general</span><strong>{percent(totals.sent ? totals.delivered / totals.sent * 100 : 0)}</strong><small>{number(totals.delivered)} de {number(totals.sent)} enviados</small></div>
				<div><span>Conversaciones</span><strong>{number(totals.replied)}</strong><small>{percent(totals.sent ? totals.replied / totals.sent * 100 : 0)} respondió</small></div>
				<div><span>Compras atribuidas</span><strong>{number(totals.purchased || stats.purchasedRecipients)}</strong><small>{currency(revenue, stats.attributedCurrency || 'ARS')} en señales</small></div>
			</div>

			<div className="campaign-os-results-workspace">
			<section className="campaign-os-results-list" aria-labelledby="campaign-results-title">
				<div className="campaign-os-section-head"><div><span>Historial</span><h3 id="campaign-results-title">Campañas</h3></div><small>{number(campaigns.length)} en total</small></div>
				{campaigns.length ? campaigns.map((campaign) => {
					const analytics = campaign.analytics || {};
					const sent = Number(campaign.sentCount || campaign.sentRecipients || 0);
					const delivered = Number(campaign.deliveredCount || campaign.deliveredRecipients || 0);
					const delivery = sent ? delivered / sent * 100 : 0;
					const status = statusMeta(campaign.status);
					const isSelected = campaign.id === selectedCampaign?.id;
					return (
						<button type="button" className={`campaign-os-result-item${isSelected ? ' is-selected' : ''}`} key={campaign.id} onClick={() => selectCampaign(campaign.id)} aria-pressed={isSelected}>
							<span className="campaign-os-result-item__main"><strong>{campaign.name || 'Campaña sin nombre'}</strong><small>{audienceLabel(campaign.audienceSource)} · {date(campaign.createdAt)}</small></span>
							<span className={`campaign-os-result-item__status tone-${status.tone}`}>{status.label}</span>
							<span className="campaign-os-result-item__metric"><small>Entrega</small><strong>{sent ? percent(delivery) : '—'}</strong></span>
							<span className="campaign-os-result-item__metric"><small>Respuestas</small><strong>{sent ? number(analytics.repliedRecipients) : '—'}</strong></span>
							<ArrowRight className="campaign-os-result-item__arrow" size={16} aria-hidden="true" />
						</button>
					);
				}) : <div className="campaign-os-empty"><BarChart3 size={20} aria-hidden="true" /><div><strong>Todavía no hay campañas</strong><span>Cuando crees la primera, vas a ver acá su estado aunque todavía no tenga envíos.</span></div></div>}
			</section>

			<aside className="campaign-os-result-detail" aria-live="polite" aria-labelledby="campaign-result-detail-title">
				{selectedCampaign ? <>
					<div className="campaign-os-result-detail__header">
						<div><span className={`campaign-os-result-item__status tone-${selectedStatus.tone}`}>{selectedStatus.label}</span><h3 id="campaign-result-detail-title">{selectedCampaign.name || 'Campaña sin nombre'}</h3><p>{selectedCampaign.templateName || 'Sin plantilla asociada'} · {audienceLabel(selectedCampaign.audienceSource)}</p></div>
						<small>{date(selectedCampaign.finishedAt || selectedCampaign.startedAt || selectedCampaign.createdAt)}</small>
					</div>
					{selectedHasActivity ? <>
						<div className="campaign-os-result-detail__metrics">
							<div><span>Entrega</span><strong>{percent(selectedSent ? selectedDelivered / selectedSent * 100 : 0)}</strong><small>{number(selectedDelivered)} entregados</small></div>
							<div><span>Respuestas</span><strong>{number(selectedAnalytics.repliedRecipients)}</strong><small>{percent(Number(selectedAnalytics.replyRate || 0) * 100)} del envío</small></div>
							<div><span>Compras</span><strong>{number(selectedAnalytics.purchasedRecipients)}</strong><small>{percent(Number(selectedAnalytics.purchaseRate || 0) * 100)} atribuido</small></div>
						</div>
						<div className="campaign-os-result-detail__revenue"><span>Ingresos atribuidos</span><strong>{currency(selectedAnalytics.attributedRevenue, selectedAnalytics.attributedCurrency || 'ARS')}</strong><small>Señal operativa; no reemplaza la conciliación contable.</small></div>
					</> : <div className="campaign-os-result-detail__empty"><strong>Esta campaña todavía no tiene envíos.</strong><span>Podés completar el borrador o revisar su preparación antes de lanzarla.</span></div>}
					<div className="campaign-os-result-detail__actions">
						{!selectedAction.to.startsWith('/campaigns/results') ? <button type="button" className="campaign-os-result-detail__primary" onClick={() => navigate(selectedAction.to)}>{selectedAction.label}<ArrowRight size={15} aria-hidden="true" /></button> : null}
						{selectedHasActivity ? <button type="button" onClick={() => navigate(`/campaigns/tracking?campaign=${selectedCampaign.id}`)}>Ver destinatarios</button> : null}
					</div>
				</> : <div className="campaign-os-empty"><BarChart3 size={20} aria-hidden="true" /><div><strong>Elegí una campaña</strong><span>Vas a ver su lectura operativa en este panel.</span></div></div>}
			</aside>
			</div>
		</div>
	);
}
