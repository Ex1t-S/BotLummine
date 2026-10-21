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
	const [editingProductId, setEditingProductId] = useState(null);
	const [commercialDraft, setCommercialDraft] = useState({});
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

	const commercialMutation = useMutation({
		mutationFn: async ({ productId, commercialData }) => {
			await api.patch(`/dashboard/catalog/${productId}/commercial-data`, { commercialData });
		},
		onSuccess: async () => {
			setEditingProductId(null);
			await queryClient.invalidateQueries({ queryKey: ['dashboard', 'catalog'] });
		},
	});

	function startEditing(item) {
		setEditingProductId(item.id);
		setCommercialDraft({
			presentationLabel: item.commercialData?.presentationLabel || '',
			unitsPerPack: item.commercialData?.unitsPerPack || '',
			offerLabel: item.commercialData?.offerLabel || '',
			offerPrice: item.commercialData?.offerPrice ?? '',
			offerStartsAt: item.commercialData?.offerStartsAt?.slice(0, 10) || '',
			offerEndsAt: item.commercialData?.offerEndsAt?.slice(0, 10) || '',
		});
		commercialMutation.reset();
	}

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
							<strong>{item.currentPriceLabel || 'Sin precio en Shopify'}</strong>
							<p className="catalog-stock-summary">Stock: {item.stockSummary}</p>
							{item.commercialData?.presentationLabel ? (
								<p>Presentación confirmada: {item.commercialData.presentationLabel}</p>
							) : null}
							{item.commercialData?.offerLabel ? (
								<p>Oferta cargada: {item.commercialData.offerLabel}{item.commercialData.offerPrice ? ` · $${Number(item.commercialData.offerPrice).toLocaleString('es-AR')}` : ''}</p>
							) : null}
							<button type="button" className="catalog-commercial-toggle" onClick={() => editingProductId === item.id ? setEditingProductId(null) : startEditing(item)}>
								{editingProductId === item.id ? 'Cerrar edición' : 'Editar presentación y oferta'}
							</button>
							{editingProductId === item.id ? (
								<form className="catalog-commercial-form" onSubmit={(event) => {
									event.preventDefault();
									commercialMutation.mutate({
										productId: item.id,
										commercialData: {
											...commercialDraft,
											unitsPerPack: commercialDraft.unitsPerPack === '' ? null : Number(commercialDraft.unitsPerPack),
											offerPrice: commercialDraft.offerPrice === '' ? null : Number(commercialDraft.offerPrice),
										},
									});
								}}>
									<label>Presentación confirmada<input maxLength={120} value={commercialDraft.presentationLabel || ''} placeholder="Pack de 4 unidades" onChange={(event) => setCommercialDraft((draft) => ({ ...draft, presentationLabel: event.target.value }))} /></label>
									<label>Unidades por pack<input type="number" min="2" max="100" value={commercialDraft.unitsPerPack || ''} placeholder="4" onChange={(event) => setCommercialDraft((draft) => ({ ...draft, unitsPerPack: event.target.value }))} /></label>
									<label>Oferta vigente confirmada<input maxLength={120} value={commercialDraft.offerLabel || ''} placeholder="Pack x 4 en promo" onChange={(event) => setCommercialDraft((draft) => ({ ...draft, offerLabel: event.target.value }))} /></label>
									<label>Precio de la oferta<input type="number" min="0" step="0.01" value={commercialDraft.offerPrice || ''} placeholder="39900" onChange={(event) => setCommercialDraft((draft) => ({ ...draft, offerPrice: event.target.value }))} /></label>
									<div className="catalog-commercial-dates">
										<label>Vigente desde<input type="date" value={commercialDraft.offerStartsAt || ''} onChange={(event) => setCommercialDraft((draft) => ({ ...draft, offerStartsAt: event.target.value }))} /></label>
										<label>Vigente hasta<input type="date" value={commercialDraft.offerEndsAt || ''} onChange={(event) => setCommercialDraft((draft) => ({ ...draft, offerEndsAt: event.target.value }))} /></label>
									</div>
									<p>El stock y el precio base siguen viniendo de Shopify. Estos datos manuales se conservan al sincronizar.</p>
									{commercialMutation.isError ? <p role="alert">{commercialMutation.error?.response?.data?.error || 'No se pudieron guardar los datos comerciales.'}</p> : null}
									<button type="submit" disabled={commercialMutation.isPending}>{commercialMutation.isPending ? 'Guardando…' : 'Guardar datos comerciales'}</button>
								</form>
							) : null}
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
