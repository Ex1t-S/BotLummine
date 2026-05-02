import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isAdminUser, isPlatformAdminUser } from '../lib/authz.js';
import './OperationsPage.css';

function formatNumber(value) {
	return new Intl.NumberFormat('es-AR').format(Number(value || 0));
}

function getSeverityLabel(severity = '') {
	if (severity === 'critical') return 'Critico';
	if (severity === 'warning') return 'Atencion';
	return 'Info';
}

function getWorkspaceName(item = {}) {
	return item.workspace?.displayName || item.workspace?.name || item.workspace?.slug || 'Marca';
}

function MetricCard({ label, value, helper, tone = 'neutral', onClick }) {
	const content = (
		<>
			<span>{label}</span>
			<strong>{formatNumber(value)}</strong>
			<small>{helper}</small>
		</>
	);

	if (onClick) {
		return (
			<button type="button" className={`operations-metric-card tone-${tone}`} onClick={onClick}>
				{content}
			</button>
		);
	}

	return <div className={`operations-metric-card tone-${tone}`}>{content}</div>;
}

function IssueList({ issues = [], platformAdmin = false, onNavigate }) {
	if (!issues.length) {
		return (
			<div className="operations-empty compact">
				No hay alertas operativas para esta marca.
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
						{platformAdmin ? 'Abrir admin' : issue.action || 'Revisar'}
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
					helper="Pendientes de revision"
					tone={metrics.paymentReview ? 'warning' : 'neutral'}
					onClick={!platformAdmin ? () => onNavigate('/inbox/comprobantes') : null}
				/>
				<MetricCard
					label="Chats no leidos"
					value={metrics.unreadConversations}
					helper={`${formatNumber(metrics.unreadMessages)} mensajes pendientes`}
					tone={metrics.unreadConversations ? 'info' : 'neutral'}
					onClick={!platformAdmin ? () => onNavigate('/inbox/todos?read=UNREAD') : null}
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
			},
			{
				label: 'Chats no leidos',
				value: totals.unreadConversations,
				helper: `${formatNumber(totals.unreadMessages)} mensajes pendientes`,
				tone: totals.unreadConversations ? 'info' : 'neutral',
				href: platformAdmin ? '/admin' : '/inbox/todos?read=UNREAD',
			},
			{
				label: 'Campanas activas',
				value: totals.activeCampaigns,
				helper: 'Envios en curso o cola',
				tone: totals.failedCampaigns ? 'warning' : 'neutral',
				href: platformAdmin ? '/admin' : '/campaigns/tracking',
			},
		];

		if (isAdmin && !platformAdmin) {
			actions.push({
				label: 'Carritos nuevos',
				value: totals.abandonedCartsNew,
				helper: 'Oportunidades para recuperar',
				tone: totals.abandonedCartsNew ? 'info' : 'neutral',
				href: '/abandoned-carts',
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
				<div className="operations-empty">Cargando operacion diaria...</div>
			</section>
		);
	}

	if (summaryQuery.isError) {
		return (
			<section className="operations-page">
				<div className="operations-empty error">
					No se pudo cargar la operacion. Reintenta en unos segundos.
				</div>
			</section>
		);
	}

	return (
		<section className="operations-page">
			<header className="operations-header">
				<div>
					<span className="operations-eyebrow">
						{platformAdmin ? 'Operacion multi marca' : 'Operacion diaria'}
					</span>
					<h2>{platformAdmin ? 'Prioridades de la plataforma' : getWorkspaceName(primaryWorkspace)}</h2>
					<p>
						{platformAdmin
							? 'Marcas con alertas, conversaciones pendientes y salud operativa.'
							: 'Conversaciones, comprobantes y tareas que conviene resolver primero.'}
					</p>
				</div>
				<div className="operations-header-actions">
					<button type="button" onClick={() => summaryQuery.refetch()} disabled={summaryQuery.isFetching}>
						{summaryQuery.isFetching ? 'Actualizando...' : 'Actualizar'}
					</button>
					{isAdmin ? (
						<button type="button" className="secondary" onClick={() => goTo(platformAdmin ? '/admin' : '/campaigns/tracking')}>
							{platformAdmin ? 'Admin plataforma' : 'Ver campanas'}
						</button>
					) : null}
				</div>
			</header>

			<div className="operations-summary-strip">
				<MetricCard label="Alertas" value={summary.openIssuesCount} helper="Problemas o tareas detectadas" tone={summary.openIssuesCount ? 'warning' : 'neutral'} />
				<MetricCard label="Conversaciones 30d" value={totals.activeConversations30d} helper="Actividad reciente" />
				<MetricCard label="Entrada 30d" value={totals.messages30dInbound} helper="Mensajes recibidos" />
				<MetricCard label="Salida 30d" value={totals.messages30dOutbound} helper="Mensajes enviados" />
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
				<div className="operations-empty">No hay marcas para mostrar.</div>
			) : null}
		</section>
	);
}
