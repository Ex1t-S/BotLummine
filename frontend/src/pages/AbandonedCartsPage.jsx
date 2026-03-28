import { useEffect, useState } from 'react';
import api from '../lib/api.js';

const initialFilters = {
	q: '',
	status: 'ALL',
	dateFrom: '',
	dateTo: '',
	syncWindow: 7,
	page: 1
};

export default function AbandonedCartsPage() {
	const [loading, setLoading] = useState(true);
	const [syncing, setSyncing] = useState(false);
	const [sendingId, setSendingId] = useState('');
	const [filters, setFilters] = useState(initialFilters);
	const [messageDrafts, setMessageDrafts] = useState({});
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
			setMessageDrafts((prev) => ({ ...nextDrafts, ...prev }));
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
		setFilters(initialFilters);
		await loadAbandonedCarts(initialFilters);
	}

	async function handleSync(daysBack = 7) {
		setSyncing(true);

		try {
			await api.post('/dashboard/abandoned-carts/sync', { daysBack });
			const next = { ...filters, syncWindow: daysBack, page: 1 };
			setFilters(next);
			await loadAbandonedCarts(next);
		} catch (error) {
			console.error(error);
		} finally {
			setSyncing(false);
		}
	}

	async function handleSendWhatsApp(cartId) {
		const body = String(messageDrafts[cartId] || '').trim();

		if (!body) return;

		setSendingId(cartId);

		try {
			await api.post(`/dashboard/abandoned-carts/${cartId}/message`, { body });
			await loadAbandonedCarts(filters);
		} catch (error) {
			console.error(error);
		} finally {
			setSendingId('');
		}
	}

	async function handlePageChange(nextPage) {
		const next = {
			...filters,
			page: nextPage
		};
		setFilters(next);
		await loadAbandonedCarts(next);
	}

	return (
		<section className="page-card">
			<div className="page-header">
				<div>
					<h2>Carritos abandonados</h2>
					<p>
						Total: <strong>{data.stats?.total || 0}</strong>
					</p>
					<p className="muted-text">
						La sincronización actual no borra históricos: actualiza o crea los carritos dentro
						de la ventana elegida.
					</p>
				</div>

				<div className="inline-actions">
					<button onClick={() => handleSync(7)} disabled={syncing}>
						Sync 7 días
					</button>
					<button onClick={() => handleSync(15)} disabled={syncing}>
						Sync 15 días
					</button>
					<button onClick={() => handleSync(30)} disabled={syncing}>
						Sync 30 días
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

			<div className="catalog-grid">
				{(data.carts || []).map((cart) => (
					<article key={cart.id} className="catalog-card abandoned-card">
						<div className="abandoned-topline">
							<div className="abandoned-avatar">{cart.initials}</div>

							<div className="abandoned-head-copy">
								<h3>{cart.contactName || 'Sin nombre'}</h3>
								<p>{cart.contactPhone || 'Sin teléfono'}</p>
								<p>{cart.contactEmail || 'Sin email'}</p>
							</div>

							<span className={`status-badge ${cart.status === 'CONTACTED' ? 'contacted' : 'new'}`}>
								{cart.statusLabel}
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

						<div className="product-chips">
							{(cart.productsPreview || []).map((productName, index) => (
								<span key={`${cart.id}-${index}`} className="product-chip">
									{productName}
								</span>
							))}
						</div>

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
								onClick={() => handleSendWhatsApp(cart.id)}
								disabled={!cart.canMessage || sendingId === cart.id}
							>
								{sendingId === cart.id ? 'Enviando...' : 'Enviar WhatsApp'}
							</button>
						</div>

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
					</article>
				))}
			</div>

			{(data.pagination?.totalPages || 1) > 1 ? (
				<div className="pagination-row">
					{Array.from({ length: data.pagination.totalPages }, (_, index) => index + 1).map((pageNumber) => (
						<button
							key={pageNumber}
							type="button"
							className={`page-pill${pageNumber === data.pagination.page ? ' active' : ''}`}
							onClick={() => handlePageChange(pageNumber)}
						>
							{pageNumber}
						</button>
					))}
				</div>
			) : null}
		</section>
	);
}