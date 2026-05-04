import { useEffect, useState } from 'react';
import api from '../lib/api.js';
import './AbandonedCartsPage.css';

const initialFilters = {
	q: '',
	status: 'ALL',
	dateFrom: '',
	dateTo: '',
	syncWindow: 30,
	page: 1
};

const FIXED_SYNC_WINDOW_DAYS = 30;

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
	const [filters, setFilters] = useState(initialFilters);
	const [syncSummary, setSyncSummary] = useState(null);
	const [errorMessage, setErrorMessage] = useState('');
	const [successMessage, setSuccessMessage] = useState('');
	const [activeMessageCartId, setActiveMessageCartId] = useState('');
	const [messageDrafts, setMessageDrafts] = useState({});
	const [sendingCartId, setSendingCartId] = useState('');
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
		setErrorMessage('');

		try {
			const res = await api.get('/dashboard/abandoned-carts', {
				params: nextFilters
			});

			setData(res.data);

		} catch (error) {
			console.error(error);
			setErrorMessage(
				error?.response?.data?.error ||
				error?.response?.data?.message ||
				'No pudimos cargar los carritos abandonados. Proba nuevamente.'
			);
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
		setSuccessMessage('');
		const next = { ...filters, page: 1 };
		setFilters(next);
		await loadAbandonedCarts(next);
	}

	async function handleResetFilters() {
		setSuccessMessage('');
		setFilters(initialFilters);
		await loadAbandonedCarts(initialFilters);
	}

	async function handleSync() {
		setSyncing(true);
		setErrorMessage('');
		setSuccessMessage('');

		try {
			const res = await api.post('/dashboard/abandoned-carts/sync', {});

			setSyncSummary({
				daysBack: res.data?.daysBack || FIXED_SYNC_WINDOW_DAYS,
				syncedCount: res.data?.syncedCount ?? res.data?.count ?? 0,
				deletedCount: res.data?.deletedCount ?? 0,
				remainingCount: res.data?.remainingCount ?? 0,
				message: res.data?.message || ''
			});

			const next = {
				...filters,
				syncWindow: FIXED_SYNC_WINDOW_DAYS,
				page: 1
			};

			setFilters(next);
			await loadAbandonedCarts(next);
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

	function handleToggleMessageBox(cart) {
		setErrorMessage('');
		setSuccessMessage('');

		if (activeMessageCartId === cart.id) {
			setActiveMessageCartId('');
			return;
		}

		setActiveMessageCartId(cart.id);
		setMessageDrafts((prev) => ({
			...prev,
			[cart.id]: prev[cart.id] ?? cart.suggestedMessage ?? ''
		}));
	}

	async function handleSendMessage(cart) {
		const body = String(messageDrafts[cart.id] || '').trim();

		if (!body) {
			setErrorMessage('Escribí un mensaje antes de enviarlo.');
			return;
		}

		setSendingCartId(cart.id);
		setErrorMessage('');
		setSuccessMessage('');

		try {
			await api.post(`/dashboard/abandoned-carts/${cart.id}/message`, { body });
			setSuccessMessage('Mensaje enviado por WhatsApp.');
			setActiveMessageCartId('');
			await loadAbandonedCarts(filters);
		} catch (error) {
			console.error(error);
			setErrorMessage(
				error?.response?.data?.error ||
				error?.response?.data?.message ||
				'No pudimos enviar el mensaje. Probá nuevamente.'
			);
		} finally {
			setSendingCartId('');
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
		await loadAbandonedCarts(next);

		window.scrollTo({
			top: 0,
			behavior: 'smooth'
		});
	}

	const carts = Array.isArray(data.carts) ? data.carts : [];
	const stats = data.stats || {};
	const pagination = data.pagination || { page: 1, totalPages: 1 };
	const visiblePages = getVisiblePages(pagination.page || 1, pagination.totalPages || 1);

	return (
		<div className="abandoned-carts-page">
			<section className="page-header">
				<div>
					<h2>Carritos abandonados</h2>
					<p>
						<strong>{stats.total || 0}</strong> carritos en los últimos 30 días. Se conserva el estado de los ya contactados por campañas.
					</p>
				</div>

				<div className="inline-actions">
					<button type="button" onClick={handleSync} disabled={syncing}>
						{syncing ? 'Sincronizando...' : 'Sincronizar 30 días'}
					</button>
				</div>
			</section>

			{errorMessage ? (
				<div className="abandoned-feedback abandoned-feedback--error">{errorMessage}</div>
			) : null}

			{successMessage ? (
				<div className="abandoned-feedback abandoned-feedback--success">{successMessage}</div>
			) : null}

			{syncSummary ? (
				<div className="sync-summary-banner">
					<strong>Última sync {syncSummary.daysBack} días</strong>
					<span>{syncSummary.message || 'Sin resumen disponible.'}</span>
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
					<span>Buscar</span>
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

				<button type="submit">Aplicar filtros</button>
				<button type="button" onClick={handleResetFilters}>
					Limpiar filtros
				</button>
			</form>

			{loading ? (
				<div className="abandoned-empty-state">
					<strong>Cargando carritos abandonados</strong>
					<span>Estamos trayendo la lista actualizada.</span>
				</div>
			) : carts.length === 0 ? (
				<div className="abandoned-empty-state">
					<strong>No hay carritos para mostrar</strong>
					<span>Probá limpiar los filtros o sincronizar los últimos 30 días.</span>
				</div>
			) : (
				<div className="abandoned-carts-grid">
					{carts.map((cart) => (
						<article key={cart.id} className="abandoned-card">
							<div className="abandoned-topline">
								<div className="abandoned-avatar">{cart.initials || getInitials(cart.contactName)}</div>

								<div className="abandoned-head-copy">
									<h3>{cart.contactName || 'Cliente sin nombre'}</h3>
									<p>{cart.contactPhone || '-'}</p>
									{cart.contactEmail ? <p>{cart.contactEmail}</p> : null}
								</div>

								<span
									className={`status-badge ${
										cart.status === 'CONTACTED' ? 'status-contacted' : 'status-new'
									}`}
								>
									{cart.statusLabel || (cart.status === 'CONTACTED' ? 'Contactado' : 'Nuevo')}
								</span>
							</div>

							<div className="abandoned-card-focus">
								<div>
									<span>Monto</span>
									<strong>{cart.totalLabel}</strong>
								</div>

								<div className="abandoned-card-actions">
									{cart.canMessage ? (
										<button
											type="button"
											className="primary-action-btn"
											onClick={() => handleToggleMessageBox(cart)}
											disabled={sendingCartId === cart.id}
										>
											{activeMessageCartId === cart.id ? 'Cerrar mensaje' : 'Preparar mensaje'}
										</button>
									) : (
										<button type="button" className="primary-action-btn" disabled>
											Sin teléfono
										</button>
									)}

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
								</div>
							</div>

							<div className="abandoned-meta-grid">
								<div>
									<span>Fecha</span>
									<strong>{cart.displayCreatedAt || '-'}</strong>
								</div>

								<div>
									<span>Ubicación</span>
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
									Último envío: <strong>{cart.lastMessageSentLabel || 'Nunca'}</strong>
								</div>
							) : null}

							{activeMessageCartId === cart.id ? (
								<div className="abandoned-message-box">
									<label>
										<span>Mensaje para WhatsApp</span>
										<textarea
											value={messageDrafts[cart.id] || ''}
											onChange={(e) =>
												setMessageDrafts((prev) => ({
													...prev,
													[cart.id]: e.target.value
												}))
											}
										/>
									</label>

									<div className="abandoned-message-actions">
										<button
											type="button"
											className="secondary-link-btn"
											onClick={() => setActiveMessageCartId('')}
											disabled={sendingCartId === cart.id}
										>
											Cancelar
										</button>
										<button
											type="button"
											className="primary-action-btn"
											onClick={() => handleSendMessage(cart)}
											disabled={sendingCartId === cart.id}
										>
											{sendingCartId === cart.id ? 'Enviando...' : 'Enviar mensaje'}
										</button>
									</div>
								</div>
							) : null}
						</article>
					))}
				</div>
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
