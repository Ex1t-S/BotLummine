import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	MessageCircle,
	RefreshCw,
	Truck,
	ShoppingCart,
	WalletCards,
} from 'lucide-react';
import api from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';
import {
	fetchAbandonedCartAutomationSettings,
	fetchPendingPaymentAutomationSettings,
	fetchShipmentNotificationSettings,
	updateAbandonedCartAutomationSettings,
	updatePendingPaymentAutomationSettings,
	updateShipmentNotificationSettings,
} from '../lib/campaigns.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isAdminUser, isPlatformAdminUser } from '../lib/authz.js';
import { ActionButton, EmptyState, PageHeader, StatusBadge } from '../components/ui/InternalPage.jsx';
import { KpiCard } from '../components/ui/kpi-card';
import { useInternalDarkOverrides } from '../hooks/useInternalDarkOverrides.js';
import './OperationsPage.css';

function formatNumber(value) {
	return new Intl.NumberFormat('es-AR').format(Number(value || 0));
}

function getSeverityLabel(severity = '') {
	if (severity === 'critical') return 'Crítico';
	if (severity === 'warning') return 'Atención';
	return 'Info';
}

function getWorkspaceName(item = {}) {
	const workspace = item?.workspace || item || {};
	return workspace.displayName || workspace.name || workspace.slug || 'Marca';
}

function formatOperationDate(value) {
	if (!value) return 'Nunca';
	try {
		return new Date(value).toLocaleString('es-AR', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
		});
	} catch {
		return 'Nunca';
	}
}

function getMutationErrorMessage(...mutations) {
	const mutationWithError = mutations.find((mutation) => mutation?.isError);
	return mutationWithError?.error?.response?.data?.error || mutationWithError?.error?.message || '';
}

function isCampaignOperationIssue(issue = {}) {
	return ['campaign_dispatch', 'campaigns'].includes(issue.type);
}

function mapKpiTone(tone = 'neutral') {
	if (tone === 'warning') return 'warning';
	if (tone === 'danger') return 'danger';
	if (tone === 'success') return 'success';
	if (tone === 'info') return 'primary';
	return 'default';
}

function MetricCard({ label, value, helper, tone = 'neutral', onClick, icon: Icon }) {
	const card = (
		<KpiCard
			label={label}
			value={formatNumber(value)}
			caption={helper}
			tone={mapKpiTone(tone)}
			size="md"
			className="operations-kpi-card"
			icon={Icon ? <Icon className="operations-kpi-icon" aria-hidden="true" /> : null}
		/>
	);

	if (!onClick) return card;

	return (
		<button type="button" className="operations-kpi-button" onClick={onClick}>
			{card}
		</button>
	);
}

function AutomationSwitch({ checked, disabled = false, loading = false, label, onChange }) {
	return (
		<label className={`operations-switch ${checked ? 'is-on' : ''} ${loading ? 'is-loading' : ''}`.trim()}>
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled || loading}
				aria-label={label}
				onChange={(event) => onChange?.(event.target.checked)}
			/>
			<span aria-hidden="true" />
		</label>
	);
}

function AutomationRow({
	icon: Icon,
	title,
	description,
	enabled,
	configured,
	loading = false,
	saving = false,
	lastRunAt = null,
	lastError = '',
	configHref,
	configLabel = 'Configurar',
	onConfigure,
	onToggle,
}) {
	const statusTone = lastError ? 'danger' : enabled ? 'success' : configured ? 'warning' : 'neutral';
	const statusLabel = lastError
		? 'Con error'
		: enabled
			? 'Activa'
			: configured
				? 'Pausada'
				: 'Requiere configuracion';
	const switchDisabled = loading || saving || (!configured && !enabled);

	return (
		<article className="operations-automation-row">
			<div className="operations-automation-icon" aria-hidden="true">
				<Icon size={18} strokeWidth={2.2} />
			</div>
			<div className="operations-automation-copy">
				<div className="operations-automation-title-line">
					<strong>{title}</strong>
					<StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
				</div>
				<p>{description}</p>
				<div className="operations-automation-meta">
					<span>Ultima ejecucion: {formatOperationDate(lastRunAt)}</span>
					{lastError ? <span className="is-error">{lastError}</span> : null}
				</div>
			</div>
			<div className="operations-automation-actions">
				{configHref ? (
					<ActionButton variant="secondary" icon={ArrowRight} onClick={() => onConfigure?.(configHref)}>
						{configLabel}
					</ActionButton>
				) : null}
				<AutomationSwitch
					checked={enabled}
					disabled={switchDisabled}
					loading={saving}
					label={`${enabled ? 'Desactivar' : 'Activar'} ${title}`}
					onChange={onToggle}
				/>
			</div>
		</article>
	);
}

function AutomationPanel({
	abandonedSettings,
	shipmentSettings,
	pendingPaymentSettings,
	loading = false,
	mutations,
	onNavigate,
}) {
	const abandoned = abandonedSettings || {};
	const shipment = shipmentSettings || {};
	const pending = pendingPaymentSettings || {};
	const pendingConfigured = Boolean(pending.templateId);
	const pendingEnabled = Boolean(pending.enabled);
	const saveError = getMutationErrorMessage(mutations.abandoned, mutations.pendingPayments, mutations.shipments);
	const activeCount = [abandoned.enabled, pendingEnabled, shipment.enabled].filter(Boolean).length;
	const errorCount = [abandoned.lastError, pending.lastError, shipment.lastError].filter(Boolean).length;

	return (
		<details className="operations-automation-panel">
			<summary className="operations-automation-head">
				<div>
					<span className="operations-eyebrow">Automatizaciones</span>
					<h3>Reglas automáticas</h3>
					<p>{activeCount} de 3 activas · {errorCount ? `${errorCount} requieren atención` : 'sin errores detectados'}</p>
				</div>
				<span className="operations-automation-manage">Administrar</span>
			</summary>

			<div className="operations-automation-list" aria-busy={loading}>
				<AutomationRow
					icon={ShoppingCart}
					title="Carritos abandonados"
					description="Recupera carritos nuevos con la plantilla y filtros ya configurados."
					enabled={Boolean(abandoned.enabled)}
					configured={Boolean(abandoned.templateId)}
					loading={loading}
					saving={mutations.abandoned.isPending}
					lastRunAt={abandoned.lastRunAt}
					lastError={abandoned.lastError}
					configHref="/campaigns/segment"
					onConfigure={onNavigate}
					onToggle={(nextEnabled) =>
						mutations.abandoned.mutate({
							enabled: nextEnabled,
							templateId: abandoned.templateId || null,
							filters: abandoned.filters || {},
						})
					}
				/>
				<AutomationRow
					icon={WalletCards}
					title="Pagos pendientes"
					description="Recuerda pedidos pendientes 2 horas despues de detectarlos, una sola vez por pedido."
					enabled={pendingEnabled}
					configured={pendingConfigured}
					loading={loading}
					saving={mutations.pendingPayments.isPending}
					lastRunAt={pending.lastRunAt}
					lastError={pending.lastError}
					configHref="/campaigns/pending-payments"
					onConfigure={onNavigate}
					onToggle={(nextEnabled) =>
						mutations.pendingPayments.mutate({
							enabled: nextEnabled,
							templateId: pending.templateId || null,
							filters: pending.filters || {},
							variableMapping: pending.variableMapping || {},
						})
					}
				/>
				<AutomationRow
					icon={Truck}
					title="Pedidos despachados"
					description="Notifica despachos detectados con la plantilla y variables configuradas."
					enabled={Boolean(shipment.enabled)}
					configured={Boolean(shipment.templateId)}
					loading={loading}
					saving={mutations.shipments.isPending}
					lastRunAt={shipment.lastRunAt}
					lastError={shipment.lastError}
					configHref="/campaigns/shipments"
					onConfigure={onNavigate}
					onToggle={(nextEnabled) =>
						mutations.shipments.mutate({
							enabled: nextEnabled,
							templateId: shipment.templateId || null,
							variableMapping: shipment.variableMapping || {},
							daysBack: shipment.daysBack || 14,
						})
					}
				/>
			</div>

			{saveError ? (
				<div className="operations-automation-error" role="alert">
					{saveError}
				</div>
			) : null}
		</details>
	);
}

function PriorityCenter({ items = [], onNavigate }) {
	return (
		<section className="operations-v3-panel operations-v3-priorities" aria-labelledby="operations-priority-title">
			<div className="operations-v3-panel-head">
				<div>
					<span>Ordenadas por impacto</span>
					<h3 id="operations-priority-title">Prioridades de hoy</h3>
				</div>
				<strong>{items.length} abiertas</strong>
			</div>

			{items.length ? (
				<div className="operations-v3-priority-list">
					{items.map((item) => {
						const Icon = item.icon || AlertTriangle;
						return (
							<button key={item.id} type="button" className={`operations-v3-priority tone-${item.tone || 'info'}`} onClick={() => onNavigate(item.href)}>
								<span className="operations-v3-priority-icon"><Icon size={18} strokeWidth={2.1} aria-hidden="true" /></span>
								<span className="operations-v3-priority-copy">
									<strong>{item.title}</strong>
									<small>{item.description}</small>
								</span>
								<span className="operations-v3-priority-action">{item.action}<ArrowRight size={15} aria-hidden="true" /></span>
							</button>
						);
					})}
				</div>
			) : (
				<div className="operations-v3-clear"><CheckCircle2 size={20} aria-hidden="true" /><div><strong>No hay tareas críticas</strong><span>La operación está dentro de los niveles esperados.</span></div></div>
			)}
		</section>
	);
}

function OperationalHealth({ totals = {}, activeAutomations = 0, issueCount = 0, onNavigate }) {
	const stable = issueCount === 0;
	return (
		<aside className="operations-v3-panel operations-v3-health" aria-labelledby="operations-health-title">
			<div className="operations-v3-panel-head">
				<div>
					<span>Lectura rápida</span>
					<h3 id="operations-health-title">Salud operativa</h3>
				</div>
			</div>
			<div className={`operations-v3-health-score ${stable ? 'is-stable' : 'needs-attention'}`}>
				<strong>{stable ? 'Estable' : 'Atención'}</strong>
				<span>{stable ? 'No hay bloqueos abiertos.' : `${formatNumber(issueCount)} señales requieren decisión.`}</span>
			</div>
			<div className="operations-v3-health-list">
				<button type="button" onClick={() => onNavigate('/campaigns/abandoned-carts')}><span>Automatizaciones</span><strong>{activeAutomations}/3 activas</strong></button>
				<button type="button" onClick={() => onNavigate('/inbox/comprobantes')}><span>Comprobantes</span><strong>{formatNumber(totals.paymentReview)} pendientes</strong></button>
				<button type="button" onClick={() => onNavigate('/inbox/todos?read=UNREAD')}><span>Bandeja</span><strong>{formatNumber(totals.unreadMessages)} sin leer</strong></button>
			</div>
		</aside>
	);
}

function IssueList({ issues = [], platformAdmin = false, onNavigate }) {
	const visibleIssues = issues.filter((issue) => !isCampaignOperationIssue(issue));

	if (!visibleIssues.length) {
		return (
			<div className="operations-empty compact">
				<CheckCircle2 size={18} strokeWidth={2.2} aria-hidden="true" />
				<strong>Sin alertas abiertas</strong>
				<span>No hay tareas críticas para resolver en este momento.</span>
			</div>
		);
	}

	return (
		<div className="operations-issue-list">
			{visibleIssues.slice(0, 5).map((issue, index) => (
				<div className={`operations-issue severity-${issue.severity || 'info'}`} key={`${issue.type}-${index}`}>
					<div>
						<span>{getSeverityLabel(issue.severity)}</span>
						<strong>{issue.label}</strong>
					</div>
					<button
						type="button"
						onClick={() => onNavigate(platformAdmin ? '/admin' : issue.href || '/operations')}
					>
						<span>{platformAdmin ? 'Abrir admin' : issue.action || 'Revisar'}</span>
						<ArrowRight size={14} strokeWidth={2.4} aria-hidden="true" />
					</button>
				</div>
			))}
		</div>
	);
}

function WorkspaceOperationCard({ item, platformAdmin, onNavigate }) {
	const metrics = item.metrics || {};
	const health = item.health || {};
	const visibleIssues = Array.isArray(item.issues)
		? item.issues.filter((issue) => !isCampaignOperationIssue(issue))
		: [];
	const issueCount = visibleIssues.length;
	const pausedFlags = Array.isArray(health.pausedFlags)
		? health.pausedFlags.filter((flag) => flag.key !== 'campaign_dispatch')
		: [];

	return (
		<section className="operations-workspace-card">
			<div className="operations-workspace-head">
				<div>
					<span>{item.workspace?.slug || item.workspace?.status || 'marca'}</span>
					<h3>{getWorkspaceName(item)}</h3>
				</div>
				<strong className={issueCount ? 'has-issues' : 'is-clear'}>
					{issueCount ? `${issueCount} alertas` : 'En orden'}
				</strong>
			</div>

			<div className="operations-workspace-metrics">
				<MetricCard
					label="Comprobantes"
					value={metrics.paymentReview}
					helper="Pagos pendientes de validar"
					tone={metrics.paymentReview ? 'warning' : 'neutral'}
					onClick={!platformAdmin ? () => onNavigate('/inbox/comprobantes') : null}
					icon={WalletCards}
				/>
				<MetricCard
					label="Chats sin leer"
					value={metrics.unreadConversations}
					helper={`${formatNumber(metrics.unreadMessages)} mensajes pendientes`}
					tone={metrics.unreadConversations ? 'info' : 'neutral'}
					onClick={!platformAdmin ? () => onNavigate('/inbox/todos?read=UNREAD') : null}
					icon={MessageCircle}
				/>
			</div>

			<IssueList
				issues={visibleIssues}
				platformAdmin={platformAdmin}
				onNavigate={onNavigate}
			/>

			{pausedFlags.length ? (
				<div className="operations-control-list">
					{pausedFlags.map((flag) => (
						<span key={flag.key}>
							<strong>WhatsApp saliente pausado</strong>
							<small>{flag.reason || 'Sin motivo cargado'}</small>
						</span>
					))}
				</div>
			) : null}
		</section>
	);
}

export default function OperationsPage() {
	useInternalDarkOverrides();

	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { user } = useAuth();
	const platformAdmin = isPlatformAdminUser(user);
	const isAdmin = isAdminUser(user);
	const brandAdmin = isAdmin && !platformAdmin;

	const summaryQuery = useQuery({
		queryKey: queryKeys.operationsSummary,
		queryFn: async () => {
			const res = await api.get('/dashboard/operations/summary');
			return res.data;
		},
		refetchInterval: 30000,
		placeholderData: keepPreviousData,
		...queryPresets.inbox,
	});

	const abandonedAutomationQuery = useQuery({
		queryKey: ['operations', 'abandoned-cart-automation', 'settings'],
		queryFn: fetchAbandonedCartAutomationSettings,
		enabled: brandAdmin,
		placeholderData: keepPreviousData,
		...queryPresets.campaigns,
	});

	const shipmentSettingsQuery = useQuery({
		queryKey: ['operations', 'shipment-notifications', 'settings'],
		queryFn: fetchShipmentNotificationSettings,
		enabled: brandAdmin,
		placeholderData: keepPreviousData,
		...queryPresets.campaigns,
	});

	const pendingPaymentAutomationQuery = useQuery({
		queryKey: ['operations', 'pending-payment-automation', 'settings'],
		queryFn: fetchPendingPaymentAutomationSettings,
		enabled: brandAdmin,
		placeholderData: keepPreviousData,
		...queryPresets.campaigns,
	});

	function invalidateAutomationQueries() {
		queryClient.invalidateQueries({ queryKey: ['operations'] });
		queryClient.invalidateQueries({ queryKey: ['campaigns', 'abandoned-cart-automation'] });
		queryClient.invalidateQueries({ queryKey: ['campaigns', 'pending-payment-automation'] });
		queryClient.invalidateQueries({ queryKey: ['campaigns', 'shipment-notifications'] });
	}

	const updateAbandonedMutation = useMutation({
		mutationFn: updateAbandonedCartAutomationSettings,
		onSuccess: invalidateAutomationQueries,
	});

	const updateShipmentsMutation = useMutation({
		mutationFn: updateShipmentNotificationSettings,
		onSuccess: invalidateAutomationQueries,
	});

	const updatePendingPaymentsMutation = useMutation({
		mutationFn: updatePendingPaymentAutomationSettings,
		onSuccess: invalidateAutomationQueries,
	});

	const summary = summaryQuery.data || {};
	const totals = summary.totals || {};
	const workspaces = summary.workspaces || [];
	const primaryWorkspace = workspaces[0] || null;
	const automationLoading =
		abandonedAutomationQuery.isLoading ||
		shipmentSettingsQuery.isLoading ||
		pendingPaymentAutomationQuery.isLoading;
	const activeAutomations = [
		abandonedAutomationQuery.data?.settings?.enabled,
		shipmentSettingsQuery.data?.settings?.enabled,
		pendingPaymentAutomationQuery.data?.settings?.enabled,
	].filter(Boolean).length;

	const priorityItems = useMemo(() => {
		const issueItems = workspaces.flatMap((item) => (Array.isArray(item.issues) ? item.issues : []))
			.filter((issue) => !isCampaignOperationIssue(issue))
			.map((issue, index) => ({
				id: `issue-${issue.type || index}-${index}`,
				title: issue.title || issue.label || 'Alerta operativa',
				description: issue.description || 'Revisá el detalle para resolver esta señal.',
				action: issue.action || 'Revisar',
				href: platformAdmin ? '/admin' : issue.href || '/operations',
				tone: issue.severity === 'critical' ? 'danger' : 'warning',
				icon: AlertTriangle,
			}));
		const metricItems = [
			totals.paymentReview ? { id: 'payment-review', title: `${formatNumber(totals.paymentReview)} comprobantes esperan revisión`, description: 'Decisión humana pendiente antes de continuar la atención.', action: 'Revisar', href: platformAdmin ? '/admin' : '/inbox/comprobantes', tone: 'warning', icon: WalletCards } : null,
			totals.unreadConversations ? { id: 'unread', title: `${formatNumber(totals.unreadConversations)} conversaciones requieren lectura`, description: `${formatNumber(totals.unreadMessages)} mensajes todavía no fueron revisados.`, action: 'Abrir bandeja', href: platformAdmin ? '/admin' : '/inbox/todos?read=UNREAD', tone: 'info', icon: MessageCircle } : null,
			brandAdmin && totals.abandonedCartsNew ? { id: 'carts', title: `${formatNumber(totals.abandonedCartsNew)} carritos listos para recuperar`, description: 'Oportunidades sin primer contacto registradas hoy.', action: 'Ver carritos', href: '/abandoned-carts', tone: 'info', icon: ShoppingCart } : null,
		].filter(Boolean);
		return [...issueItems, ...metricItems].slice(0, 5);
	}, [brandAdmin, platformAdmin, totals, workspaces]);

	function goTo(path) {
		navigate(path);
	}

	if (summaryQuery.isLoading) {
		return (
			<section className="operations-page">
				<EmptyState
					tone="loading"
					title="Cargando prioridades operativas"
					description="Estamos revisando conversaciones, comprobantes y alertas abiertas."
					className="operations-empty operations-empty--status"
				/>
			</section>
		);
	}

	if (summaryQuery.isError) {
		return (
			<section className="operations-page">
				<EmptyState
					tone="error"
					icon={AlertTriangle}
					title="No pudimos cargar la operación"
					description="Probá nuevamente en unos segundos. Si sigue pasando, revisá la conexión del backend."
					className="operations-empty error"
				>
					<ActionButton onClick={() => summaryQuery.refetch()} disabled={summaryQuery.isFetching} icon={RefreshCw}>
						{summaryQuery.isFetching ? 'Reintentando' : 'Reintentar'}
					</ActionButton>
				</EmptyState>
			</section>
		);
	}

	return (
		<section className="operations-page operations-page--v3">
			<PageHeader
				className="operations-header"
				eyebrow={platformAdmin ? 'Operación multi marca' : getWorkspaceName(primaryWorkspace)}
				title={platformAdmin ? 'Centro de operaciones' : 'Lo que requiere tu atención'}
				description={
					platformAdmin
						? 'Decisiones y alertas de todas las marcas, ordenadas por impacto.'
						: 'Resolvé primero lo urgente. La actividad saludable queda en segundo plano.'
				}
			>
				<div className="operations-header-actions">
					<ActionButton onClick={() => summaryQuery.refetch()} disabled={summaryQuery.isFetching} icon={RefreshCw}>
						{summaryQuery.isFetching ? 'Actualizando' : 'Actualizar'}
					</ActionButton>
					{isAdmin ? (
						<ActionButton
							variant="secondary"
							onClick={() => goTo(platformAdmin ? '/admin' : '/inbox/automatico')}
							icon={ArrowRight}
						>
							{platformAdmin ? 'Abrir administración' : 'Abrir bandeja'}
						</ActionButton>
					) : null}
				</div>
			</PageHeader>

			<div className="operations-summary-strip operations-v3-kpis">
				<MetricCard label="Requieren acción" value={priorityItems.length} helper="Ordenadas por impacto" tone={priorityItems.length ? 'warning' : 'success'} icon={AlertTriangle} />
				<MetricCard label="Comprobantes" value={totals.paymentReview} helper="Pendientes de decisión" tone={totals.paymentReview ? 'warning' : 'neutral'} icon={WalletCards} />
				<MetricCard label="Conversaciones" value={totals.unreadConversations} helper={`${formatNumber(totals.unreadMessages)} mensajes sin leer`} tone={totals.unreadConversations ? 'info' : 'neutral'} icon={MessageCircle} />
				<MetricCard label="Carritos" value={totals.abandonedCartsNew} helper="Oportunidades nuevas" tone={totals.abandonedCartsNew ? 'info' : 'neutral'} icon={ShoppingCart} />
			</div>

			<div className="operations-v3-main-grid">
				<PriorityCenter items={priorityItems} onNavigate={goTo} />
				<OperationalHealth totals={totals} activeAutomations={activeAutomations} issueCount={priorityItems.length} onNavigate={goTo} />
			</div>

			{brandAdmin ? (
				<AutomationPanel
					abandonedSettings={abandonedAutomationQuery.data?.settings || null}
					shipmentSettings={shipmentSettingsQuery.data?.settings || null}
					pendingPaymentSettings={pendingPaymentAutomationQuery.data?.settings || null}
					loading={automationLoading}
					mutations={{
						abandoned: updateAbandonedMutation,
						shipments: updateShipmentsMutation,
						pendingPayments: updatePendingPaymentsMutation,
					}}
					onNavigate={goTo}
				/>
			) : null}

			{platformAdmin ? (
				<div className="operations-workspaces-grid operations-v3-workspaces">
					{workspaces.map((item) => (
						<WorkspaceOperationCard
							key={item.workspace.id}
							item={item}
							platformAdmin={platformAdmin}
							onNavigate={goTo}
						/>
					))}
				</div>
			) : null}

			{platformAdmin && !workspaces.length ? (
				<EmptyState
					title="No hay marcas para mostrar"
					description="Cuando haya una marca activa, sus prioridades van a aparecer acá."
					className="operations-empty operations-empty--status"
				/>
			) : null}
		</section>
	);
}
