import { useEffect, useState } from 'react';
import api from '../lib/api.js';
import './AbandonedCartsPage.css';

const initialFilters = {
	q: '',
	status: 'ALL',
	dateFrom: '',
	dateTo: '',
	syncWindow: 7,
	page: 1
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

export default function AbandonedCartsPage() {
	const [loading, setLoading] = useState(true);
	const [syncing, setSyncing] = useState(false);
	const [sendingId, setSendingId] = useState('');
	const [expandedMessageId, setExpandedMessageId] = useState('');
	const [filters, setFilters] = useState(initialFilters);
	const [messageDrafts, setMessageDrafts] = useState({});
	const [syncSummary, setSyncSummary] = useState(null);
	const [data, setData] = useState({
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
	});

	async function loadAbandonedCarts(nextFilters = filters) {
		setLoading(true);

		try {
			const res = await api.get('/dashboard/abandoned-carts', {
				params: nextFilters
			});

			setData(res.data);

			const nextDrafts = {};
			(res.data.carts || []).forEach((cart) => {
				nextDrafts[cart.id] = cart.suggestedMessage || '';
			});

			setMessageDrafts((prev) => ({
				...nextDrafts,
				...prev
			}));
		} catch (error) {
			console.error(error);
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		loadAbandonedCarts(filters);
	}, []);

	function updateFilter(name, value) {
		setFilters((prev) => ({
			...prev,
			[name]: value
		}));
	}

	async function handleApplyFilters(e) {
		e.preventDefault();
		const next = { ...filters, page: 1 };
		setFilters(next);
		await loadAbandonedCarts(next);
	}

	async function handleResetFilters() {
		setExpandedMessageId('');
		setFilters(initialFilters);
		await loadAbandonedCarts(initialFilters);
	}

	async function handleSync(daysBack = 7) {
		setSyncing(true);

		try {
			const res = await api.post('/dashboard/abandoned-carts/sync', { daysBack });

			setSyncSummary({
				daysBack: res.data?.daysBack || daysBack,
				syncedCount: res.data?.syncedCount ?? res.data?.count ?? 0,
				deletedCount: res.data?.deletedCount ?? 0,
				remainingCount: res.data?.remainingCount ?? 0,
				message: res.data?.message || ''
			});

			const next = {
				...filters,
				syncWindow: daysBack,
				page: 1
			};

			setFilters(next);
			setExpandedMessageId('');
			await loadAbandonedCarts(next);
		} catch (error) {
			console.error(error);
		} finally {
			setSyncing(false);
		}
	}

	function handleOpenMessage(cartId) {
		setExpandedMessageId((prev) => (prev === cartId ? '' : cartId));
	}

	async function handleConfirmWhatsApp(cartId) {
		const body = String(messageDrafts[cartId] || '').trim();

		if (!body) return;

		setSendingId(cartId);

		try {
			await api.post(`/dashboard/abandoned-carts/${cartId}/message`, { body });
			setExpandedMessageId('');
			await loadAbandonedCarts(filters);
		} catch (error) {
			console.error(error);
		} finally {
			setSendingId('');
		}
	}

	async function handlePageChange(nextPage) {
		const totalPages = data.pagination?.totalPages || 1;

		if (nextPage < 1 || nextPage > totalPages || nextPage === filters.page) {
			return;
		}

		const next = {
			...filters,
			page: nextPage
		};

		setFilters(next);
		setExpandedMessageId('');
		await loadAbandonedCarts(next);

		window.scrollTo({
			top: 0,
			behavior: 'smooth'
		});
	}

	const currentPage = data.pagination?.page || 1;
	const totalPages = data.pagination?.totalPages || 1;
	const visiblePages = getVisiblePages(currentPage, totalPages);

	return (
		<section className="page-card abandoned-carts-page">
			<div className="page-header">
				<div>
					<h2>Carritos abandonados</h2>
					<p>
						Total: <strong>{data.stats?.total || 0}</strong>
					</p>
					<p className="muted-text">
						La sincronización ahora limpia automáticamente los carritos que quedan fuera
						de la ventana elegida (7, 15 o 30 días).
					</p>

					{syncSummary ? (
						<p className="muted-text">
							Última sync {syncSummary.daysBack} días: {syncSummary.syncedCount} sincronizados,
							{' '}{syncSummary.deletedCount} eliminados, {syncSummary.remainingCount} vigentes.
						</p>
					) : null}
				</div>

				<div className="inline-actions">
					<button type="button" onClick={() => handleSync(7)} disabled={syncing}>
						{syncing ? 'Sincronizando...' : 'Sync 7 días'}
					</button>
					<button type="button" onClick={() => handleSync(15)} disabled={syncing}>
						{syncing ? 'Sincronizando...' : 'Sync 15 días'}
					</button>
					<button type="button" onClick={() => handleSync(30)} disabled={syncing}>
						{syncing ? 'Sincronizando...' : 'Sync 30 días'}
					</button>
				</div>
			</div>

			<div className="stats-row">
				<div className="stat-box">
					<span>Total</span>
					<strong>{data.stats?.total || 0}</strong>
				</div>

				<div className="stat-box">
					<span>Nuevos</span>
					<strong>{data.stats?.totalNew || 0}</strong>
				</div>

				<div className="stat-box">
					<span>Contactados</span>
					<strong>{data.stats?.totalContacted || 0}</strong>
				</div>

				<div className="stat-box">
					<span>Mostrando</span>
					<strong>
						{data.stats?.showingFrom || 0}-{data.stats?.showingTo || 0}
					</strong>
				</div>
			</div>

			<form className="filters-form" onSubmit={handleApplyFilters}>
				<input
					type="text"
					placeholder="Buscar por nombre, mail, teléfono, ciudad, provincia o checkout"
					value={filters.q}
					onChange={(e) => updateFilter('q', e.target.value)}
				/>

				<input
					type="date"
					value={filters.dateFrom}
					onChange={(e) => updateFilter('dateFrom', e.target.value)}
				/>

				<input
					type="date"
					value={filters.dateTo}
					onChange={(e) => updateFilter('dateTo', e.target.value)}
				/>

				<select
					value={filters.status}
					onChange={(e) => updateFilter('status', e.target.value)}
				>
					<option value="ALL">Todos</option>
					<option value="NEW">Nuevos</option>
					<option value="CONTACTED">Contactados</option>
				</select>

				<button type="submit">Aplicar</button>
				<button type="button" onClick={handleResetFilters}>
					Limpiar
				</button>
			</form>

			{loading ? <p>Cargando carritos...</p> : null}

			{!loading ? (
				<div className="catalog-grid abandoned-carts-grid">
					{(data.carts || []).map((cart) => (
						<article key={cart.id} className="catalog-card abandoned-card">
							<div className="abandoned-topline">
								<div className="abandoned-avatar">
									{cart.initials ||
										getInitials(cart.contactName || cart.contactEmail || cart.contactPhone)}
								</div>

								<div className="abandoned-head-copy">
									<h3>{cart.contactName || 'Sin nombre'}</h3>
									<p>{cart.contactPhone || 'Sin teléfono'}</p>
									<p>{cart.contactEmail || 'Sin email'}</p>
								</div>

								<span
									className={`status-badge status-${String(cart.status || 'NEW').toLowerCase()}`}
								>
									{cart.statusLabel || cart.status || 'Nuevo'}
								</span>
							</div>

							<div className="abandoned-meta-grid">
								<div>
									<span>Total</span>
									<strong>{cart.totalLabel}</strong>
								</div>

								<div>
									<span>Fecha</span>
									<strong>{cart.displayCreatedAt}</strong>
								</div>

								<div>
									<span>Ciudad</span>
									<strong>{cart.shippingCity || '-'}</strong>
								</div>

								<div>
									<span>Provincia</span>
									<strong>{cart.shippingProvince || '-'}</strong>
								</div>
							</div>

							{Array.isArray(cart.productsPreview) && cart.productsPreview.length > 0 ? (
								<div className="product-chips">
									{cart.productsPreview.map((productName, index) => (
										<span
											key={`${cart.id}-${index}`}
											className="product-chip"
											title={productName}
										>
											{productName}
										</span>
									))}
								</div>
							) : null}

							<div className="abandoned-actions">
								{cart.canOpenCart ? (
									<a
										href={cart.abandonedCheckoutUrl}
										target="_blank"
										rel="noreferrer"
										className="secondary-link-btn"
									>
										Abrir carrito
									</a>
								) : (
									<button type="button" className="secondary-link-btn" disabled>
										Sin link
									</button>
								)}

								<button
									type="button"
									className="primary-action-btn"
									onClick={() => handleOpenMessage(cart.id)}
									disabled={!cart.canMessage || sendingId === cart.id}
								>
									{expandedMessageId === cart.id ? 'Ocultar mensaje' : 'Enviar WhatsApp'}
								</button>
							</div>

							{expandedMessageId === cart.id ? (
								<div className="abandoned-message-box">
									<textarea
										rows={4}
										value={messageDrafts[cart.id] || ''}
										onChange={(e) =>
											setMessageDrafts((prev) => ({
												...prev,
												[cart.id]: e.target.value
											}))
										}
										placeholder="Mensaje de recuperación..."
									/>

									<div className="abandoned-message-actions">
										<button
											type="button"
											className="secondary-link-btn"
											onClick={() => setExpandedMessageId('')}
										>
											Cancelar
										</button>

										<button
											type="button"
											className="primary-action-btn"
											onClick={() => handleConfirmWhatsApp(cart.id)}
											disabled={!cart.canMessage || sendingId === cart.id}
										>
											{sendingId === cart.id ? 'Enviando...' : 'Enviar ahora'}
										</button>
									</div>
								</div>
							) : null}

							{cart.productsCount > 3 ? (
								<p className="abandoned-extra-products">
									+{cart.productsCount - 3} producto{cart.productsCount - 3 === 1 ? '' : 's'} más
								</p>
							) : null}
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
		</section>
	);
}