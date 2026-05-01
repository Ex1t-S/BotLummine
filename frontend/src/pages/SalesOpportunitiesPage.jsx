import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';
import './SalesOpportunitiesPage.css';

const QUEUE_ROUTES = {
	AUTO: 'automatico',
	HUMAN: 'atencion-humana',
	PAYMENT_REVIEW: 'comprobantes',
};

const GROUPS = [
	{
		key: 'abandonedCarts',
		title: 'Carritos para recuperar',
		description: 'Carritos recientes con oportunidad de contacto o seguimiento.',
		empty: 'No hay carritos recientes para recuperar.',
		cta: '/campaigns/segment',
		ctaLabel: 'Crear campaña',
	},
	{
		key: 'pendingPayments',
		title: 'Pagos pendientes',
		description: 'Pedidos que necesitan empuje para cerrar el pago.',
		empty: 'No hay pagos pendientes detectados en la ventana.',
		cta: '/campaigns/schedules',
		ctaLabel: 'Programar seguimiento',
	},
	{
		key: 'hotConversations',
		title: 'Conversaciones calientes',
		description: 'Chats con señales de intención comercial o etapa avanzada.',
		empty: 'No hay conversaciones calientes detectadas.',
	},
	{
		key: 'humanFollowups',
		title: 'Seguimiento humano',
		description: 'Conversaciones que la IA o el flujo marcaron para atención manual.',
		empty: 'No hay seguimientos humanos pendientes.',
	},
];

function inboxLinkFor(item) {
	if (!item?.conversationId) return '';
	const slug = QUEUE_ROUTES[item.queue] || QUEUE_ROUTES.AUTO;
	return `/inbox/${slug}?conversation=${encodeURIComponent(item.conversationId)}`;
}

function OpportunityCard({ item }) {
	const inboxLink = inboxLinkFor(item);
	const context = item.commercialContext || {};
	const chips = [
		item.amountLabel,
		context.buyingIntentLevel ? `Intención ${context.buyingIntentLevel}` : '',
		context.salesStage,
		context.frictionLevel ? `Fricción ${context.frictionLevel}` : '',
	]
		.filter(Boolean)
		.slice(0, 4);

	return (
		<article className="sales-opportunity-card">
			<div className="sales-opportunity-card__top">
				<div>
					<h3>{item.title}</h3>
					<p>{item.subtitle}</p>
				</div>
				<span>{item.dateLabel || 'Sin fecha'}</span>
			</div>

			<div className="sales-opportunity-card__reason">{item.reason}</div>

			{chips.length ? (
				<div className="sales-opportunity-card__chips">
					{chips.map((chip) => (
						<span key={chip}>{chip}</span>
					))}
				</div>
			) : null}

			{Array.isArray(item.products) && item.products.length ? (
				<div className="sales-opportunity-card__products">
					{item.products.map((product) => (
						<span key={product}>{product}</span>
					))}
				</div>
			) : null}

			<div className="sales-opportunity-card__footer">
				<strong>{item.nextAction}</strong>
				{inboxLink ? <Link to={inboxLink}>Abrir inbox</Link> : null}
			</div>
		</article>
	);
}

function OpportunityGroup({ group, items = [] }) {
	return (
		<section className="sales-opportunity-group">
			<div className="sales-opportunity-group__header">
				<div>
					<h2>{group.title}</h2>
					<p>{group.description}</p>
				</div>
				{group.cta ? <Link to={group.cta}>{group.ctaLabel}</Link> : null}
			</div>

			{items.length ? (
				<div className="sales-opportunity-grid">
					{items.map((item) => (
						<OpportunityCard key={item.id} item={item} />
					))}
				</div>
			) : (
				<div className="sales-opportunity-empty">{group.empty}</div>
			)}
		</section>
	);
}

export default function SalesOpportunitiesPage() {
	const opportunitiesQuery = useQuery({
		queryKey: queryKeys.salesOpportunities,
		queryFn: async () => {
			const res = await api.get('/dashboard/sales-opportunities');
			return res.data;
		},
		...queryPresets.inbox,
	});

	const data = opportunitiesQuery.data || {};
	const summary = data.summary || {};
	const groups = data.groups || {};

	return (
		<div className="sales-opportunities-page">
			<section className="sales-opportunities-hero">
				<div>
					<span>Ventas</span>
					<h1>Oportunidades de venta</h1>
					<p>
						Priorizá carritos, pagos pendientes y conversaciones con intención comercial desde
						un solo tablero operativo.
					</p>
				</div>

				<div className="sales-opportunities-hero__actions">
					<Link to="/campaigns/segment">Nueva campaña</Link>
					<Link to="/inbox/atencion-humana">Ver atención humana</Link>
				</div>
			</section>

			<div className="sales-summary-grid">
				<div>
					<span>Carritos</span>
					<strong>{summary.abandonedCarts || 0}</strong>
				</div>
				<div>
					<span>Pagos pendientes</span>
					<strong>{summary.pendingPayments || 0}</strong>
				</div>
				<div>
					<span>Conversaciones calientes</span>
					<strong>{summary.hotConversations || 0}</strong>
				</div>
				<div>
					<span>Ingresos atribuidos</span>
					<strong>{summary.revenueLabel || '$ 0'}</strong>
				</div>
			</div>

			{opportunitiesQuery.isLoading ? (
				<div className="sales-opportunity-empty">Cargando oportunidades...</div>
			) : null}

			{opportunitiesQuery.isError ? (
				<div className="sales-opportunity-empty sales-opportunity-empty--error">
					No se pudieron cargar las oportunidades.
				</div>
			) : null}

			{!opportunitiesQuery.isLoading && !opportunitiesQuery.isError
				? GROUPS.map((group) => (
						<OpportunityGroup
							key={group.key}
							group={group}
							items={groups[group.key] || []}
						/>
				  ))
				: null}
		</div>
	);
}
