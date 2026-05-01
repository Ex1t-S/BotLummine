import { useMemo, useState } from 'react';
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
		ctaLabel: 'Crear campana',
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
		description: 'Chats con senales de intencion comercial o etapa avanzada.',
		empty: 'No hay conversaciones calientes detectadas.',
	},
	{
		key: 'humanFollowups',
		title: 'Seguimiento humano',
		description: 'Conversaciones que la IA o el flujo marcaron para atencion manual.',
		empty: 'No hay seguimientos humanos pendientes.',
	},
];

const FEED_FILTERS = [
	{ key: 'ALL', label: 'Todo' },
	{ key: 'CONVERSATIONS', label: 'Conversaciones' },
	{ key: 'CARTS', label: 'Carritos' },
	{ key: 'PAYMENTS', label: 'Pagos pendientes' },
	{ key: 'HUMAN', label: 'Humanos' },
];

function inboxLinkFor(item) {
	if (!item?.conversationId) return '';
	const slug = QUEUE_ROUTES[item.queue] || QUEUE_ROUTES.AUTO;
	return `/inbox/${slug}?conversation=${encodeURIComponent(item.conversationId)}`;
}

function matchesFeedFilter(item, filter) {
	if (filter === 'ALL') return true;
	if (filter === 'CONVERSATIONS') {
		return ['recent_conversation', 'hot_conversation'].includes(item.type);
	}
	if (filter === 'CARTS') return item.type === 'abandoned_cart';
	if (filter === 'PAYMENTS') return item.type === 'pending_payment';
	if (filter === 'HUMAN') return item.type === 'human_followup';
	return true;
}

function actionLinkFor(item) {
	const inboxLink = inboxLinkFor(item);
	if (inboxLink) return { to: inboxLink, label: 'Abrir inbox' };
	if (item.type === 'abandoned_cart') return { to: '/campaigns/segment', label: 'Crear campana' };
	if (item.type === 'pending_payment') return { to: '/campaigns/schedules', label: 'Programar seguimiento' };
	return null;
}

function OpportunityCard({ item }) {
	const actionLink = actionLinkFor(item);
	const context = item.commercialContext || {};
	const chips = [
		item.amountLabel,
		context.buyingIntentLevel ? `Intencion ${context.buyingIntentLevel}` : '',
		context.salesStage,
		context.frictionLevel ? `Friccion ${context.frictionLevel}` : '',
	]
		.filter(Boolean)
		.slice(0, 4);

	return (
		<article className="sales-opportunity-card">
			<div className="sales-opportunity-card__top">
				<div>
					<span className={`sales-type-pill sales-type-pill--${item.type}`}>
						{item.typeLabel || item.type}
					</span>
					<h3>{item.title}</h3>
					<p>{item.subtitle}</p>
				</div>
				<span>{item.activityLabel || item.dateLabel || 'Sin fecha'}</span>
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
				{actionLink ? <Link to={actionLink.to}>{actionLink.label}</Link> : null}
			</div>
		</article>
	);
}

function RecentActivityFeed({ items = [], activeFilter, onFilterChange }) {
	const filteredItems = useMemo(
		() => items.filter((item) => matchesFeedFilter(item, activeFilter)),
		[items, activeFilter]
	);

	return (
		<section className="sales-opportunity-group sales-recent-feed">
			<div className="sales-opportunity-group__header">
				<div>
					<h2>Actividad reciente</h2>
					<p>Lo ultimo que entro y requiere revisar: conversaciones, carritos y pagos pendientes.</p>
				</div>
			</div>

			<div className="sales-feed-filters" role="tablist" aria-label="Filtrar actividad reciente">
				{FEED_FILTERS.map((filter) => (
					<button
						key={filter.key}
						type="button"
						className={activeFilter === filter.key ? 'is-active' : ''}
						onClick={() => onFilterChange(filter.key)}
					>
						{filter.label}
					</button>
				))}
			</div>

			{filteredItems.length ? (
				<div className="sales-opportunity-grid sales-opportunity-grid--feed">
					{filteredItems.map((item) => (
						<OpportunityCard key={item.id} item={item} />
					))}
				</div>
			) : (
				<div className="sales-opportunity-empty">No hay actividad reciente para este filtro.</div>
			)}
		</section>
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
	const [activeFeedFilter, setActiveFeedFilter] = useState('ALL');
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
	const feed = data.feed || [];

	return (
		<div className="sales-opportunities-page">
			<section className="sales-opportunities-hero">
				<div>
					<span>Ventas</span>
					<h1>Oportunidades de venta</h1>
					<p>
						Prioriza conversaciones, carritos y pagos pendientes recientes desde un solo
						tablero operativo.
					</p>
				</div>

				<div className="sales-opportunities-hero__actions">
					<Link to="/campaigns/segment">Nueva campana</Link>
					<Link to="/inbox/atencion-humana">Ver atencion humana</Link>
				</div>
			</section>

			<div className="sales-summary-grid">
				<div>
					<span>Actividad reciente</span>
					<strong>{summary.recentFeed || 0}</strong>
				</div>
				<div>
					<span>Carritos</span>
					<strong>{summary.abandonedCarts || 0}</strong>
				</div>
				<div>
					<span>Pagos pendientes</span>
					<strong>{summary.pendingPayments || 0}</strong>
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

			{!opportunitiesQuery.isLoading && !opportunitiesQuery.isError ? (
				<>
					<RecentActivityFeed
						items={feed}
						activeFilter={activeFeedFilter}
						onFilterChange={setActiveFeedFilter}
					/>
					{GROUPS.map((group) => (
						<OpportunityGroup
							key={group.key}
							group={group}
							items={groups[group.key] || []}
						/>
					))}
				</>
			) : null}
		</div>
	);
}
