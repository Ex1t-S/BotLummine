import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';
import './CustomersPage.css';

const DEFAULT_PAGE_SIZE = 24;
const POLL_MS = 3500;

const initialFilters = {
	q: '',
	productQuery: '',
	orderNumber: '',
	dateFrom: '',
	dateTo: '',
	paymentStatus: '',
	minSpent: '',
	hasPhoneOnly: false,
	sort: 'purchase_desc',
	page: 1,
	pageSize: DEFAULT_PAGE_SIZE,
};

const initialSyncStatus = {
	running: false,
	phase: 'idle',
	message: '',
	pagesFetched: 0,
	ordersFetched: 0,
	ordersUpserted: 0,
	itemsUpserted: 0,
	warnings: [],
	errors: [],
	hasMoreHistory: false,
	activeWindow: null,
	finishedAt: null,
	startedAt: null,
};

function useDebouncedValue(value, delay = 350) {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timeout = window.setTimeout(() => setDebounced(value), delay);
		return () => window.clearTimeout(timeout);
	}, [value, delay]);

	return debounced;
}

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


function formatPaymentStatusLabel(value) {
	const key = String(value || '').trim().toLowerCase();
	const labels = {
		pending: 'Pendiente',
		authorized: 'Autorizado',
		paid: 'Pagado',
		partially_paid: 'Parcial',
		abandoned: 'Abandonado',
		refunded: 'Reembolsado',
		partially_refunded: 'Reembolso parcial',
		voided: 'Anulado',
	};

	return labels[key] || (value ? String(value) : 'Sin dato');
}

function getPaymentStatusTone(value) {
	const key = String(value || '').trim().toLowerCase();

	if (key === 'paid') return 'is-paid';
	if (key === 'authorized' || key === 'partially_paid') return 'is-authorized';
	if (key === 'pending') return 'is-pending';
	if (key === 'refunded' || key === 'partially_refunded' || key === 'voided') return 'is-refunded';
	if (key === 'abandoned') return 'is-abandoned';
	return 'is-neutral';
}

function normalizeStats(payload = {}) {
	const stats = payload.stats || {};
	return {
		totalOrders: Number(stats.totalOrders ?? 0),
		totalCustomers: Number(stats.totalCustomers ?? 0),
		withPhone: Number(stats.withPhone ?? 0),
		totalSpentLabel: formatCurrency(stats.totalSpent ?? 0, stats.currency || 'ARS'),
		avgTicketLabel: formatCurrency(stats.avgTicket ?? 0, stats.currency || 'ARS'),
		showingFrom: Number(stats.showingFrom || 0),
		showingTo: Number(stats.showingTo || 0),
	};
}

function buildVisiblePages(currentPage, totalPages) {
	if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
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
		minSpent: filters.minSpent || '',
		hasPhoneOnly: filters.hasPhoneOnly ? '1' : '',
		sort: filters.sort || 'purchase_desc',
		page: filters.page || 1,
		pageSize: filters.pageSize || DEFAULT_PAGE_SIZE,
	};
}

function formatDuration(startedAt) {
	if (!startedAt) return '0s';
	const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function buildSyncBadgeLabel(syncStatus) {
	if (syncStatus.running) return 'Sincronizando en vivo';
	if (syncStatus.errors?.length) return 'Sync con errores';
	if (syncStatus.hasMoreHistory) return 'Histórico pendiente';
	return 'Listo';
}

function buildCatalogProducts(rawCatalog = []) {
	const seen = new Set();
	const options = [];

	for (const item of rawCatalog) {
		const label =
			item?.name ||
			item?.title ||
			item?.productName ||
			item?.displayName ||
			'';

		const normalized = String(label || '').trim();
		if (!normalized) continue;
		if (seen.has(normalized.toLowerCase())) continue;

		seen.add(normalized.toLowerCase());
		options.push({
			id: item?.id || item?.productId || normalized,
			label: normalized,
		});
	}

	return options.sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

function ProductMultiSelect({
	options,
	selectedValues,
	search,
	onSearchChange,
	onToggleValue,
	onClear,
}) {
	const filtered = useMemo(() => {
		const term = String(search || '').trim().toLowerCase();
		if (!term) return options.slice(0, 80);
		return options
			.filter((option) => option.label.toLowerCase().includes(term))
			.slice(0, 80);
	}, [options, search]);

	return (
		<div className="product-multiselect">
			<input
				type="text"
				className="product-multiselect-search"
				placeholder="Buscar productos del catálogo..."
				value={search}
				onChange={(event) => onSearchChange(event.target.value)}
			/>

			<div className="product-multiselect-list">
				{filtered.length ? (
					filtered.map((option) => {
						const checked = selectedValues.includes(option.label);
						return (
							<label key={option.id} className="product-option-row">
								<input
									type="checkbox"
									checked={checked}
									onChange={() => onToggleValue(option.label)}
								/>
								<span>{option.label}</span>
							</label>
						);
					})
				) : (
					<div className="product-option-empty">No hay coincidencias en el catálogo.</div>
				)}
			</div>

			<div className="product-multiselect-footer">
				<button type="button" className="secondary-link-btn" onClick={onClear}>
					Limpiar productos
				</button>
			</div>
		</div>
	);
}

function EyeToggleIcon({ hidden = false }) {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true" className="customers-visibility-icon">
			<path
				d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.8"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle
				cx="12"
				cy="12"
				r="3"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.8"
			/>
			{hidden ? (
				<path
					d="M4 4l16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
				/>
			) : null}
		</svg>
	);
}

export default function CustomersPage() {
	const queryClient = useQueryClient();
	const [filters, setFilters] = useState(initialFilters);
	const [errorMessage, setErrorMessage] = useState('');
	const [selectedProducts, setSelectedProducts] = useState([]);
	const [productSearch, setProductSearch] = useState('');
	const [showProductFilter, setShowProductFilter] = useState(false);
	const [billingVisible, setBillingVisible] = useState(true);
	const debouncedFilters = useDebouncedValue(filters);
	const requestFilters = useMemo(
		() => normalizeRequestFilters(debouncedFilters),
		[debouncedFilters]
	);

	const customersQuery = useQuery({
		queryKey: queryKeys.customers(requestFilters),
		queryFn: async () => {
			const response = await api.get('/dashboard/customers', {
				params: requestFilters,
			});

			return {
				customers: Array.isArray(response.data?.customers) ? response.data.customers : [],
				stats: response.data?.stats || {},
				pagination: {
					page: Number(response.data?.pagination?.page || 1),
					totalPages: Number(response.data?.pagination?.totalPages || 1),
					totalItems: Number(response.data?.pagination?.totalItems || 0),
					pageSize: Number(response.data?.pagination?.pageSize || DEFAULT_PAGE_SIZE),
				},
			};
		},
		placeholderData: keepPreviousData,
		...queryPresets.customers,
	});

	const catalogOptionsQuery = useQuery({
		queryKey: queryKeys.catalog({ page: 1, pageSize: 250, purpose: 'customer-options' }),
		queryFn: async () => {
			const response = await api.get('/dashboard/catalog', {
				params: { page: 1, pageSize: 250 },
			});
			const rawItems =
				response.data?.items ||
				response.data?.products ||
				response.data?.rows ||
				[];
			return buildCatalogProducts(rawItems);
		},
		...queryPresets.catalog,
	});

	const syncStatusQuery = useQuery({
		queryKey: queryKeys.customersSyncStatus,
		queryFn: async () => {
			const response = await api.get('/dashboard/customers/sync-status');
			return response.data || initialSyncStatus;
		},
		refetchInterval: (query) => (query.state.data?.running ? POLL_MS : false),
		refetchIntervalInBackground: true,
		staleTime: 3 * 1000,
		gcTime: 5 * 60 * 1000,
	});

	const syncMutation = useMutation({
		mutationFn: async () => {
			const response = await api.post('/dashboard/customers/sync', {});
			return response.data || initialSyncStatus;
		},
		onSuccess: async () => {
			setErrorMessage('');
			await queryClient.invalidateQueries({ queryKey: queryKeys.customersSyncStatus });
		},
		onError: (error) => {
			console.error(error);
			setErrorMessage(
				error?.response?.data?.message || 'No se pudo iniciar la sincronización de pedidos.'
			);
		},
	});

	useEffect(() => {
		if (!syncStatusQuery.data?.running) return;
		queryClient.invalidateQueries({ queryKey: ['dashboard', 'customers'] });
	}, [queryClient, syncStatusQuery.data?.ordersUpserted, syncStatusQuery.data?.running]);

	useEffect(() => {
		if (!customersQuery.isError) return;
		setErrorMessage(
			customersQuery.error?.response?.data?.message || 'No se pudieron cargar las compras.'
		);
	}, [customersQuery.error, customersQuery.isError]);

	const data = customersQuery.data || {
		customers: [],
		stats: {},
		pagination: { page: 1, totalPages: 1, totalItems: 0, pageSize: DEFAULT_PAGE_SIZE },
	};
	const loading = customersQuery.isLoading;
	const syncStatus = syncStatusQuery.data || initialSyncStatus;
	const syncing = syncMutation.isPending || Boolean(syncStatus.running);
	const catalogOptions = catalogOptionsQuery.data || [];

	const normalizedStats = useMemo(() => normalizeStats(data), [data]);
	const currentPage = Number(data.pagination?.page || 1);
	const totalPages = Number(data.pagination?.totalPages || 1);
	const visiblePages = useMemo(
		() => buildVisiblePages(currentPage, totalPages),
		[currentPage, totalPages]
	);
	const activeFilterCount = useMemo(() => {
		const keys = ['q', 'productQuery', 'orderNumber', 'dateFrom', 'dateTo', 'paymentStatus', 'minSpent'];
		const filled = keys.filter((key) => String(filters[key] || '').trim()).length;
		return filled + (filters.hasPhoneOnly ? 1 : 0);
	}, [filters]);
	const displayAvgTicketLabel = billingVisible ? normalizedStats.avgTicketLabel : '********';
	const displayTotalSpentLabel = billingVisible ? normalizedStats.totalSpentLabel : '********';

	function handleFilterChange(event) {
		const { name, value, type, checked } = event.target;
		setFilters((current) => ({
			...current,
			page: 1,
			[name]: type === 'checkbox' ? checked : value,
		}));
	}

	function handleToggleProduct(productName) {
		setSelectedProducts((current) => {
			const exists = current.includes(productName);
			const next = exists
				? current.filter((item) => item !== productName)
				: [...current, productName];

			setFilters((prev) => ({
				...prev,
				page: 1,
				productQuery: next.join('||'),
			}));

			return next;
		});
	}

	function handleRemoveSelectedProduct(productName) {
		handleToggleProduct(productName);
	}

	function handleClearProducts() {
		setSelectedProducts([]);
		setFilters((prev) => ({
			...prev,
			page: 1,
			productQuery: '',
		}));
	}

	function handleApplyFilters() {
		const next = {
			...filters,
			page: 1,
			productQuery: selectedProducts.join('||'),
		};
		setFilters(next);
	}

	function handleResetFilters() {
		setFilters(initialFilters);
		setSelectedProducts([]);
		setProductSearch('');
		setShowProductFilter(false);
	}

	function handleSync() {
		setErrorMessage('');
		syncMutation.mutate();
	}

	function handlePageChange(page) {
		if (page < 1 || page > totalPages || page === currentPage) return;
		const next = { ...filters, page };
		setFilters(next);
	}

	return (
		<section className="customers-page">
			<div className="customers-hero-card">
				<div className="customers-hero-copy">
					<span className="customers-kicker">VENTAS REALES</span>
					<h1>Clientes y compras</h1>
					<p>
						Pedidos reales, clientes y productos comprados en una vista para buscar oportunidades
						sin perder el estado de sincronización.
					</p>
				</div>

				<div className="customers-hero-actions">
					<button type="button" className="primary-action-btn" onClick={handleSync} disabled={syncing}>
						{syncing ? 'Sincronizando pedidos...' : 'Sincronizar pedidos'}
					</button>
					<button type="button" className="secondary-link-btn" onClick={handleResetFilters}>
						Limpiar filtros{activeFilterCount ? ` (${activeFilterCount})` : ''}
					</button>
					<button
						type="button"
						className="customers-visibility-btn"
						onClick={() => setBillingVisible((current) => !current)}
						aria-pressed={!billingVisible}
						title={billingVisible ? 'Ocultar montos' : 'Mostrar montos'}
					>
						<EyeToggleIcon hidden={!billingVisible} />
						<span>{billingVisible ? 'Ocultar montos' : 'Mostrar montos'}</span>
					</button>
				</div>
			</div>

			{errorMessage ? <div className="customers-feedback customers-feedback--error">{errorMessage}</div> : null}

			<div className={`customers-sync-panel ${syncStatus.running ? 'is-running' : ''}`}>
				<div className="customers-sync-top">
					<div>
						<span className="customers-sync-kicker">{buildSyncBadgeLabel(syncStatus)}</span>
						<h3>{syncStatus.message || 'Todavía no corriste una sincronización.'}</h3>
						<p>
							{syncStatus.running
								? `Tiempo transcurrido ${formatDuration(syncStatus.startedAt)} - páginas ${syncStatus.pagesFetched} - pedidos leídos ${syncStatus.ordersFetched} - pedidos guardados ${syncStatus.ordersUpserted}.`
								: syncStatus.finishedAt
									? `Última finalización ${formatDateTime(syncStatus.finishedAt)}.`
									: 'Cuando empiece la sync, acá vas a ver el progreso en vivo.'}
						</p>
					</div>
					<div className="customers-sync-stats">
						<div><span>Páginas</span><strong>{syncStatus.pagesFetched || 0}</strong></div>
						<div><span>Pedidos</span><strong>{syncStatus.ordersFetched || 0}</strong></div>
						<div><span>Items</span><strong>{syncStatus.itemsUpserted || 0}</strong></div>
					</div>
				</div>

				<div className="customers-progress-track">
					<div
						className="customers-progress-bar"
						style={{ width: syncStatus.running ? '58%' : syncStatus.ordersFetched ? '100%' : '0%' }}
					/>
				</div>

				{syncStatus.activeWindow ? (
					<p className="customers-sync-window">
						Ventana activa: <strong>{syncStatus.activeWindow.label}</strong> -{' '}
						{formatDateTime(syncStatus.activeWindow.from)} a {formatDateTime(syncStatus.activeWindow.to)}
					</p>
				) : null}

				{syncStatus.warnings?.length ? (
					<div className="customers-sync-notes">
						{syncStatus.warnings.slice(-2).map((warning) => (
							<div
								key={`${warning.at}-${warning.message}`}
								className="customers-sync-note customers-sync-note--warning"
							>
								{warning.message}
							</div>
						))}
					</div>
				) : null}

				{syncStatus.errors?.length ? (
					<div className="customers-sync-notes">
						{syncStatus.errors.slice(-2).map((item) => (
							<div
								key={`${item.at}-${item.message}`}
								className="customers-sync-note customers-sync-note--error"
							>
								{item.message}
							</div>
						))}
					</div>
				) : null}
			</div>

			<div className="customers-stats-grid">
				<div className="customers-stat-card"><span className="customers-stat-label">Pedidos</span><strong>{normalizedStats.totalOrders}</strong></div>
				<div className="customers-stat-card"><span className="customers-stat-label">Clientes únicos</span><strong>{normalizedStats.totalCustomers}</strong></div>
				<div className="customers-stat-card"><span className="customers-stat-label">Con teléfono</span><strong>{normalizedStats.withPhone}</strong></div>
				<div className="customers-stat-card"><span className="customers-stat-label">Ticket promedio</span><strong>{displayAvgTicketLabel}</strong></div>
				<div className="customers-stat-card"><span className="customers-stat-label">Facturación</span><strong>{displayTotalSpentLabel}</strong></div>
			</div>

			<div className="customers-filters-card">
				<div className="customers-list-topbar">
					<div>
						<h3>Filtros comerciales</h3>
						<p>Filtrá por cliente, pedido, monto y productos reales del catálogo.</p>
					</div>
					{activeFilterCount ? (
						<span className="customers-active-filter-badge">
							{activeFilterCount} filtros activos
						</span>
					) : null}
				</div>

				<div className="customers-filter-grid">
					<div className="customers-filter-group customers-filter-group--grow">
						<label>Buscar general</label>
						<input
							type="text"
							name="q"
							placeholder="Nombre, email, teléfono, SKU o nro. de pedido"
							value={filters.q}
							onChange={handleFilterChange}
						/>
					</div>

					<div className="customers-filter-group customers-filter-group--wide">
						<label>Producto comprado</label>
						<button
							type="button"
							className="customers-product-toggle"
							onClick={() => setShowProductFilter((current) => !current)}
						>
							<span className="customers-product-toggle-label">Selector de productos</span>
						</button>

						{selectedProducts.length ? (
							<div className="selected-product-chips">
								{selectedProducts.map((productName) => (
									<button
										key={productName}
										type="button"
										className="selected-product-chip"
										onClick={() => handleRemoveSelectedProduct(productName)}
										title="Quitar producto"
									>
										<span>{productName}</span>
										<strong>×</strong>
									</button>
								))}
							</div>
						) : null}

						{showProductFilter ? (
							<ProductMultiSelect
								options={catalogOptions}
								selectedValues={selectedProducts}
								search={productSearch}
								onSearchChange={setProductSearch}
								onToggleValue={handleToggleProduct}
								onClear={handleClearProducts}
							/>
						) : null}
					</div>

					<div className="customers-filter-group">
						<label>Nro. pedido</label>
						<input
							type="text"
							name="orderNumber"
							placeholder="Ej: 23621"
							value={filters.orderNumber}
							onChange={handleFilterChange}
						/>
					</div>

					<div className="customers-filter-group">
						<label>Compra desde</label>
						<input type="date" name="dateFrom" value={filters.dateFrom} onChange={handleFilterChange} />
					</div>

					<div className="customers-filter-group">
						<label>Compra hasta</label>
						<input type="date" name="dateTo" value={filters.dateTo} onChange={handleFilterChange} />
					</div>
					<div className="customers-filter-group">
						<label>Pago</label>
						<select
							name="paymentStatus"
							value={filters.paymentStatus}
							onChange={handleFilterChange}
						>
							<option value="">Todos</option>
							<option value="pending">Pendiente</option>
							<option value="authorized">Autorizado</option>
							<option value="paid">Pagado</option>
							<option value="partially_paid">Pago parcial</option>
							<option value="abandoned">Abandonado</option>
							<option value="refunded">Reembolsado</option>
							<option value="partially_refunded">Reembolso parcial</option>
							<option value="voided">Anulado</option>
						</select>
					</div>
					<div className="customers-filter-group">
						<label>Total mínimo</label>
						<input
							type="number"
							name="minSpent"
							placeholder="50000"
							value={filters.minSpent}
							onChange={handleFilterChange}
						/>
					</div>

					<div className="customers-filter-group">
						<label>Ordenar por</label>
						<select name="sort" value={filters.sort} onChange={handleFilterChange}>
							<option value="purchase_desc">Compra más reciente</option>
							<option value="purchase_asc">Compra más antigua</option>
							<option value="spent_desc">Mayor monto</option>
							<option value="spent_asc">Menor monto</option>
							<option value="name_asc">Nombre A-Z</option>
							<option value="name_desc">Nombre Z-A</option>
							<option value="order_desc">Pedido descendente</option>
							<option value="order_asc">Pedido ascendente</option>
						</select>
					</div>
				</div>

				<div className="customers-toggle-row">
					<label className="customers-checkbox">
						<input
							type="checkbox"
							name="hasPhoneOnly"
							checked={filters.hasPhoneOnly}
							onChange={handleFilterChange}
						/>
						<span>Solo con teléfono</span>
					</label>

					<div className="customers-filter-actions">
						<button type="button" className="customers-apply-btn" onClick={handleApplyFilters}>
							Aplicar filtros
						</button>
					</div>
				</div>
			</div>

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

				{loading ? <div className="customers-empty-state">Cargando compras...</div> : null}

				{!loading && !data.customers?.length ? (
					<div className="customers-empty-state">
						No hay compras para esos filtros. Probá ampliar la búsqueda o dejar que la sync avance un poco más.
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
										<span>Pedido</span>
										<strong>{customer.lastOrderLabel || '-'}</strong>
									</div>
								</div>

								<div className="customer-card-focus">
									<div className="customer-total-box">
										<span>Total</span>
										<strong>{billingVisible ? customer.totalSpentLabel || '$0' : '********'}</strong>
									</div>
									<div className={`customer-payment-badge ${getPaymentStatusTone(customer.paymentStatus)}`}>
										<span>Pago</span>
										<strong>{formatPaymentStatusLabel(customer.paymentStatus)}</strong>
									</div>
								</div>

								<div className="customer-meta-row">
									<div className="customer-meta-chip">
										<span>Fecha</span>
										<strong>{customer.lastOrderDateLabel || '-'}</strong>
									</div>
									<div className="customer-meta-chip">
										<span>Unidades</span>
										<strong>{customer.totalUnitsPurchased || 0}</strong>
									</div>
								</div>

								<div className="customer-section-box">
									<div className="customer-section-header">
										<span>Productos comprados</span>
										<strong>{customer.productsPreview?.length || 0} visibles</strong>
									</div>
									{customer.productsPreview?.length ? (
										<ul className="customer-products-list">
											{customer.productsPreview.map((product) => (
												<li key={`${customer.id}-${product}`}>{product}</li>
											))}
										</ul>
									) : (
										<p className="customer-products-empty">
											Todavía no quedó guardado el detalle de productos.
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
							className="pagination-btn"
							disabled={currentPage === 1}
							onClick={() => handlePageChange(currentPage - 1)}
						>
							Anterior
						</button>

						<div className="pagination-pages">
							{visiblePages.map((page) =>
								String(page).includes('ellipsis') ? (
									<span key={page} className="pagination-ellipsis">...</span>
								) : (
									<button
										key={page}
										type="button"
										className={`pagination-page-btn ${page === currentPage ? 'is-active' : ''}`}
										onClick={() => handlePageChange(page)}
									>
										{page}
									</button>
								)
							)}
						</div>

						<button
							type="button"
							className="pagination-btn"
							disabled={currentPage === totalPages}
							onClick={() => handlePageChange(currentPage + 1)}
						>
							Siguiente
						</button>
					</div>
				) : null}
			</div>
		</section>
	);
}
