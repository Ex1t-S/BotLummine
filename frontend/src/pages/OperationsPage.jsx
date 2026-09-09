import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	MessageCircle,
	RefreshCw,
	ShoppingCart,
	WalletCards,
} from 'lucide-react';
import api from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isAdminUser, isPlatformAdminUser } from '../lib/authz.js';
import { ActionButton, EmptyState, PageHeader } from '../components/ui/InternalPage.jsx';
import { KpiCard } from '../components/ui/kpi-card';
import { useInternalDarkOverrides } from '../hooks/useInternalDarkOverrides.js';
import { RuntimeStatus, useRuntimeStatus } from '../components/operations/RuntimeStatus.jsx';
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

function PriorityCenter({ items = [], onNavigate }) {
	return (
		<section className="operations-v3-panel operations-v3-priorities" aria-labelledby="operations-priority-title">
			<div className="operations-v3-panel-head">
				<div>
					<span>Ordenadas por impacto</span>
					<h3 id="operations-priority-title">Pendientes actuales</h3>
				</div>
				<strong>{items.length} {items.length === 1 ? 'tipo de pendiente' : 'tipos de pendientes'}</strong>
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
				<div className="operations-v3-clear"><CheckCircle2 size={20} aria-hidden="true" /><div><strong>No hay tareas críticas</strong><span>No hay pendientes en los datos consultados.</span></div></div>
			)}
		</section>
	);
}

function OperationalHealth({ item, onNavigate }) {
	const health = item?.health;
	return <aside className="operations-v3-panel operations-v3-health" aria-labelledby="operations-health-title">
		<div className="operations-v3-panel-head"><div><span>Información de las integraciones</span><h3 id="operations-health-title">Estado técnico</h3></div></div>
		<div className="operations-v3-health-list">
			<button type="button" onClick={() => onNavigate('/admin')}><span>Canal de WhatsApp</span><strong>{typeof health?.hasActiveWhatsapp === 'boolean' ? health.hasActiveWhatsapp ? 'Configurado' : 'Sin configurar' : 'Sin verificar'}</strong></button>
			<button type="button" onClick={() => onNavigate('/catalog')}><span>Catálogo · última sincronización</span><strong>{health?.latestCatalogSync?.status === 'ERROR' ? 'Requiere revisión' : health?.latestCatalogSync?.finishedAt ? formatOperationDate(health.latestCatalogSync.finishedAt) : 'Sin verificar'}</strong></button>
			<button type="button" onClick={() => onNavigate('/customers')}><span>Clientes · última sincronización</span><strong>{health?.latestCustomerSync?.status === 'ERROR' ? 'Requiere revisión' : health?.latestCustomerSync?.finishedAt ? formatOperationDate(health.latestCustomerSync.finishedAt) : 'Sin verificar'}</strong></button>
		</div>
		<p className="operations-technical-note">La configuración del canal no confirma una conexión en vivo con Meta.</p>
	</aside>;
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
					label="Esperando respuesta"
					value={metrics.waitingResponseConversations}
					helper={`${formatNumber(metrics.waitingResponseUnder24h)} <24 h · ${formatNumber(metrics.waitingResponseOver24h)} >24 h`}
					tone={metrics.waitingResponseConversations ? 'info' : 'neutral'}
					onClick={!platformAdmin ? () => onNavigate('/inbox/todos?status=WAITING_RESPONSE') : null}
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
	const { user } = useAuth();
	const platformAdmin = isPlatformAdminUser(user);
	const isAdmin = isAdminUser(user);
	const brandAdmin = isAdmin && !platformAdmin;
	const runtime = useRuntimeStatus(!platformAdmin);

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

	const summary = summaryQuery.data || {};
	const totals = summary.totals || {};
	const workspaces = summary.workspaces || [];
	const primaryWorkspace = workspaces[0] || null;
	const priorityItems = useMemo(() => {
		const issueItems = workspaces.flatMap((item) => (Array.isArray(item.issues) ? item.issues : []))
			.filter((issue) => !isCampaignOperationIssue(issue) && !['payment', 'waiting_response', 'whatsapp_outbound'].includes(issue.type))
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
			totals.paymentReview ? { id: 'payment-review', title: `${formatNumber(totals.paymentReview)} ${totals.paymentReview === 1 ? 'comprobante espera' : 'comprobantes esperan'} revisión`, description: 'Decisión humana pendiente antes de continuar la atención.', action: 'Revisar', href: platformAdmin ? '/admin' : '/inbox/comprobantes', tone: 'warning', icon: WalletCards } : null,
			totals.waitingResponseConversations ? { id: 'waiting-response', title: `${formatNumber(totals.waitingResponseConversations)} ${totals.waitingResponseConversations === 1 ? 'conversación espera' : 'conversaciones esperan'} respuesta`, description: `${formatNumber(totals.waitingResponseUnder24h)} con menos de 24 h · ${formatNumber(totals.waitingResponseOver24h)} con más de 24 h.`, action: 'Abrir bandeja', href: platformAdmin ? '/admin' : '/inbox/todos?status=WAITING_RESPONSE', tone: totals.waitingResponseOver24h ? 'warning' : 'info', icon: MessageCircle } : null,
			brandAdmin && totals.abandonedCartsNew ? { id: 'carts', title: `${formatNumber(totals.abandonedCartsNew)} ${totals.abandonedCartsNew === 1 ? 'carrito sin' : 'carritos sin'} primer contacto`, description: 'Revisá los datos y la elegibilidad antes de contactar.', action: 'Ver carritos', href: '/abandoned-carts', tone: 'info', icon: ShoppingCart } : null,
		].filter(Boolean);
		return [...issueItems, ...metricItems];
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
					<ActionButton variant="secondary" onClick={() => summaryQuery.refetch()} disabled={summaryQuery.isFetching} icon={RefreshCw}>
						{summaryQuery.isFetching ? 'Reintentando' : 'Reintentar'}
					</ActionButton>
				</EmptyState>
			</section>
		);
	}

	return (
		<section className="operations-page operations-page--v3 operations-page--v4">
			<PageHeader
				className="operations-header"
				eyebrow={platformAdmin ? 'Operación multi marca' : getWorkspaceName(primaryWorkspace)}
				title={platformAdmin ? 'Centro de operaciones' : 'Operación'}
				description={
					platformAdmin
						? 'Decisiones y alertas de todas las marcas, ordenadas por impacto.'
						: 'Priorizá las conversaciones y tareas que esperan una respuesta.'
				}
			>
				<div className="operations-header-actions">
					{user ? (
						<ActionButton
							onClick={() => goTo(platformAdmin ? '/admin' : '/inbox/automatico')}
							icon={ArrowRight}
						>
							{platformAdmin ? 'Abrir administración' : 'Abrir bandeja'}
						</ActionButton>
					) : null}
					<ActionButton variant="secondary" onClick={() => summaryQuery.refetch()} disabled={summaryQuery.isFetching} icon={RefreshCw}>
						{summaryQuery.isFetching ? 'Actualizando' : 'Actualizar'}
					</ActionButton>
				</div>
			</PageHeader>
			{!platformAdmin ? <RuntimeStatus query={runtime} /> : null}

			<div className="operations-summary-strip operations-v3-kpis">
				<MetricCard label="Comprobantes" value={totals.paymentReview} helper="Pendientes de decisión" tone={totals.paymentReview ? 'warning' : 'neutral'} icon={WalletCards} />
				<MetricCard label="Esperando respuesta" value={totals.waitingResponseConversations} helper={`${formatNumber(totals.waitingResponseUnder24h)} <24 h · ${formatNumber(totals.waitingResponseOver24h)} >24 h`} tone={totals.waitingResponseConversations ? 'info' : 'neutral'} icon={MessageCircle} />
				<MetricCard label="Carritos" value={totals.abandonedCartsNew} helper="Oportunidades nuevas" tone={totals.abandonedCartsNew ? 'info' : 'neutral'} icon={ShoppingCart} />
			</div>

			<div className="operations-v3-main-grid">
				<PriorityCenter items={priorityItems} onNavigate={goTo} />
				{!platformAdmin ? <OperationalHealth item={primaryWorkspace} onNavigate={goTo} /> : null}
			</div>

			{brandAdmin ? <section className="operations-v3-panel operations-rules-link">
				<div><h3>Reglas automáticas</h3><p>Revisá el horario, los permisos y la configuración de cada automatización.</p></div>
				<ActionButton variant="secondary" onClick={() => goTo('/campaigns/automations')}>Administrar automatizaciones</ActionButton>
			</section> : null}

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
