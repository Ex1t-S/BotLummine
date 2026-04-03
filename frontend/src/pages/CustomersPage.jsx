import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../lib/api.js';
import './CustomersPage.css';

const DEFAULT_PAGE_SIZE = 24;

const initialFilters = {
	q: '',
	productQuery: '',
	orderNumber: '',
	dateFrom: '',
	dateTo: '',
	paymentStatus: '',
	shippingStatus: '',
	minOrders: '',
	minSpent: '',
	hasPhoneOnly: false,
	hasOrders: true,
	sort: 'last_purchase_desc',
	page: 1,
	pageSize: DEFAULT_PAGE_SIZE,
};

function formatCurrency(value, currency = 'ARS') {
	const amount = Number(value || 0);

	try {
		return new Intl.NumberFormat('es-AR', {
			style: 'currency',
			currency: currency || 'ARS',
			maximumFractionDigits: 0,
		}).format(amount);
	} catch {
		return `$${amount.toLocaleString('es-AR')}`;
	}
}

function normalizeStats(data = {}) {
	const stats = data.stats || {};

	return {
		totalCustomers: Number(stats.totalCustomers || 0),
		repeatBuyers: Number(stats.repeatBuyers || 0),
		withOrders: Number(stats.withOrders || 0),
		totalOrders: Number(stats.totalOrders || 0),
		paidOrders: Number(stats.paidOrders || 0),
		totalSpentLabel: formatCurrency(stats.totalSpent || 0, stats.currency || 'ARS'),
		showingFrom: Number(stats.showingFrom || 0),
		showingTo: Number(stats.showingTo || 0),
	};
}

function buildVisiblePages(currentPage, totalPages) {
	if (totalPages <= 7) {
		return Array.from({ length: totalPages }, (_, index) => index + 1);
	}

	const pages = [1];
	const start = Math.max(2, currentPage - 1);
	const end = Math.min(totalPages - 1, currentPage + 1);

	if (start > 2) pages.push('left-ellipsis');
	for (let page = start; page <= end; page += 1) pages.push(page);
	if (end < totalPages - 1) pages.push('right-ellipsis');
	pages.push(totalPages);

	return pages;
}

function normalizeRequestFilters(filters) {
	return {
		q: filters.q || '',
		productQuery: filters.productQuery || '',
		orderNumber: filters.orderNumber || '',
		dateFrom: filters.dateFrom || '',
		dateTo: filters.dateTo || '',
		paymentStatus: filters.paymentStatus || '',
		shippingStatus: filters.shippingStatus || '',
		minOrders: filters.minOrders || '',
		minSpent: filters.minSpent || '',
		hasPhoneOnly: filters.hasPhoneOnly ? '1' : '',
		hasOrders: filters.hasOrders ? '1' : '',
		sort: filters.sort || 'last_purchase_desc',
		page: filters.page || 1,
		pageSize: filters.pageSize || DEFAULT_PAGE_SIZE,
	};
}

function formatDateTime(value) {
	if (!value) return '-';

	try {
		return new Intl.DateTimeFormat('es-AR', {
			dateStyle: 'short',
			timeStyle: 'short',
		}).format(new Date(value));
	} catch {
		return String(value);
	}
}

function formatDurationMs(value) {
	const totalMs = Number(value || 0);
	if (!Number.isFinite(totalMs) || totalMs <= 0) return '0s';

	const totalSeconds = Math.floor(totalMs / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function buildSyncMessage(payload = {}) {
	const customersFetched = Number(payload.customersFetched || 0);
	const customersUpserted = Number(payload.customersUpserted || 0);
	const ordersFetched = Number(payload.ordersFetched || 0);
	const ordersUpserted = Number(payload.ordersUpserted || 0);
	const pagesFetched = Number(payload.pagesFetched || 0);
	const durationLabel = formatDurationMs(payload.durationMs || 0);

	return `Sync lista · páginas ${pagesFetched} · clientes leídos ${customersFetched} · perfiles tocados ${customersUpserted} · pedidos leídos ${ordersFetched} · pedidos guardados ${ordersUpserted} · duración ${durationLabel}.`;
}

export default function CustomersPage() {
	const [filters, setFilters] = useState(initialFilters);
	const [data, setData] = useState({
		customers: [],
		stats: {},
		pagination: { page: 1, totalPages: 1, totalItems: 0, pageSize: DEFAULT_PAGE_SIZE },
		filters: initialFilters,
	});
	const [loading, setLoading] = useState(true);
	const [syncing, setSyncing] = useState(false);
	const [errorMessage, setErrorMessage] = useState('');
	const [syncMessage, setSyncMessage] = useState('');
	const [syncDetails, setSyncDetails] = useState(null);
	const syncPollRef = useRef(null);

	const normalizedStats = useMemo(() => normalizeStats(data), [data]);
	const currentPage = Number(data.pagination?.page || 1);
	const totalPages = Number(data.pagination?.totalPages || 1);
	const visiblePages = useMemo(
		() => buildVisiblePages(currentPage, totalPages),
		[currentPage, totalPages]
	);

	async function fetchSyncState({ silent = false } = {}) {
		try {
			const response = await api.get('/dashboard/customers/sync-state');
			const payload = response.data || {};
			setSyncDetails(payload);

			if (payload.running) {
				setSyncing(true);
				if (!silent) {
					setSyncMessage('Sincronización en curso. Podés seguir usando la pantalla mientras termina.');
				}
				return payload;
			}

			if (payload.lastResult) {
				setSyncMessage(buildSyncMessage(payload.lastResult));
				setSyncing(false);
				return payload;
			}

			if (payload.lastError) {
				setErrorMessage(payload.lastError);
				setSyncing(false);
			}

			return payload;
		} catch (error) {
			console.error(error);
			setSyncing(false);
			return null;
		}
	}

	async function loadCustomers(nextFilters = filters) {
		setLoading(true);
		setErrorMessage('');

		try {
			const response = await api.get('/dashboard/customers', {
				params: normalizeRequestFilters(nextFilters),
			});

			setData({
				customers: Array.isArray(response.data?.customers) ? response.data.customers : [],
				stats: response.data?.stats || {},
				pagination:
					response.data?.pagination || {
						page: 1,
						totalPages: 1,
						totalItems: 0,
						pageSize: DEFAULT_PAGE_SIZE,
					},
				filters: response.data?.filters || nextFilters,
			});
		} catch (error) {
			console.error(error);
			setErrorMessage(error?.response?.data?.message || 'No se pudieron cargar los clientes.');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		loadCustomers(initialFilters);
		fetchSyncState({ silent: true });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (!syncing) {
			if (syncPollRef.current) {
				clearInterval(syncPollRef.current);
				syncPollRef.current = null;
			}
			return undefined;
		}

		const poll = async () => {
			const state = await fetchSyncState({ silent: true });
			if (!state?.running) {
				setSyncing(false);
				await loadCustomers({ ...filters, page: 1 });
			}
		};

		syncPollRef.current = setInterval(poll, 3000);
		poll();

		return () => {
			if (syncPollRef.current) {
				clearInterval(syncPollRef.current);
				syncPollRef.current = null;
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [syncing]);

	function updateFilter(name, value) {
		setFilters((prev) => ({
			...prev,
			[name]: value,
		}));
	}

	async function handleApplyFilters(event) {
		event.preventDefault();

		const next = {
			...filters,
			page: 1,
		};

		setFilters(next);
		await loadCustomers(next);
	}

	async function handleResetFilters() {
		setSyncMessage('');
		setErrorMessage('');
		setFilters(initialFilters);
		await loadCustomers(initialFilters);
	}

	async function handleSync() {
		setSyncMessage('');
		setErrorMessage('');

		try {
			const response = await api.post('/dashboard/customers/sync', {
				q: filters.q || '',
				dateFrom: filters.dateFrom || '',
				dateTo: filters.dateTo || '',
			});

			setSyncDetails(response.data || null);
			setSyncing(true);
			setSyncMessage('Sincronización iniciada. Te aviso cuando termine y refresco la grilla solo.');
		} catch (error) {
			console.error(error);
			setSyncing(Boolean(error?.response?.data?.running));
			setErrorMessage(
				error?.response?.data?.message ||
					'No se pudo sincronizar clientes. Revisá credenciales de Tiendanube y migraciones de Prisma.'
			);
		}
	}

	async function handlePageChange(page) {
		if (page < 1 || page > totalPages || page === currentPage) return;

		const next = {
			...filters,
			page,
		};

		setFilters(next);
		await loadCustomers(next);
	}

	return (
		<section className="customers-page">
			<div className="customers-hero-card">
				<div className="customers-hero-copy">
					<span className="customers-kicker">CRM CLIENTES</span>
					<h1>Clientes y compras</h1>
					<p>
						Panel comercial para segmentar mejor por producto, número real de pedido,
						fechas de compra, pago y envío. La sync corre en paralelo desde backend,
						así que no hace falta dejar esta vista colgada con bloqueos raros.
					</p>
				</div>

				<div className="customers-hero-actions">
					<button
						type="button"
						className="primary-action-btn"
						onClick={handleSync}
						disabled={syncing}
					>
						{syncing ? 'Sincronizando...' : 'Sincronizar clientes y pedidos'}
					</button>

					<button
						type="button"
						className="secondary-link-btn"
						onClick={handleResetFilters}
					>
						Limpiar filtros
					</button>
				</div>
			</div>

			{errorMessage ? (
				<div className="customers-feedback customers-feedback--error">{errorMessage}</div>
			) : null}

			{syncMessage ? (
				<div className="customers-feedback customers-feedback--success">{syncMessage}</div>
			) : null}

			{syncDetails?.running ? (
				<div className="customers-feedback customers-feedback--info">
					Sync corriendo desde backend. No hace falta recargar la página.
				</div>
			) : null}

			<div className="customers-stats-grid">
				<div className="customers-stat-card">
					<span className="customers-stat-label">Clientes</span>
					<strong>{normalizedStats.totalCustomers}</strong>
				</div>

				<div className="customers-stat-card">
					<span className="customers-stat-label">Con pedidos</span>
					<strong>{normalizedStats.withOrders}</strong>
				</div>

				<div className="customers-stat-card">
					<span className="customers-stat-label">Compradores repetidos</span>
					<strong>{normalizedStats.repeatBuyers}</strong>
				</div>

				<div className="customers-stat-card">
					<span className="customers-stat-label">Pedidos</span>
					<strong>{normalizedStats.totalOrders}</strong>
				</div>

				<div className="customers-stat-card">
					<span className="customers-stat-label">Pagados</span>
					<strong>{normalizedStats.paidOrders}</strong>
				</div>

				<div className="customers-stat-card">
					<span className="customers-stat-label">Facturación</span>
					<strong>{normalizedStats.totalSpentLabel}</strong>
				</div>
			</div>

			<form className="customers-filters-card" onSubmit={handleApplyFilters}>
				<div className="customers-filters-header">
					<div>
						<h3>Filtros comerciales</h3>
						<p>Buscá clientes, pedidos y productos sin depender del ID largo de Tiendanube.</p>
					</div>
				</div>

				<div className="customers-filter-grid">
					<div className="customers-filter-group customers-filter-group--grow">
						<label htmlFor="customers-q">Buscar cliente</label>
						<input
							id="customers-q"
							type="text"
							value={filters.q}
							onChange={(event) => updateFilter('q', event.target.value)}
							placeholder="Nombre, email, teléfono, DNI o nro. de pedido"
						/>
					</div>

					<div className="customers-filter-group">
						<label htmlFor="customers-product">Producto comprado</label>
						<input
							id="customers-product"
							type="text"
							value={filters.productQuery}
							onChange={(event) => updateFilter('productQuery', event.target.value)}
							placeholder="Body, calza, pack 2x1..."
						/>
					</div>

					<div className="customers-filter-group">
						<label htmlFor="customers-order-number">N° pedido</label>
						<input
							id="customers-order-number"
							type="text"
							value={filters.orderNumber}
							onChange={(event) => updateFilter('orderNumber', event.target.value)}
							placeholder="Ej: 23015"
						/>
					</div>

					<div className="customers-filter-group">
						<label htmlFor="customers-date-from">Compra desde</label>
						<input
							id="customers-date-from"
							type="date"
							value={filters.dateFrom}
							onChange={(event) => updateFilter('dateFrom', event.target.value)}
						/>
					</div>

					<div className="customers-filter-group">
						<label htmlFor="customers-date-to">Compra hasta</label>
						<input
							id="customers-date-to"
							type="date"
							value={filters.dateTo}
							onChange={(event) => updateFilter('dateTo', event.target.value)}
						/>
					</div>

					<div className="customers-filter-group">
						<label htmlFor="customers-payment-status">Pago</label>
						<select
							id="customers-payment-status"
							value={filters.paymentStatus}
							onChange={(event) => updateFilter('paymentStatus', event.target.value)}
						>
							<option value="">Todos</option>
							<option value="paid">Pagado</option>
							<option value="pending">Pendiente</option>
							<option value="authorized">Autorizado</option>
							<option value="refunded">Reintegrado</option>
							<option value="voided">Anulado</option>
							<option value="abandoned">Abandonado</option>
						</select>
					</div>

					<div className="customers-filter-group">
						<label htmlFor="customers-shipping-status">Envío</label>
						<select
							id="customers-shipping-status"
							value={filters.shippingStatus}
							onChange={(event) => updateFilter('shippingStatus', event.target.value)}
						>
							<option value="">Todos</option>
							<option value="fulfilled">Enviado</option>
							<option value="unfulfilled">No enviado</option>
							<option value="unpacked">Sin preparar</option>
						</select>
					</div>

					<div className="customers-filter-group">
						<label htmlFor="customers-min-orders">Pedidos mínimos</label>
						<input
							id="customers-min-orders"
							type="number"
							min="0"
							value={filters.minOrders}
							onChange={(event) => updateFilter('minOrders', event.target.value)}
							placeholder="2"
						/>
					</div>

					<div className="customers-filter-group">
						<label htmlFor="customers-min-spent">Gasto mínimo</label>
						<input
							id="customers-min-spent"
							type="number"
							min="0"
							step="1"
							value={filters.minSpent}
							onChange={(event) => updateFilter('minSpent', event.target.value)}
							placeholder="50000"
						/>
					</div>

					<div className="customers-filter-group">
						<label htmlFor="customers-sort">Ordenar por</label>
						<select
							id="customers-sort"
							value={filters.sort}
							onChange={(event) => updateFilter('sort', event.target.value)}
						>
							<option value="last_purchase_desc">Última compra reciente</option>
							<option value="last_purchase_asc">Última compra antigua</option>
							<option value="first_purchase_desc">Primera compra reciente</option>
							<option value="first_purchase_asc">Primera compra antigua</option>
							<option value="orders_desc">Más pedidos</option>
							<option value="orders_asc">Menos pedidos</option>
							<option value="spent_desc">Mayor gasto</option>
							<option value="spent_asc">Menor gasto</option>
							<option value="name_asc">Nombre A-Z</option>
							<option value="name_desc">Nombre Z-A</option>
						</select>
					</div>
				</div>

				<div className="customers-toggle-row">
					<div className="customers-toggle-group">
						<label className="customers-checkbox">
							<input
								type="checkbox"
								checked={filters.hasOrders}
								onChange={(event) => updateFilter('hasOrders', event.target.checked)}
							/>
							<span>Solo clientes con pedidos</span>
						</label>

						<label className="customers-checkbox">
							<input
								type="checkbox"
								checked={filters.hasPhoneOnly}
								onChange={(event) => updateFilter('hasPhoneOnly', event.target.checked)}
							/>
							<span>Solo con teléfono</span>
						</label>
					</div>

					<div className="customers-filter-actions">
						<button type="submit" className="secondary-link-btn customers-apply-btn">
							Aplicar filtros
						</button>
					</div>
				</div>
			</form>

			<div className="customers-list-card">
				<div className="customers-list-topbar">
					<div>
						<h3>Listado comercial</h3>
						<p>
							Mostrando {normalizedStats.showingFrom}-{normalizedStats.showingTo} de{' '}
							{data.pagination?.totalItems || 0}
						</p>
					</div>
				</div>

				{loading ? (
					<div className="customers-empty-state">Cargando clientes...</div>
				) : null}

				{!loading && !data.customers?.length ? (
					<div className="customers-empty-state">
						No hay clientes para esos filtros. Probá ampliar la búsqueda o ejecutar una
						sync completa.
					</div>
				) : null}

				{!loading && data.customers?.length ? (
					<div className="customers-grid">
						{data.customers.map((customer) => (
							<article key={customer.id} className="customer-card">
								<div className="customer-card-topbar">
									<div className="customer-identity">
										<div className="customer-avatar">{customer.initials || '?'}</div>

										<div className="customer-identity-copy">
											<h4>{customer.displayName || 'Cliente sin nombre'}</h4>
											{customer.phone ? <p>{customer.phone}</p> : null}
											{customer.email ? <p>{customer.email}</p> : null}
										</div>
									</div>

									<div className="customer-order-badge">
										<span>Último pedido</span>
										<strong>{customer.lastOrderLabel || '-'}</strong>
									</div>
								</div>

								<div className="customer-meta-row">
									<div className="customer-meta-chip">
										<span>Gasto total</span>
										<strong>{customer.totalSpentLabel || '$0'}</strong>
									</div>

									<div className="customer-meta-chip">
										<span>Pedidos</span>
										<strong>{customer.orderCount || 0}</strong>
									</div>

									<div className="customer-meta-chip">
										<span>Unidades</span>
										<strong>{customer.totalUnitsPurchased || 0}</strong>
									</div>

									<div className="customer-meta-chip">
										<span>Primera compra</span>
										<strong>{customer.firstOrderDateLabel || '-'}</strong>
									</div>

									<div className="customer-meta-chip">
										<span>Última compra</span>
										<strong>{customer.lastOrderDateLabel || '-'}</strong>
									</div>

									<div className="customer-meta-chip">
										<span>Estado</span>
										<strong>{customer.lastOrderStatusLabel || '-'}</strong>
									</div>
								</div>

								<div className="customer-section-box">
									<div className="customer-section-header">
										<span>Productos del último pedido</span>
										<strong>{customer.lastOrderLabel || '-'}</strong>
									</div>

									{customer.lastOrderProductsPreview?.length ? (
										<ul className="customer-products-list">
											{customer.lastOrderProductsPreview.map((product) => (
												<li key={`${customer.id}-last-${product}`}>{product}</li>
											))}
										</ul>
									) : (
										<p className="customer-products-empty">
											No quedó guardado el detalle del último pedido todavía.
										</p>
									)}
								</div>

								<div className="customer-section-box customer-section-box--soft">
									<div className="customer-section-header">
										<span>Productos más comprados</span>
										<strong>{customer.distinctProductsCount || 0} distintos</strong>
									</div>

									{customer.topProductsPreview?.length ? (
										<div className="customer-tag-list">
											{customer.topProductsPreview.map((product) => (
												<span key={`${customer.id}-top-${product}`} className="customer-tag">
													{product}
												</span>
											))}
										</div>
									) : (
										<p className="customer-products-empty">
											Todavía no hay resumen histórico de productos.
										</p>
									)}
								</div>

								<div className="customer-footer-row">
									<span>Actualizado</span>
									<strong>{formatDateTime(customer.updatedAt)}</strong>
								</div>
							</article>
						))}
					</div>
				) : null}

				{totalPages > 1 ? (
					<div className="pagination-row compact-pagination">
						<button
							type="button"
							className="page-pill nav-pill"
							onClick={() => handlePageChange(currentPage - 1)}
							disabled={currentPage === 1}
						>
							← Anterior
						</button>

						<div className="pagination-pages">
							{visiblePages.map((item) => {
								if (typeof item !== 'number') {
									return (
										<span key={item} className="page-ellipsis">
											…
										</span>
									);
								}

								return (
									<button
										key={item}
										type="button"
										className={`page-pill${item === currentPage ? ' active' : ''}`}
										onClick={() => handlePageChange(item)}
									>
										{item}
									</button>
								);
							})}
						</div>

						<button
							type="button"
							className="page-pill nav-pill"
							onClick={() => handlePageChange(currentPage + 1)}
							disabled={currentPage === totalPages}
						>
							Siguiente →
						</button>
					</div>
				) : null}
			</div>
		</section>
	);
}
