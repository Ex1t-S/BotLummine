import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api.js';
import './CustomersPage.css';

const initialFilters = {
	q: '',
	page: 1,
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

function formatDate(value) {
	if (!value) return '-';

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '-';

	return new Intl.DateTimeFormat('es-AR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
	}).format(date);
}

function getInitials(value = '') {
	return (
		String(value || '')
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part.charAt(0).toUpperCase())
			.join('') || '?'
	);
}

function getVisiblePages(currentPage, totalPages) {
	const pages = [];

	if (totalPages <= 7) {
		for (let i = 1; i <= totalPages; i += 1) {
			pages.push(i);
		}

		return pages;
	}

	pages.push(1);

	const start = Math.max(2, currentPage - 1);
	const end = Math.min(totalPages - 1, currentPage + 1);

	if (start > 2) {
		pages.push('left-ellipsis');
	}

	for (let i = start; i <= end; i += 1) {
		pages.push(i);
	}

	if (end < totalPages - 1) {
		pages.push('right-ellipsis');
	}

	pages.push(totalPages);

	return pages;
}

function normalizeStats(data = {}) {
	const stats = data.stats || {};

	return {
		totalCustomers: Number(stats.totalCustomers || data.customers?.length || 0),
		repeatBuyers: Number(stats.repeatBuyers || 0),
		totalOrders: Number(stats.totalOrders || 0),
		totalSpent: formatCurrency(stats.totalSpent || 0, stats.currency || 'ARS'),
		showingFrom: Number(stats.showingFrom || 0),
		showingTo: Number(stats.showingTo || 0),
	};
}

export default function CustomersPage() {
	const [loading, setLoading] = useState(true);
	const [syncing, setSyncing] = useState(false);
	const [filters, setFilters] = useState(initialFilters);
	const [errorMessage, setErrorMessage] = useState('');
	const [syncMessage, setSyncMessage] = useState('');
	const [data, setData] = useState({
		customers: [],
		stats: {
			totalCustomers: 0,
			repeatBuyers: 0,
			totalOrders: 0,
			totalSpent: 0,
			currency: 'ARS',
			showingFrom: 0,
			showingTo: 0,
		},
		pagination: {
			page: 1,
			totalPages: 1,
		},
	});

	async function loadCustomers(nextFilters = filters) {
		setLoading(true);
		setErrorMessage('');

		try {
			const res = await api.get('/dashboard/customers', {
				params: nextFilters,
			});

			setData({
				customers: Array.isArray(res.data?.customers) ? res.data.customers : [],
				stats: res.data?.stats || {},
				pagination: res.data?.pagination || { page: 1, totalPages: 1 },
			});
		} catch (error) {
			console.error(error);

			const backendMissing =
				error?.response?.status === 404 ||
				error?.response?.status === 501 ||
				error?.response?.status === 500;

			setData({
				customers: [],
				stats: {
					totalCustomers: 0,
					repeatBuyers: 0,
					totalOrders: 0,
					totalSpent: 0,
					currency: 'ARS',
					showingFrom: 0,
					showingTo: 0,
				},
				pagination: {
					page: 1,
					totalPages: 1,
				},
			});

			setErrorMessage(
				backendMissing
					? 'La sección ya está visible en el frontend, pero el backend de clientes todavía no está conectado.'
					: 'No se pudieron cargar los clientes.'
			);
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		loadCustomers(filters);
	}, []);

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
		setFilters(initialFilters);
		await loadCustomers(initialFilters);
	}

	async function handleSync() {
		setSyncing(true);
		setSyncMessage('');
		setErrorMessage('');

		try {
			const res = await api.post('/dashboard/customers/sync', {
				fullSync: true,
			});

			const customersTouched = Number(res.data?.customersTouched || 0);
			const ordersUpserted = Number(res.data?.ordersUpserted || 0);

			setSyncMessage(
				`Sync terminada. Clientes tocados: ${customersTouched}. Órdenes procesadas: ${ordersUpserted}.`
			);

			await loadCustomers({
				...filters,
				page: 1,
			});
		} catch (error) {
			console.error(error);

			const backendMissing =
				error?.response?.status === 404 ||
				error?.response?.status === 501 ||
				error?.response?.status === 500;

			setErrorMessage(
				backendMissing
					? 'El botón ya está listo en el frontend, pero la sync de clientes todavía no existe del lado backend.'
					: 'No se pudo sincronizar clientes.'
			);
		} finally {
			setSyncing(false);
		}
	}

	async function handlePageChange(nextPage) {
		const totalPages = Number(data.pagination?.totalPages || 1);

		if (nextPage < 1 || nextPage > totalPages || nextPage === filters.page) {
			return;
		}

		const next = {
			...filters,
			page: nextPage,
		};

		setFilters(next);
		await loadCustomers(next);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	const normalizedStats = useMemo(() => normalizeStats(data), [data]);
	const currentPage = Number(data.pagination?.page || 1);
	const totalPages = Number(data.pagination?.totalPages || 1);
	const visiblePages = getVisiblePages(currentPage, totalPages);

	return (
		<section className="customers-page">
			<div className="customers-header-card">
				<div className="customers-header-copy">
					<div className="section-eyebrow">CRM comercial</div>
					<h2>Clientes</h2>
					<p>
						Acá vamos a concentrar cada cliente en una sola fila, unificando
						todas sus compras para después segmentarlos mejor en campañas.
					</p>
				</div>

				<div className="customers-header-actions">
					<button
						type="button"
						className="primary-action-btn"
						onClick={handleSync}
						disabled={syncing}
					>
						{syncing ? 'Sincronizando...' : 'Sincronizar clientes'}
					</button>
				</div>
			</div>

			{errorMessage ? (
				<div className="customers-feedback customers-feedback--error">
					{errorMessage}
				</div>
			) : null}

			{syncMessage ? (
				<div className="customers-feedback customers-feedback--success">
					{syncMessage}
				</div>
			) : null}

			<div className="customers-stats-grid">
				<div className="customers-stat-card">
					<span className="customers-stat-label">Clientes</span>
					<strong>{normalizedStats.totalCustomers}</strong>
				</div>

				<div className="customers-stat-card">
					<span className="customers-stat-label">Compradores recurrentes</span>
					<strong>{normalizedStats.repeatBuyers}</strong>
				</div>

				<div className="customers-stat-card">
					<span className="customers-stat-label">Órdenes acumuladas</span>
					<strong>{normalizedStats.totalOrders}</strong>
				</div>

				<div className="customers-stat-card">
					<span className="customers-stat-label">Facturación acumulada</span>
					<strong>{normalizedStats.totalSpent}</strong>
				</div>
			</div>

			<form className="customers-filters-card" onSubmit={handleApplyFilters}>
				<div className="customers-filter-group customers-filter-group--grow">
					<label htmlFor="customers-q">Buscar</label>
					<input
						id="customers-q"
						type="text"
						value={filters.q}
						onChange={(event) => updateFilter('q', event.target.value)}
						placeholder="Nombre, email, teléfono, producto..."
					/>
				</div>

				<div className="customers-filter-actions">
					<button type="submit" className="secondary-link-btn">
						Aplicar
					</button>

					<button
						type="button"
						className="secondary-link-btn"
						onClick={handleResetFilters}
					>
						Limpiar
					</button>
				</div>
			</form>

			<div className="customers-list-card">
				<div className="customers-list-topbar">
					<div>
						<h3>Listado de clientes</h3>
						<p>
							Mostrando {normalizedStats.showingFrom}-{normalizedStats.showingTo}
						</p>
					</div>
				</div>

				{loading ? (
					<div className="customers-empty-state">Cargando clientes...</div>
				) : null}

				{!loading && !data.customers?.length ? (
					<div className="customers-empty-state">
						No hay clientes cargados todavía.
					</div>
				) : null}

				{!loading && data.customers?.length ? (
					<div className="customers-grid">
						{data.customers.map((customer) => {
							const displayName =
								customer.displayName ||
								customer.name ||
								customer.contactName ||
								'Sin nombre';

							const email =
								customer.email ||
								customer.contactEmail ||
								'Sin email';

							const phone =
								customer.phone ||
								customer.contactPhone ||
								'Sin teléfono';

							const orderCount = Number(customer.orderCount || 0);
							const distinctProductsCount = Number(customer.distinctProductsCount || 0);
							const totalSpentLabel =
								customer.totalSpentLabel ||
								formatCurrency(customer.totalSpent || 0, customer.currency || 'ARS');

							const lastOrderAtLabel =
								customer.lastOrderAtLabel || formatDate(customer.lastOrderAt);

							const productSummary = Array.isArray(customer.productSummary)
								? customer.productSummary
								: [];

							const previewProducts = productSummary.slice(0, 4);

							return (
								<article key={customer.id || `${email}-${phone}`} className="customer-card">
									<div className="customer-card-top">
										<div className="customer-avatar">
											{customer.initials || getInitials(displayName)}
										</div>

										<div className="customer-card-top-copy">
											<h4>{displayName}</h4>
											<p>{phone}</p>
											<p>{email}</p>
										</div>

										<div className="customer-badges">
											<span className="customer-badge">
												{orderCount} compra{orderCount === 1 ? '' : 's'}
											</span>

											{orderCount > 1 ? (
												<span className="customer-badge customer-badge--repeat">
													Recurrente
												</span>
											) : null}
										</div>
									</div>

									<div className="customer-metrics">
										<div className="customer-metric">
											<span>Total gastado</span>
											<strong>{totalSpentLabel}</strong>
										</div>

										<div className="customer-metric">
											<span>Última compra</span>
											<strong>{lastOrderAtLabel}</strong>
										</div>

										<div className="customer-metric">
											<span>Productos distintos</span>
											<strong>{distinctProductsCount}</strong>
										</div>
									</div>

									{previewProducts.length ? (
										<div className="customer-products-block">
											<span className="customer-products-title">
												Productos comprados
											</span>

											<div className="customer-products-list">
												{previewProducts.map((product, index) => (
													<span
														key={`${customer.id || displayName}-product-${index}`}
														className="customer-product-pill"
													>
														{product.name || 'Producto'}
														{product.unitsPurchased
															? ` · ${product.unitsPurchased}`
															: ''}
													</span>
												))}
											</div>

											{productSummary.length > 4 ? (
												<p className="customer-products-more">
													+{productSummary.length - 4} producto
													{productSummary.length - 4 === 1 ? '' : 's'} más
												</p>
											) : null}
										</div>
									) : (
										<div className="customer-products-block customer-products-block--empty">
											Sin resumen de productos todavía.
										</div>
									)}
								</article>
							);
						})}
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