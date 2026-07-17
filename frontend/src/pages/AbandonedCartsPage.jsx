import { memo, useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import api from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';
import { ActionButton, EmptyState, PageHeader, StatusBadge } from '../components/ui/InternalPage.jsx';
import { useInternalDarkOverrides } from '../hooks/useInternalDarkOverrides.js';
import './AbandonedCartsPage.css';

const initialFilters = {
	q: '',
	status: 'ALL',
	dateFrom: '',
	dateTo: '',
	syncWindow: 30,
	page: 1
};

const SYNC_WINDOW_OPTIONS = [1, 3, 7, 15, 30];
const DEFAULT_SYNC_WINDOW_DAYS = 30;
const EMPTY_ABANDONED_CARTS_DATA = {
	carts: [],
	stats: {
		total: 0,
		totalNew: 0,
		totalContacted: 0,
		showingFrom: 0,
		showingTo: 0
	},
	pagination: {
		page: 1,
		totalPages: 1
	}
};

function getInitials(value = '') {
	return (
		String(value)
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

function formatCartAge(value) {
	const createdAt = new Date(value || '');
	if (Number.isNaN(createdAt.getTime())) return 'Sin fecha';

	const elapsedMs = Math.max(0, Date.now() - createdAt.getTime());
	const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
	if (elapsedHours < 24) return elapsedHours <= 1 ? 'Hace 1 hora' : `Hace ${elapsedHours} horas`;

	const elapsedDays = Math.floor(elapsedHours / 24);
	return elapsedDays === 1 ? 'Hace 1 día' : `Hace ${elapsedDays} días`;
}

function CartStatusBadge({ cart }) {
	return (
		<StatusBadge
			tone={cart.status === 'CONTACTED' ? 'success' : 'info'}
			className={`status-badge ${
				cart.status === 'CONTACTED' ? 'status-contacted' : 'status-new'
			}`}
		>
			{cart.statusLabel || (cart.status === 'CONTACTED' ? 'Contactado' : 'Nuevo')}
		</StatusBadge>
	);
}

function CartPrimaryAction({ cart }) {
	if (!cart.canOpenCart) {
		return (
			<button type="button" className="secondary-link-btn" disabled>
				Falta link
			</button>
		);
	}

	return (
		<a
			href={cart.abandonedCheckoutUrl}
			target="_blank"
			rel="noreferrer"
			className="secondary-link-btn"
		>
			Abrir carrito
		</a>
	);
}

const AbandonedCartCard = memo(function AbandonedCartCard({
	cart,
}) {
	return (
		<article className="abandoned-card">
			<div className="abandoned-topline">
				<div className="abandoned-avatar">{cart.initials || getInitials(cart.contactName)}</div>

				<div className="abandoned-head-copy">
					<h3>{cart.contactName || 'Cliente sin nombre'}</h3>
					<p>{cart.contactPhone || '-'}</p>
					{cart.contactEmail ? <p>{cart.contactEmail}</p> : null}
				</div>

				<CartStatusBadge cart={cart} />
			</div>

			<div className="abandoned-card-focus">
				<div>
					<span>Monto</span>
					<strong>{cart.totalLabel}</strong>
				</div>

				<div className="abandoned-card-actions">
					<CartPrimaryAction cart={cart} />
				</div>
			</div>

			<div className="abandoned-meta-grid">
				<div>
					<span>Fecha</span>
					<strong>{cart.displayCreatedAt || '-'}</strong>
				</div>

				<div>
					<span>Ubicacion</span>
					<strong>{[cart.shippingCity, cart.shippingProvince].filter(Boolean).join(', ') || '-'}</strong>
				</div>
			</div>

			<div className="abandoned-products">
				{Array.isArray(cart.productsPreview) && cart.productsPreview.length > 0 ? (
					cart.productsPreview.map((productName, index) => (
						<span key={`${cart.id}-${index}`}>{productName}</span>
					))
				) : (
					<span>Sin productos detectados</span>
				)}
			</div>

			{cart.status === 'CONTACTED' ? (
				<div className="abandoned-contact-note">
					Ultimo envio: <strong>{cart.lastMessageSentLabel || 'Nunca'}</strong>
				</div>
			) : null}
		</article>
	);
});

export default function AbandonedCartsPage() {
	useInternalDarkOverrides();

	const queryClient = useQueryClient();
	const [syncing, setSyncing] = useState(false);
	const [filters, setFilters] = useState(initialFilters);
	const [appliedFilters, setAppliedFilters] = useState(initialFilters);
	const [syncSummary, setSyncSummary] = useState(null);
	const [errorMessage, setErrorMessage] = useState('');
	const [successMessage, setSuccessMessage] = useState('');
	const abandonedCartsQuery = useQuery({
		queryKey: queryKeys.abandonedCarts(appliedFilters),
		queryFn: async () => {
			const res = await api.get('/dashboard/abandoned-carts', {
				params: appliedFilters
			});
			return res.data || EMPTY_ABANDONED_CARTS_DATA;
		},
		placeholderData: keepPreviousData,
		...queryPresets.abandonedCarts,
	});

	useEffect(() => {
		if (abandonedCartsQuery.isSuccess) {
			setErrorMessage('');
			return;
		}
		if (!abandonedCartsQuery.isError) return;
		const error = abandonedCartsQuery.error;
		setErrorMessage(
			error?.response?.data?.error ||
			error?.response?.data?.message ||
			'No pudimos cargar los carritos abandonados. Probá nuevamente.'
		);
	}, [abandonedCartsQuery.error, abandonedCartsQuery.isError, abandonedCartsQuery.isSuccess]);

	const updateFilter = useCallback((name, value) => {
		setFilters((prev) => ({
			...prev,
			[name]: value
		}));
	}, []);

	async function handleApplyFilters(e) {
		e.preventDefault();
		setSuccessMessage('');
		setErrorMessage('');
		const next = { ...filters, page: 1 };
		setFilters(next);
		setAppliedFilters(next);
	}

	async function handleResetFilters() {
		setSuccessMessage('');
		setErrorMessage('');
		setFilters(initialFilters);
		setAppliedFilters(initialFilters);
	}

	async function handleSync() {
		setSyncing(true);
		setErrorMessage('');
		setSuccessMessage('');

		try {
			const syncWindow = SYNC_WINDOW_OPTIONS.includes(Number(filters.syncWindow))
				? Number(filters.syncWindow)
				: DEFAULT_SYNC_WINDOW_DAYS;
			const res = await api.post('/dashboard/abandoned-carts/sync', { daysBack: syncWindow });

			setSyncSummary({
				daysBack: res.data?.daysBack || syncWindow,
				syncedCount: res.data?.syncedCount ?? res.data?.count ?? 0,
				deletedCount: res.data?.deletedCount ?? 0,
				remainingCount: res.data?.remainingCount ?? 0,
				message: res.data?.message || ''
			});

			const next = {
				...filters,
				syncWindow,
				page: 1
			};

			setFilters(next);
			setAppliedFilters(next);
			await queryClient.invalidateQueries({ queryKey: queryKeys.abandonedCarts(next) });
			setSuccessMessage('Sincronización completada.');
		} catch (error) {
			console.error(error);
			setErrorMessage(
				error?.response?.data?.error ||
				error?.response?.data?.message ||
				'No pudimos sincronizar los carritos abandonados. Probá nuevamente.'
			);
		} finally {
			setSyncing(false);
		}
	}

	async function handlePageChange(nextPage) {
		const totalPages = data.pagination?.totalPages || 1;

		if (
			typeof nextPage !== 'number' ||
			nextPage < 1 ||
			nextPage > totalPages ||
			nextPage === filters.page
		) {
			return;
		}

		const next = { ...filters, page: nextPage };
		setFilters(next);
		setAppliedFilters(next);

		window.scrollTo({
			top: 0,
			behavior: 'smooth'
		});
	}

	const data = abandonedCartsQuery.data || EMPTY_ABANDONED_CARTS_DATA;
	const loading = abandonedCartsQuery.isLoading;
	const carts = Array.isArray(data.carts) ? data.carts : [];
	const stats = data.stats || {};
	const pagination = data.pagination || { page: 1, totalPages: 1 };
	const visiblePages = getVisiblePages(pagination.page || 1, pagination.totalPages || 1);
	const hasInitialLoadError = abandonedCartsQuery.isError && carts.length === 0;

	return (
		<div className="abandoned-carts-page">
			<PageHeader
				className="page-header"
				title="Carritos abandonados"
				description={`${stats.total || 0} carritos en los ultimos ${filters.syncWindow || DEFAULT_SYNC_WINDOW_DAYS} dias. Se conserva el estado de los ya contactados por campanas.`}
			>
				<div className="inline-actions">
					<ActionButton onClick={handleSync} disabled={syncing} icon={RefreshCw}>
						{syncing ? 'Sincronizando' : 'Sincronizar carritos'}
					</ActionButton>
				</div>
			</PageHeader>

			{errorMessage && !hasInitialLoadError ? (
				<div className="abandoned-feedback abandoned-feedback--error" role="alert">{errorMessage}</div>
			) : null}

			{successMessage ? (
				<div className="abandoned-feedback abandoned-feedback--success" role="status" aria-live="polite">{successMessage}</div>
			) : null}

			{syncSummary ? (
				<div className="sync-summary-banner">
					<strong>Última sync {syncSummary.daysBack} días</strong>
					<span>{syncSummary.message || 'La sincronización terminó, pero el proveedor no envió un resumen.'}</span>
					<small>
						Guardados: {syncSummary.syncedCount} - Eliminados fuera de ventana: {syncSummary.deletedCount} - Vigentes: {syncSummary.remainingCount}
					</small>
				</div>
			) : null}

			<div className="stats-row">
				<div className="stat-box">
					<span>Total</span>
					<strong>{stats.total || 0}</strong>
				</div>

				<div className="stat-box">
					<span>Nuevos</span>
					<strong>{stats.totalNew || 0}</strong>
				</div>

				<div className="stat-box">
					<span>Contactados</span>
					<strong>{stats.totalContacted || 0}</strong>
				</div>

				<div className="stat-box">
					<span>Mostrando</span>
					<strong>
						{stats.showingFrom || 0}-{stats.showingTo || 0}
					</strong>
				</div>
			</div>

			<form className="filters-form abandoned-filters-form" onSubmit={handleApplyFilters}>
				<label>
					<span>Buscar carrito</span>
					<input
						type="text"
						placeholder="Nombre, mail, teléfono, ciudad o checkout"
						value={filters.q}
						onChange={(e) => updateFilter('q', e.target.value)}
					/>
				</label>

				<label>
					<span>Desde</span>
					<input
						type="date"
						value={filters.dateFrom}
						onChange={(e) => updateFilter('dateFrom', e.target.value)}
					/>
				</label>

				<label>
					<span>Hasta</span>
					<input
						type="date"
						value={filters.dateTo}
						onChange={(e) => updateFilter('dateTo', e.target.value)}
					/>
				</label>

				<label>
					<span>Ventana sync</span>
					<select
						value={filters.syncWindow}
						onChange={(e) => updateFilter('syncWindow', Number(e.target.value))}
					>
						{SYNC_WINDOW_OPTIONS.map((days) => (
							<option key={days} value={days}>{days} dia{days === 1 ? '' : 's'}</option>
						))}
					</select>
				</label>

				<label>
					<span>Estado</span>
					<select
						value={filters.status}
						onChange={(e) => updateFilter('status', e.target.value)}
					>
						<option value="ALL">Todos</option>
						<option value="NEW">Nuevo</option>
						<option value="CONTACTED">Contactado</option>
					</select>
				</label>

				<button type="submit">Filtrar carritos</button>
				<button type="button" onClick={handleResetFilters}>
					Limpiar filtros
				</button>
			</form>

			{loading ? (
				<EmptyState
					tone="loading"
					title="Cargando carritos abandonados"
					description="Estamos actualizando la lista con los últimos carritos."
					className="abandoned-empty-state"
				/>
			) : hasInitialLoadError ? (
				<EmptyState
					tone="error"
					title="No pudimos cargar los carritos"
					description={errorMessage || 'Revisá la conexión e intentá nuevamente. Tus filtros se mantienen.'}
					className="abandoned-empty-state"
				>
					<ActionButton
						variant="secondary"
						onClick={() => abandonedCartsQuery.refetch()}
						disabled={abandonedCartsQuery.isFetching}
					>
						{abandonedCartsQuery.isFetching ? 'Reintentando...' : 'Reintentar'}
					</ActionButton>
				</EmptyState>
			) : carts.length === 0 ? (
				<EmptyState
					title="No hay carritos para mostrar"
					description="Probá limpiar los filtros o sincronizar carritos para traer oportunidades recientes."
					className="abandoned-empty-state"
				/>
			) : (
				<>
					<div className="abandoned-carts-table-wrap">
						<table className="abandoned-carts-table">
							<caption>Carritos abandonados ordenados desde el más reciente</caption>
							<thead>
								<tr>
									<th scope="col">Cliente</th>
									<th scope="col">Importe</th>
									<th scope="col">Antigüedad</th>
									<th scope="col">Estado</th>
									<th scope="col">Último contacto</th>
									<th scope="col">Responsable</th>
									<th scope="col">Próxima acción</th>
								</tr>
							</thead>
							<tbody>
								{carts.map((cart) => (
									<tr key={cart.id}>
										<td>
											<strong>{cart.contactName || 'Cliente sin nombre'}</strong>
											<span>{cart.contactPhone || cart.contactEmail || 'Sin contacto'}</span>
										</td>
										<td><strong>{cart.totalLabel || '-'}</strong></td>
										<td>{formatCartAge(cart.checkoutCreatedAt || cart.createdAt)}</td>
										<td><CartStatusBadge cart={cart} /></td>
										<td>{cart.lastMessageSentLabel || 'Nunca'}</td>
										<td>{cart.responsibleName || 'Sin asignar'}</td>
										<td><CartPrimaryAction cart={cart} /></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<div className="abandoned-carts-grid">
						{carts.map((cart) => (
							<AbandonedCartCard
								key={cart.id}
								cart={cart}
							/>
						))}
					</div>
				</>
			)}

			{(pagination.totalPages || 1) > 1 ? (
				<div className="pagination-row">
					<button
						type="button"
						onClick={() => handlePageChange((pagination.page || 1) - 1)}
						disabled={(pagination.page || 1) <= 1}
					>
						Anterior
					</button>

					{visiblePages.map((page) =>
						typeof page === 'number' ? (
							<button
								key={page}
								type="button"
								className={page === pagination.page ? 'is-active' : ''}
								onClick={() => handlePageChange(page)}
							>
								{page}
							</button>
						) : (
							<span key={page} className="pagination-ellipsis">
								...
							</span>
						)
					)}

					<button
						type="button"
						onClick={() => handlePageChange((pagination.page || 1) + 1)}
						disabled={(pagination.page || 1) >= (pagination.totalPages || 1)}
					>
						Siguiente
					</button>
				</div>
			) : null}
		</div>
	);
}
