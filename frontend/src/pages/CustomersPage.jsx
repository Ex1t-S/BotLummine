import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api.js';
import './CustomersPage.css';

const initialFilters = {
	q: '',
	page: 1,
	sort: 'updated_desc',
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
		totalCustomers: Number(stats.totalCustomers || data.customers?.length || 0),
		withLastOrder: Number(stats.withLastOrder || 0),
		totalSpent: formatCurrency(stats.totalSpent || 0, stats.currency || 'ARS'),
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

export default function CustomersPage() {
	const [filters, setFilters] = useState(initialFilters);
	const [data, setData] = useState({
		customers: [],
		stats: {},
		pagination: { page: 1, totalPages: 1, totalItems: 0 },
	});
	const [loading, setLoading] = useState(true);
	const [syncing, setSyncing] = useState(false);
	const [errorMessage, setErrorMessage] = useState('');
	const [syncMessage, setSyncMessage] = useState('');

	const normalizedStats = useMemo(() => normalizeStats(data), [data]);
	const currentPage = Number(data.pagination?.page || 1);
	const totalPages = Number(data.pagination?.totalPages || 1);
	const visiblePages = useMemo(
		() => buildVisiblePages(currentPage, totalPages),
		[currentPage, totalPages]
	);

	async function loadCustomers(nextFilters = filters) {
		setLoading(true);
		setErrorMessage('');

		try {
			const response = await api.get('/dashboard/customers', {
				params: {
					q: nextFilters.q || '',
					page: nextFilters.page || 1,
					sort: nextFilters.sort || 'updated_desc',
				},
			});

			setData({
				customers: Array.isArray(response.data?.customers) ? response.data.customers : [],
				stats: response.data?.stats || {},
				pagination: response.data?.pagination || { page: 1, totalPages: 1, totalItems: 0 },
			});
		} catch (error) {
			console.error(error);

			const backendMissing =
				error?.response?.status === 404 ||
				error?.response?.status === 501 ||
				error?.response?.status === 500;

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
		loadCustomers(initialFilters);
		// eslint-disable-next-line react-hooks/exhaustive-deps
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
		setErrorMessage('');
		setFilters(initialFilters);
		await loadCustomers(initialFilters);
	}

	async function handleSync() {
		setSyncing(true);
		setSyncMessage('');
		setErrorMessage('');

		try {
			const res = await api.post('/dashboard/customers/sync', {
				q: filters.q || '',
			});

			const pagesFetched = Number(res.data?.pagesFetched || 0);
			const customersFetched = Number(res.data?.customersFetched || 0);
			const customersUpserted = Number(res.data?.customersUpserted || 0);

			setSyncMessage(
				`Sync terminada. Páginas leídas: ${pagesFetched}. Clientes leídos: ${customersFetched}. Clientes actualizados: ${customersUpserted}.`
			);

			const next = {
				...filters,
				page: 1,
			};

			setFilters(next);
			await loadCustomers(next);
		} catch (error) {
			console.error(error);
			setErrorMessage(
				error?.response?.data?.message || 'No se pudo sincronizar clientes.'
			);
		} finally {
			setSyncing(false);
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
				<div>
					<span className="customers-kicker">CRM COMERCIAL</span>
					<h1>Clientes</h1>
					<p>
						Acá vamos a concentrar cada cliente en una sola fila para después segmentarlos
						mejor en campañas.
					</p>
				</div>

				<button
					type="button"
					className="primary-action-btn"
					onClick={handleSync}
					disabled={syncing}
				>
					{syncing ? 'Sincronizando...' : 'Sincronizar clientes'}
				</button>
			</div>

			{errorMessage ? (
				<div className="customers-feedback customers-feedback--error">{errorMessage}</div>
			) : null}

			{syncMessage ? (
				<div className="customers-feedback customers-feedback--success">{syncMessage}</div>
			) : null}

			<div className="customers-stats-grid">
				<div className="customers-stat-card">
					<span className="customers-stat-label">Clientes</span>
					<strong>{normalizedStats.totalCustomers}</strong>
				</div>

				<div className="customers-stat-card">
					<span className="customers-stat-label">Con última orden</span>
					<strong>{normalizedStats.withLastOrder}</strong>
				</div>

				<div className="customers-stat-card">
					<span className="customers-stat-label">Facturación acumulada</span>
					<strong>{normalizedStats.totalSpent}</strong>
				</div>

				<div className="customers-stat-card">
					<span className="customers-stat-label">Mostrando</span>
					<strong>
						{normalizedStats.showingFrom}-{normalizedStats.showingTo}
					</strong>
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
						placeholder="Nombre, email, teléfono..."
					/>
				</div>

				<div className="customers-filter-group">
					<label htmlFor="customers-sort">Ordenar por</label>
					<select
						id="customers-sort"
						value={filters.sort}
						onChange={(event) => updateFilter('sort', event.target.value)}
					>
						<option value="updated_desc">Más recientes</option>
						<option value="name_asc">Nombre A-Z</option>
						<option value="name_desc">Nombre Z-A</option>
						<option value="spent_desc">Mayor gasto</option>
						<option value="spent_asc">Menor gasto</option>
					</select>
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

				{loading ? <div className="customers-empty-state">Cargando clientes...</div> : null}

				{!loading && !data.customers?.length ? (
					<div className="customers-empty-state">No hay clientes cargados todavía.</div>
				) : null}

				{!loading && data.customers?.length ? (
					<div className="customers-grid">
						{data.customers.map((customer) => (
							<article key={customer.id} className="customer-card">
								<div className="customer-card-topbar">
									<div className="customer-identity">
										<div className="customer-avatar">{customer.initials || '?'}</div>
										<div>
											<h4>{customer.displayName || 'Cliente sin nombre'}</h4>
											{customer.phone ? <p>{customer.phone}</p> : null}
											{customer.email ? <p>{customer.email}</p> : null}
										</div>
									</div>

									{customer.lastOrderId ? (
										<span className="customer-pill">Orden #{customer.lastOrderId}</span>
									) : (
										<span className="customer-pill customer-pill--muted">Sin última orden</span>
									)}
								</div>

								<div className="customer-metrics-grid">
									<div className="customer-metric-box">
										<span>Monto histórico</span>
										<strong>{customer.totalSpentLabel || '$0'}</strong>
									</div>

									<div className="customer-metric-box">
										<span>Última orden</span>
										<strong>{customer.lastOrderAtLabel || '-'}</strong>
									</div>

									<div className="customer-metric-box">
										<span>Actualizado</span>
										<strong>{customer.updatedAtLabel || '-'}</strong>
									</div>
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
