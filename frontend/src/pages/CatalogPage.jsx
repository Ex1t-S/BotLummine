import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import api from '../lib/api.js';
import { queryKeys, queryPresets } from '../lib/queryClient.js';
import { ActionButton, EmptyState, PageHeader } from '../components/ui/InternalPage.jsx';
import { useInternalDarkOverrides } from '../hooks/useInternalDarkOverrides.js';
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
	useInternalDarkOverrides();

	const queryClient = useQueryClient();
	const [query, setQuery] = useState('');
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
			await api.post('/dashboard/catalog/sync');
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
			<PageHeader
				eyebrow="Inventario conectado"
				title="Catálogo comercial"
				description={`${data.total} productos sincronizados para búsqueda y campañas.`}
			>
				<div className="catalog-sync-controls">
					<ActionButton onClick={() => syncMutation.mutate()} disabled={syncing} icon={RefreshCw}>
						{syncing ? 'Sincronizando' : 'Sincronizar catálogo'}
					</ActionButton>
				</div>
			</PageHeader>

			<form onSubmit={handleSearch} className="catalog-search-form">
				<label className="catalog-search-field">
					<span>Buscar en el catalogo</span>
					<input
						type="text"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setPage(1);
						}}
						placeholder="Producto, marca, SKU o etiqueta"
					/>
				</label>
				<ActionButton type="submit" icon={Search}>Buscar productos</ActionButton>
			</form>

			{loading ? (
				<EmptyState
					tone="loading"
					title="Cargando catálogo"
					description="Estamos trayendo productos, marcas e imágenes disponibles."
					className="catalog-state"
				/>
			) : null}

			{catalogQuery.isError ? (
				<EmptyState
					tone="error"
					title="No pudimos cargar el catálogo"
					description="Probá nuevamente en unos segundos o verificá la integración activa."
					className="catalog-state catalog-state--error"
				>
					<button type="button" onClick={() => catalogQuery.refetch()} disabled={catalogQuery.isFetching}>
						{catalogQuery.isFetching ? 'Reintentando' : 'Reintentar'}
					</button>
				</EmptyState>
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
				<EmptyState
					title="No encontramos productos"
					description="Probá otra búsqueda o sincronizá el proveedor para actualizar el inventario."
					className="catalog-empty-state"
				/>
			) : null}

			{data.totalPages > 1 ? (
				<nav className="pagination-row compact-pagination" aria-label="Paginacion del catalogo">
					<button
						type="button"
						className="pagination-btn"
						aria-label="Ir a la pagina anterior del catalogo"
						disabled={data.page <= 1 || catalogQuery.isFetching}
						onClick={() => setPage((current) => Math.max(1, current - 1))}
					>
						Anterior
					</button>
					<span aria-live="polite">
						Página {data.page} de {data.totalPages}
					</span>
					<button
						type="button"
						className="pagination-btn"
						aria-label="Ir a la pagina siguiente del catalogo"
						disabled={data.page >= data.totalPages || catalogQuery.isFetching}
						onClick={() => setPage((current) => Math.min(data.totalPages, current + 1))}
					>
						Siguiente
					</button>
				</nav>
			) : null}
		</section>
	);
}
