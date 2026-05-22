import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	MessageCircle,
	RefreshCw,
	Send,
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
	return item.workspace?.displayName || item.workspace?.name || item.workspace?.slug || 'Marca';
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

	return (
		<section className="operations-automation-panel" aria-labelledby="operations-automation-title">
			<div className="operations-automation-head">
				<div>
					<span className="operations-eyebrow">Automatizaciones</span>
					<h3 id="operations-automation-title">Activar o pausar envios automaticos</h3>
					<p>Solo admins de marca pueden cambiar estos controles.</p>
				</div>
			</div>

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
		</section>
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
					<span>{item.workspace?.slug || item.workspace?.status || 'workspace'}</span>
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
	const visibleOpenIssuesCount = useMemo(
		() =>
			workspaces.reduce((total, item) => {
				const issues = Array.isArray(item.issues) ? item.issues : [];
				return total + issues.filter((issue) => !isCampaignOperationIssue(issue)).length;
			}, 0),
		[workspaces]
	);
	const automationLoading =
		abandonedAutomationQuery.isLoading ||
		shipmentSettingsQuery.isLoading ||
		pendingPaymentAutomationQuery.isLoading;

	const quickActions = useMemo(() => {
		const actions = [
			{
				label: 'Revisar comprobantes',
				value: totals.paymentReview,
				helper: 'Pagos para validar',
				tone: totals.paymentReview ? 'warning' : 'neutral',
				href: platformAdmin ? '/admin' : '/inbox/comprobantes',
				icon: WalletCards,
			},
			{
				label: 'Chats sin leer',
				value: totals.unreadConversations,
				helper: `${formatNumber(totals.unreadMessages)} mensajes pendientes`,
				tone: totals.unreadConversations ? 'info' : 'neutral',
				href: platformAdmin ? '/admin' : '/inbox/todos?read=UNREAD',
				icon: MessageCircle,
			},
		];

		if (brandAdmin) {
			actions.push({
				label: 'Carritos nuevos',
				value: totals.abandonedCartsNew,
				helper: 'Oportunidades para recuperar',
				tone: totals.abandonedCartsNew ? 'info' : 'neutral',
				href: '/abandoned-carts',
				icon: ShoppingCart,
			});
		}

		return actions;
	}, [brandAdmin, platformAdmin, totals]);

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
				/>
			</section>
		);
	}

	return (
		<section className="operations-page">
			<PageHeader
				className="operations-header"
				eyebrow={platformAdmin ? 'Operación multi marca' : 'Operación diaria'}
				title={platformAdmin ? 'Prioridades de la plataforma' : getWorkspaceName(primaryWorkspace)}
				description={
					platformAdmin
						? 'Control de marcas con alertas, conversaciones pendientes y salud operativa.'
						: 'Priorizá comprobantes, chats y oportunidades que requieren acción hoy.'
				}
			>
				<div className="operations-header-actions">
					<ActionButton onClick={() => summaryQuery.refetch()} disabled={summaryQuery.isFetching} icon={RefreshCw}>
						{summaryQuery.isFetching ? 'Actualizando' : 'Actualizar'}
					</ActionButton>
					{isAdmin ? (
						<ActionButton
							variant="secondary"
							onClick={() => goTo(platformAdmin ? '/admin' : '/campaigns/tracking')}
							icon={ArrowRight}
						>
							{platformAdmin ? 'Abrir admin' : 'Ver campañas'}
						</ActionButton>
					) : null}
				</div>
			</PageHeader>

			<div className="operations-summary-strip">
				<MetricCard label="Alertas" value={visibleOpenIssuesCount} helper="Problemas o tareas detectadas" tone={visibleOpenIssuesCount ? 'warning' : 'neutral'} icon={AlertTriangle} />
				<MetricCard label="Conversaciones 30d" value={totals.activeConversations30d} helper="Actividad reciente" icon={MessageCircle} />
				<MetricCard label="Entrada 30d" value={totals.messages30dInbound} helper="Mensajes recibidos" icon={MessageCircle} />
				<MetricCard label="Salida 30d" value={totals.messages30dOutbound} helper="Mensajes enviados" icon={Send} />
			</div>

			<div className="operations-quick-actions">
				{quickActions.map((action) => (
					<MetricCard
						key={action.label}
						label={action.label}
						value={action.value}
						helper={action.helper}
						tone={action.tone}
						onClick={() => goTo(action.href)}
						icon={action.icon}
					/>
				))}
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

			<div className={platformAdmin ? 'operations-workspaces-grid' : 'operations-single-workspace'}>
				{workspaces.map((item) => (
					<WorkspaceOperationCard
						key={item.workspace.id}
						item={item}
						platformAdmin={platformAdmin}
						onNavigate={goTo}
					/>
				))}
			</div>

			{!workspaces.length ? (
				<EmptyState
					title="No hay marcas para mostrar"
					description="Cuando haya una marca activa, sus prioridades van a aparecer acá."
					className="operations-empty operations-empty--status"
				/>
			) : null}
		</section>
	);
}
