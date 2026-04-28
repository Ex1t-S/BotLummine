import { useEffect, useState } from 'react';
import api from '../lib/api.js';
import './CatalogPage.css';

export default function CatalogPage() {
	const [query, setQuery] = useState('');
	const [provider, setProvider] = useState('TIENDANUBE');
	const [loading, setLoading] = useState(true);
	const [syncing, setSyncing] = useState(false);
	const [data, setData] = useState({
		items: [],
		total: 0,
		page: 1,
		totalPages: 1
	});

	async function loadCatalog(nextQuery = '', nextPage = 1) {
		setLoading(true);

		try {
			const res = await api.get('/dashboard/catalog', {
				params: {
					q: nextQuery,
					page: nextPage
				}
			});

			setData({
				items: res.data.items || [],
				total: res.data.total || 0,
				page: res.data.page || 1,
				totalPages: res.data.totalPages || 1
			});
		} catch (error) {
			console.error(error);
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		loadCatalog();
	}, []);

	async function handleSearch(event) {
		event.preventDefault();
		loadCatalog(query, 1);
	}

	async function handleSync() {
		setSyncing(true);

		try {
			await api.post('/dashboard/catalog/sync', { provider });
			await loadCatalog(query, 1);
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
					<h2>Catalogo</h2>
					<p>Total: <strong>{data.total}</strong> productos</p>
				</div>

				<div className="catalog-sync-controls">
					<select value={provider} onChange={(event) => setProvider(event.target.value)}>
						<option value="TIENDANUBE">Tiendanube</option>
						<option value="SHOPIFY">Shopify</option>
					</select>
					<button onClick={handleSync} disabled={syncing} type="button">
						{syncing ? 'Sincronizando...' : 'Actualizar catalogo'}
					</button>
				</div>
			</div>

			<form onSubmit={handleSearch} className="catalog-search-form">
				<input
					type="text"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Buscar por nombre, marca o tags..."
				/>
				<button type="submit">Buscar</button>
			</form>

			{loading ? <p>Cargando catalogo...</p> : null}

			<div className="catalog-grid">
				{data.items.map((item) => (
					<article key={item.id} className="catalog-card">
						{item.featuredImage ? (
							<img src={item.featuredImage} alt={item.name} className="catalog-thumb" />
						) : (
							<div className="catalog-thumb-empty">Sin imagen</div>
						)}

						<h3>{item.name}</h3>
						<p>{item.brand || item.provider || 'Sin marca'}</p>
						<strong>{item.currentPriceLabel || 'Sin precio'}</strong>
					</article>
				))}
			</div>
		</section>
	);
}
