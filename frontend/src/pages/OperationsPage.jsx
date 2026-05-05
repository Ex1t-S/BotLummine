import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	MessageCircle,
	RefreshCw,
	Send,
	ShoppingCart,
	WalletCards,
} from 'lucide-react';
import api from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isAdminUser, isPlatformAdminUser } from '../lib/authz.js';
import { ActionButton, EmptyState, PageHeader } from '../components/ui/InternalPage.jsx';
import MetricPanel from '../components/ui/MetricPanel.jsx';
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

function MetricCard({ label, value, helper, tone = 'neutral', onClick, icon: Icon }) {
	return (
		<MetricPanel
			label={label}
			value={value}
			helper={helper}
			tone={tone}
			onClick={onClick}
			icon={Icon}
			formatValue={formatNumber}
		/>
	);
}

function IssueList({ issues = [], platformAdmin = false, onNavigate }) {
	if (!issues.length) {
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
			{issues.slice(0, 5).map((issue, index) => (
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
	const issueCount = item.issues?.length || 0;

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
				issues={item.issues || []}
				platformAdmin={platformAdmin}
				onNavigate={onNavigate}
			/>
		</section>
	);
}

export default function OperationsPage() {
	useInternalDarkOverrides();

	const navigate = useNavigate();
	const { user } = useAuth();
	const platformAdmin = isPlatformAdminUser(user);
	const isAdmin = isAdminUser(user);

	const summaryQuery = useQuery({
		queryKey: queryKeys.operationsSummary,
		queryFn: async () => {
			const res = await api.get('/dashboard/operations/summary');
			return res.data;
		},
		refetchInterval: 30000,
		...queryPresets.inbox,
	});

	const summary = summaryQuery.data || {};
	const totals = summary.totals || {};
	const workspaces = summary.workspaces || [];
	const primaryWorkspace = workspaces[0] || null;

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
			{
				label: 'Campañas activas',
				value: totals.activeCampaigns,
				helper: 'Envíos activos o en cola',
				tone: totals.failedCampaigns ? 'warning' : 'neutral',
				href: platformAdmin ? '/admin' : '/campaigns/tracking',
				icon: Send,
			},
		];

		if (isAdmin && !platformAdmin) {
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
	}, [isAdmin, platformAdmin, totals]);

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
				<MetricCard label="Alertas" value={summary.openIssuesCount} helper="Problemas o tareas detectadas" tone={summary.openIssuesCount ? 'warning' : 'neutral'} icon={AlertTriangle} />
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
