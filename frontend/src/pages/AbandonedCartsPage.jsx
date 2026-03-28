import { useEffect, useState } from 'react';
import api from '../lib/api.js';

export default function AbandonedCartsPage() {
	const [loading, setLoading] = useState(true);
	const [syncing, setSyncing] = useState(false);
	const [data, setData] = useState({
		carts: [],
		stats: { total: 0, totalNew: 0, totalContacted: 0 },
		syncWindow: 7
	});

	async function loadAbandonedCarts() {
		setLoading(true);

		try {
			const res = await api.get('/dashboard/abandoned-carts');
			setData(res.data);
		} catch (error) {
			console.error(error);
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		loadAbandonedCarts();
	}, []);

	async function handleSync(daysBack = 7) {
		setSyncing(true);

		try {
			await api.post('/dashboard/abandoned-carts/sync', { daysBack });
			await loadAbandonedCarts();
		} catch (error) {
			console.error(error);
		} finally {
			setSyncing(false);
		}
	}

	return (
		<section className="page-card">
			<div className="page-header">
				<div>
					<h2>Carritos abandonados</h2>
					<p>Total: <strong>{data.stats?.total || 0}</strong></p>
				</div>

				<div className="inline-actions">
					<button onClick={() => handleSync(7)} disabled={syncing}>Sync 7 días</button>
					<button onClick={() => handleSync(15)} disabled={syncing}>Sync 15 días</button>
					<button onClick={() => handleSync(30)} disabled={syncing}>Sync 30 días</button>
				</div>
			</div>

			{loading ? <p>Cargando carritos...</p> : null}

			<div className="catalog-grid">
				{(data.carts || []).map((cart) => (
					<article key={cart.id} className="catalog-card">
						<h3>{cart.contactName || 'Sin nombre'}</h3>
						<p>{cart.contactPhone || 'Sin teléfono'}</p>
						<p>{cart.contactEmail || 'Sin email'}</p>
						<strong>{cart.totalLabel}</strong>
						<p>{cart.displayCreatedAt}</p>
					</article>
				))}
			</div>
		</section>
	);
}