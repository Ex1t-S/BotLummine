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
	const hasItems = data.items.length > 0;

	return (
		<section className="page-card">
			<div className="page-header">
				<div>
					<span className="catalog-header-kicker">Inventario conectado</span>
					<h2>Catalogo comercial</h2>
					<p><strong>{data.total}</strong> productos sincronizados para busqueda y campanas.</p>
				</div>

				<div className="catalog-sync-controls">
					<select value={provider} onChange={(event) => setProvider(event.target.value)}>
						<option value="TIENDANUBE">Tiendanube</option>
						<option value="SHOPIFY">Shopify</option>
					</select>
					<button onClick={() => syncMutation.mutate()} disabled={syncing} type="button">
						{syncing ? 'Sincronizando...' : 'Sincronizar catalogo'}
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
					placeholder="Buscar producto, marca, SKU o etiqueta"
				/>
				<button type="submit">Buscar productos</button>
			</form>

			{loading ? (
				<div className="catalog-state">
					<strong>Cargando catalogo</strong>
					<span>Estamos trayendo productos, marcas e imagenes disponibles.</span>
				</div>
			) : null}

			{catalogQuery.isError ? (
				<div className="catalog-state catalog-state--error">
					<strong>No pudimos cargar el catalogo</strong>
					<span>Reintenta en unos segundos o verifica la integracion activa.</span>
				</div>
			) : null}

			{hasItems ? (
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
			) : !loading && !catalogQuery.isError ? (
				<div className="catalog-empty-state">
					<strong>No encontramos productos</strong>
					<span>Ajusta la busqueda o sincroniza el proveedor para actualizar el inventario.</span>
				</div>
			) : null}

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
