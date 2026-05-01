import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';
import './CatalogPage.css';

function useDebouncedValue(value, delay = 350) {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timeout = window.setTimeout(() => setDebounced(value), delay);
		return () => window.clearTimeout(timeout);
	}, [value, delay]);

	return debounced;
}

export default function CatalogPage() {
	const queryClient = useQueryClient();
	const [query, setQuery] = useState('');
	const [provider, setProvider] = useState('TIENDANUBE');
	const [page, setPage] = useState(1);
	const debouncedQuery = useDebouncedValue(query);

	const catalogParams = {
		q: debouncedQuery,
		page,
	};

	const catalogQuery = useQuery({
		queryKey: queryKeys.catalog(catalogParams),
		queryFn: async () => {
			const res = await api.get('/dashboard/catalog', {
				params: catalogParams,
			});

			return {
				items: res.data.items || [],
				total: res.data.total || 0,
				page: res.data.page || 1,
				totalPages: res.data.totalPages || 1,
			};
		},
		placeholderData: keepPreviousData,
		...queryPresets.catalog,
	});

	async function handleSearch(event) {
		event.preventDefault();
		setPage(1);
	}

	const syncMutation = useMutation({
		mutationFn: async () => {
			await api.post('/dashboard/catalog/sync', { provider });
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ['dashboard', 'catalog'] });
		},
		onError: (error) => {
			console.error(error);
		},
	});

	const data = catalogQuery.data || {
		items: [],
		total: 0,
		page: 1,
		totalPages: 1,
	};
	const loading = catalogQuery.isLoading;
	const syncing = syncMutation.isPending;

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
					<button onClick={() => syncMutation.mutate()} disabled={syncing} type="button">
						{syncing ? 'Sincronizando...' : 'Actualizar catalogo'}
					</button>
				</div>
			</div>

			<form onSubmit={handleSearch} className="catalog-search-form">
				<input
					type="text"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setPage(1);
					}}
					placeholder="Buscar por nombre, marca o tags..."
				/>
				<button type="submit">Buscar</button>
			</form>

			{loading ? <p>Cargando catalogo...</p> : null}
			{catalogQuery.isError ? <p>No se pudo cargar el catalogo.</p> : null}

			<div className="catalog-grid">
				{data.items.map((item) => (
					<article key={item.id} className="catalog-card">
						{item.featuredImage ? (
							<img
								src={item.featuredImage}
								alt={item.name}
								className="catalog-thumb"
								loading="lazy"
							/>
						) : (
							<div className="catalog-thumb-empty">Sin imagen</div>
						)}

						<h3>{item.name}</h3>
						<p>{item.brand || item.provider || 'Sin marca'}</p>
						<strong>{item.currentPriceLabel || 'Sin precio'}</strong>
					</article>
				))}
			</div>

			{data.totalPages > 1 ? (
				<div className="pagination-row compact-pagination">
					<button
						type="button"
						className="pagination-btn"
						disabled={data.page <= 1 || catalogQuery.isFetching}
						onClick={() => setPage((current) => Math.max(1, current - 1))}
					>
						Anterior
					</button>
					<span>
						Pagina {data.page} de {data.totalPages}
					</span>
					<button
						type="button"
						className="pagination-btn"
						disabled={data.page >= data.totalPages || catalogQuery.isFetching}
						onClick={() => setPage((current) => Math.min(data.totalPages, current + 1))}
					>
						Siguiente
					</button>
				</div>
			) : null}
		</section>
	);
}
