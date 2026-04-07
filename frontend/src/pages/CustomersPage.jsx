
import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../lib/api.js';
import './CustomersPage.css';

const DEFAULT_PAGE_SIZE = 24;
const POLL_MS = 3500;
const CATALOG_SEARCH_DEBOUNCE_MS = 280;

const initialFilters = {
  q: '',
  productQuery: '',
  orderNumber: '',
  dateFrom: '',
  dateTo: '',
  paymentStatus: '',
  shippingStatus: '',
  minSpent: '',
  hasPhoneOnly: false,
  sort: 'purchase_desc',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};

const initialSyncStatus = {
  running: false,
  phase: 'idle',
  message: '',
  pagesFetched: 0,
  ordersFetched: 0,
  ordersUpserted: 0,
  itemsUpserted: 0,
  warnings: [],
  errors: [],
  hasMoreHistory: false,
  activeWindow: null,
};

function formatCurrency(value, currency = 'ARS') {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: currency || 'ARS',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${amount.toLocaleString('es-AR')}`;
  }
}

function formatDateTime(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function normalizeStats(data = {}) {
  const stats = data.stats || {};
  return {
    totalOrders: Number(stats.totalOrders || 0),
    totalCustomers: Number(stats.totalCustomers || 0),
    paidOrders: Number(stats.paidOrders || 0),
    withPhone: Number(stats.withPhone || 0),
    totalSpentLabel: formatCurrency(stats.totalSpent || 0, stats.currency || 'ARS'),
    avgTicketLabel: formatCurrency(stats.avgTicket || 0, stats.currency || 'ARS'),
    showingFrom: Number(stats.showingFrom || 0),
    showingTo: Number(stats.showingTo || 0),
  };
}

function buildVisiblePages(currentPage, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  if (start > 2) pages.push('left-ellipsis');
  for (let page = start; page <= end; page += 1) pages.push(page);
  if (end < totalPages - 1) pages.push('right-ellipsis');
  pages.push(totalPages);
  return pages;
}

function normalizeRequestFilters(filters) {
  return {
    q: filters.q || '',
    productQuery: filters.productQuery || '',
    orderNumber: filters.orderNumber || '',
    dateFrom: filters.dateFrom || '',
    dateTo: filters.dateTo || '',
    paymentStatus: filters.paymentStatus || '',
    shippingStatus: filters.shippingStatus || '',
    minSpent: filters.minSpent || '',
    hasPhoneOnly: filters.hasPhoneOnly ? '1' : '',
    sort: filters.sort || 'purchase_desc',
    page: filters.page || 1,
    pageSize: filters.pageSize || DEFAULT_PAGE_SIZE,
  };
}

function formatDuration(startedAt) {
  if (!startedAt) return '0s';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function buildSyncBadgeLabel(syncStatus) {
  if (syncStatus.running) return 'Sincronizando en vivo';
  if (syncStatus.errors?.length) return 'Sync con errores';
  if (syncStatus.hasMoreHistory) return 'Histórico pendiente';
  return 'Listo';
}

function slugifyProduct(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractCatalogProducts(payload) {
  const candidates = [
    payload?.products,
    payload?.items,
    payload?.catalog,
    payload?.rows,
    payload?.results,
  ];

  const rawList = candidates.find((entry) => Array.isArray(entry)) || [];

  return rawList
    .map((item) => {
      const id = String(item?.id ?? item?.productId ?? item?.externalProductId ?? item?.product_id ?? '');
      const label = String(
        item?.name || item?.title || item?.displayName || item?.productName || item?.label || ''
      ).trim();

      if (!label) return null;

      return {
        id: id || slugifyProduct(label),
        label,
        normalizedName: String(item?.normalizedName || item?.normalized_name || slugifyProduct(label)).trim(),
      };
    })
    .filter(Boolean);
}

function normalizeSelectedProductQuery(selectedProducts = []) {
  return selectedProducts
    .map((item) => String(item?.label || '').trim())
    .filter(Boolean)
    .join('||');
}

export default function CustomersPage() {
  const [filters, setFilters] = useState(initialFilters);
  const [data, setData] = useState({
    customers: [],
    stats: {},
    pagination: { page: 1, totalPages: 1, totalItems: 0, pageSize: DEFAULT_PAGE_SIZE },
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [syncStatus, setSyncStatus] = useState(initialSyncStatus);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogOptions, setCatalogOptions] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const pollRef = useRef(null);
  const productPickerRef = useRef(null);

  const normalizedStats = useMemo(() => normalizeStats(data), [data]);
  const currentPage = Number(data.pagination?.page || 1);
  const totalPages = Number(data.pagination?.totalPages || 1);
  const visiblePages = useMemo(() => buildVisiblePages(currentPage, totalPages), [currentPage, totalPages]);

  const selectedProductIds = useMemo(
    () => new Set(selectedProducts.map((item) => String(item.id))),
    [selectedProducts]
  );

  async function loadOrders(nextFilters = filters, { silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const response = await api.get('/dashboard/customers', { params: normalizeRequestFilters(nextFilters) });
      setData({
        customers: Array.isArray(response.data?.customers) ? response.data.customers : [],
        stats: response.data?.stats || {},
        pagination: response.data?.pagination || { page: 1, totalPages: 1, totalItems: 0, pageSize: DEFAULT_PAGE_SIZE },
      });
      if (response.data?.syncStatus) {
        setSyncStatus((prev) => ({ ...prev, ...response.data.syncStatus }));
        setSyncing(Boolean(response.data.syncStatus?.running));
      }
    } catch (error) {
      console.error(error);
      setErrorMessage(error?.response?.data?.message || 'No se pudieron cargar las compras.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadSyncStatus() {
    try {
      const response = await api.get('/dashboard/customers/sync-status');
      const status = response.data || initialSyncStatus;
      setSyncStatus(status);
      setSyncing(Boolean(status.running));
      return status;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  async function loadCatalogOptions(searchText = '') {
    setCatalogLoading(true);
    try {
      const response = await api.get('/dashboard/catalog', {
        params: { q: searchText || '', page: 1 },
      });
      const options = extractCatalogProducts(response.data);
      setCatalogOptions((prev) => {
        const map = new Map();
        [...selectedProducts, ...options, ...prev].forEach((item) => {
          if (!item?.id || !item?.label) return;
          map.set(String(item.id), item);
        });
        return Array.from(map.values()).slice(0, 36);
      });
    } catch (error) {
      console.error(error);
    } finally {
      setCatalogLoading(false);
    }
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const status = await loadSyncStatus();
      await loadOrders(filters, { silent: true });
      if (status && !status.running) stopPolling();
    }, POLL_MS);
  }

  useEffect(() => {
    loadOrders(initialFilters);
    loadSyncStatus().then((status) => {
      if (status?.running) startPolling();
    });
    loadCatalogOptions('');
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (productDropdownOpen) loadCatalogOptions(catalogSearch);
    }, CATALOG_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [catalogSearch, productDropdownOpen]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!productPickerRef.current?.contains(event.target)) {
        setProductDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  function updateFilter(name, value) {
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  function toggleProductSelection(option) {
    if (!option?.id) return;

    setSelectedProducts((prev) => {
      const exists = prev.some((item) => String(item.id) === String(option.id));
      const next = exists
        ? prev.filter((item) => String(item.id) !== String(option.id))
        : [...prev, option];

      setFilters((current) => ({
        ...current,
        productQuery: normalizeSelectedProductQuery(next),
      }));

      return next;
    });
  }

  function removeSelectedProduct(id) {
    setSelectedProducts((prev) => {
      const next = prev.filter((item) => String(item.id) !== String(id));
      setFilters((current) => ({
        ...current,
        productQuery: normalizeSelectedProductQuery(next),
      }));
      return next;
    });
  }

  async function handleApplyFilters(event) {
    event.preventDefault();
    const next = {
      ...filters,
      productQuery: normalizeSelectedProductQuery(selectedProducts),
      page: 1,
    };
    setFilters(next);
    await loadOrders(next);
  }

  async function handleResetFilters() {
    setSelectedProducts([]);
    setCatalogSearch('');
    setFilters(initialFilters);
    setErrorMessage('');
    await loadOrders(initialFilters);
  }

  async function handleSync() {
    setErrorMessage('');
    try {
      const response = await api.post('/dashboard/customers/sync', {});
      const status = response.data || initialSyncStatus;
      setSyncStatus(status);
      setSyncing(true);
      startPolling();
    } catch (error) {
      console.error(error);
      setErrorMessage(error?.response?.data?.message || 'No se pudo iniciar la sincronización de pedidos.');
    }
  }

  async function handlePageChange(page) {
    if (page < 1 || page > totalPages || page === currentPage) return;
    const next = { ...filters, page };
    setFilters(next);
    await loadOrders(next);
  }

  return (
    <section className="customers-page">
      <div className="customers-hero-card">
        <div className="customers-hero-copy">
          <span className="customers-kicker">VENTAS REALES</span>
          <h1>Clientes y compras</h1>
          <p>
            Vista comercial basada en pedidos reales. Vas viendo resultados mientras la sync avanza,
            sin dejar la pantalla colgada ni depender de recargar manualmente.
          </p>
        </div>

        <div className="customers-hero-actions">
          <button type="button" className="primary-action-btn" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Sincronizando pedidos...' : 'Sincronizar pedidos'}
          </button>
          <button type="button" className="secondary-link-btn" onClick={handleResetFilters} disabled={syncing && loading}>
            Limpiar filtros
          </button>
        </div>
      </div>

      {errorMessage ? <div className="customers-feedback customers-feedback--error">{errorMessage}</div> : null}

      <div className={`customers-sync-panel ${syncStatus.running ? 'is-running' : ''}`}>
        <div className="customers-sync-top">
          <div>
            <span className="customers-sync-kicker">{buildSyncBadgeLabel(syncStatus)}</span>
            <h3>{syncStatus.message || 'Todavía no corriste una sincronización.'}</h3>
            <p>
              {syncStatus.running
                ? `Tiempo transcurrido ${formatDuration(syncStatus.startedAt)} · páginas ${syncStatus.pagesFetched} · pedidos leídos ${syncStatus.ordersFetched} · pedidos guardados ${syncStatus.ordersUpserted}.`
                : syncStatus.finishedAt
                  ? `Última finalización ${formatDateTime(syncStatus.finishedAt)}.`
                  : 'Cuando empiece la sync, acá vas a ver el progreso en vivo.'}
            </p>
          </div>
          <div className="customers-sync-stats">
            <div><span>Páginas</span><strong>{syncStatus.pagesFetched || 0}</strong></div>
            <div><span>Pedidos</span><strong>{syncStatus.ordersFetched || 0}</strong></div>
            <div><span>Ítems</span><strong>{syncStatus.itemsUpserted || 0}</strong></div>
          </div>
        </div>
        <div className="customers-progress-track">
          <div className="customers-progress-bar" style={{ width: syncStatus.running ? '58%' : syncStatus.ordersFetched ? '100%' : '0%' }} />
        </div>
        {syncStatus.activeWindow ? (
          <p className="customers-sync-window">
            Ventana activa: <strong>{syncStatus.activeWindow.label}</strong> · {formatDateTime(syncStatus.activeWindow.from)} → {formatDateTime(syncStatus.activeWindow.to)}
          </p>
        ) : null}
        {syncStatus.warnings?.length ? (
          <div className="customers-sync-notes">
            {syncStatus.warnings.slice(-2).map((warning) => (
              <div key={`${warning.at}-${warning.message}`} className="customers-sync-note customers-sync-note--warning">{warning.message}</div>
            ))}
          </div>
        ) : null}
        {syncStatus.errors?.length ? (
          <div className="customers-sync-notes">
            {syncStatus.errors.slice(-2).map((item) => (
              <div key={`${item.at}-${item.message}`} className="customers-sync-note customers-sync-note--error">{item.message}</div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="customers-stats-grid">
        <div className="customers-stat-card"><span className="customers-stat-label">Pedidos</span><strong>{normalizedStats.totalOrders}</strong></div>
        <div className="customers-stat-card"><span className="customers-stat-label">Clientes únicos</span><strong>{normalizedStats.totalCustomers}</strong></div>
        <div className="customers-stat-card"><span className="customers-stat-label">Pagados</span><strong>{normalizedStats.paidOrders}</strong></div>
        <div className="customers-stat-card"><span className="customers-stat-label">Con teléfono</span><strong>{normalizedStats.withPhone}</strong></div>
        <div className="customers-stat-card"><span className="customers-stat-label">Ticket promedio</span><strong>{normalizedStats.avgTicketLabel}</strong></div>
        <div className="customers-stat-card"><span className="customers-stat-label">Facturación</span><strong>{normalizedStats.totalSpentLabel}</strong></div>
      </div>

      <form className="customers-filters-card" onSubmit={handleApplyFilters}>
        <div className="customers-filters-header">
          <div>
            <h3>Filtros comerciales</h3>
            <p>Buscá por nombre, teléfono, producto, número de pedido o estado sin depender del CRM viejo.</p>
          </div>
        </div>

        <div className="customers-filter-grid">
          <div className="customers-filter-group customers-filter-group--grow">
            <label htmlFor="customers-q">Buscar general</label>
            <input id="customers-q" type="text" value={filters.q} onChange={(e) => updateFilter('q', e.target.value)} placeholder="Nombre, email, teléfono, SKU o nro. de pedido" />
          </div>

          <div className="customers-filter-group customers-filter-group--grow" ref={productPickerRef}>
            <label htmlFor="catalog-product-search">Producto comprado</label>
            <div className={`product-picker ${productDropdownOpen ? 'is-open' : ''}`}>
              <button
                type="button"
                className="product-picker-trigger"
                onClick={() => {
                  setProductDropdownOpen((prev) => !prev);
                  if (!productDropdownOpen) loadCatalogOptions(catalogSearch);
                }}
              >
                <div className="product-picker-trigger-copy">
                  {selectedProducts.length ? (
                    <div className="product-picker-chip-list">
                      {selectedProducts.slice(0, 2).map((product) => (
                        <span key={product.id} className="product-picker-inline-chip">{product.label}</span>
                      ))}
                      {selectedProducts.length > 2 ? <span className="product-picker-inline-chip">+{selectedProducts.length - 2}</span> : null}
                    </div>
                  ) : (
                    <span className="product-picker-placeholder">Elegí productos del catálogo…</span>
                  )}
                </div>
                <span className="product-picker-arrow">▾</span>
              </button>

              {productDropdownOpen ? (
                <div className="product-picker-dropdown">
                  <div className="product-picker-search-row">
                    <input
                      id="catalog-product-search"
                      type="text"
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                      placeholder="Buscar en catálogo..."
                    />
                    <button type="button" className="product-picker-clear" onClick={() => setCatalogSearch('')}>Limpiar</button>
                  </div>

                  <div className="product-picker-options">
                    {catalogLoading ? <div className="product-picker-empty">Buscando productos…</div> : null}
                    {!catalogLoading && !catalogOptions.length ? <div className="product-picker-empty">No se encontraron productos del catálogo.</div> : null}
                    {!catalogLoading && catalogOptions.map((option) => {
                      const checked = selectedProductIds.has(String(option.id));
                      return (
                        <label key={option.id} className={`product-picker-option ${checked ? 'is-selected' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProductSelection(option)}
                          />
                          <span>{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            {selectedProducts.length ? (
              <div className="product-picker-selected-row">
                {selectedProducts.map((product) => (
                  <button key={product.id} type="button" className="product-picker-chip" onClick={() => removeSelectedProduct(product.id)}>
                    <span>{product.label}</span>
                    <strong>×</strong>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="customers-filter-group">
            <label htmlFor="customers-order-number">N° pedido</label>
            <input id="customers-order-number" type="text" value={filters.orderNumber} onChange={(e) => updateFilter('orderNumber', e.target.value)} placeholder="Ej: 23621" />
          </div>
          <div className="customers-filter-group">
            <label htmlFor="customers-date-from">Compra desde</label>
            <input id="customers-date-from" type="date" value={filters.dateFrom} onChange={(e) => updateFilter('dateFrom', e.target.value)} />
          </div>
          <div className="customers-filter-group">
            <label htmlFor="customers-date-to">Compra hasta</label>
            <input id="customers-date-to" type="date" value={filters.dateTo} onChange={(e) => updateFilter('dateTo', e.target.value)} />
          </div>
          <div className="customers-filter-group">
            <label htmlFor="customers-payment-status">Pago</label>
            <select id="customers-payment-status" value={filters.paymentStatus} onChange={(e) => updateFilter('paymentStatus', e.target.value)}>
              <option value="">Todos</option>
              <option value="paid">Pagado</option>
              <option value="pending">Pendiente</option>
              <option value="authorized">Autorizado</option>
              <option value="refunded">Reintegrado</option>
              <option value="voided">Anulado</option>
            </select>
          </div>
          <div className="customers-filter-group">
            <label htmlFor="customers-shipping-status">Envío</label>
            <select id="customers-shipping-status" value={filters.shippingStatus} onChange={(e) => updateFilter('shippingStatus', e.target.value)}>
              <option value="">Todos</option>
              <option value="fulfilled">Enviado</option>
              <option value="unpacked">Por empaquetar</option>
              <option value="unfulfilled">No enviado</option>
            </select>
          </div>
          <div className="customers-filter-group">
            <label htmlFor="customers-min-spent">Total mínimo</label>
            <input id="customers-min-spent" type="number" min="0" step="1" value={filters.minSpent} onChange={(e) => updateFilter('minSpent', e.target.value)} placeholder="50000" />
          </div>
          <div className="customers-filter-group">
            <label htmlFor="customers-sort">Ordenar por</label>
            <select id="customers-sort" value={filters.sort} onChange={(e) => updateFilter('sort', e.target.value)}>
              <option value="purchase_desc">Compra más reciente</option>
              <option value="purchase_asc">Compra más antigua</option>
              <option value="total_desc">Mayor total</option>
              <option value="total_asc">Menor total</option>
              <option value="name_asc">Nombre A-Z</option>
              <option value="name_desc">Nombre Z-A</option>
              <option value="number_desc">N° pedido mayor</option>
              <option value="number_asc">N° pedido menor</option>
            </select>
          </div>
        </div>

        <div className="customers-toggle-row">
          <div className="customers-toggle-group">
            <label className="customers-checkbox">
              <input type="checkbox" checked={filters.hasPhoneOnly} onChange={(e) => updateFilter('hasPhoneOnly', e.target.checked)} />
              <span>Solo con teléfono</span>
            </label>
          </div>
          <div className="customers-filter-actions">
            <button type="submit" className="secondary-link-btn customers-apply-btn">Aplicar filtros</button>
          </div>
        </div>
      </form>

      <div className="customers-list-card">
        <div className="customers-list-topbar">
          <div>
            <h3>Listado comercial</h3>
            <p>Mostrando {normalizedStats.showingFrom}-{normalizedStats.showingTo} de {data.pagination?.totalItems || 0}</p>
          </div>
        </div>

        {loading ? <div className="customers-empty-state">Cargando compras...</div> : null}
        {!loading && !data.customers?.length ? <div className="customers-empty-state">No hay compras para esos filtros. Probá ampliar la búsqueda o dejar que la sync avance un poco más.</div> : null}

        {!loading && data.customers?.length ? (
          <div className="customers-grid">
            {data.customers.map((customer) => (
              <article key={customer.id} className="customer-card">
                <div className="customer-card-topbar">
                  <div className="customer-identity">
                    <div className="customer-avatar">{customer.initials || '?'}</div>
                    <div className="customer-identity-copy">
                      <h4>{customer.displayName || 'Cliente sin nombre'}</h4>
                      {customer.phone ? <p>{customer.phone}</p> : null}
                      {customer.email ? <p>{customer.email}</p> : null}
                    </div>
                  </div>
                  <div className="customer-order-badge">
                    <span>Pedido</span>
                    <strong>{customer.lastOrderLabel || '-'}</strong>
                  </div>
                </div>

                <div className="customer-meta-row customer-meta-row--compact">
                  <div className="customer-meta-chip"><span>Total</span><strong>{customer.totalSpentLabel || '$0'}</strong></div>
                  <div className="customer-meta-chip"><span>Fecha</span><strong>{customer.lastOrderDateLabel || '-'}</strong></div>
                </div>

                <div className="customer-section-box">
                  <div className="customer-section-header">
                    <span>Productos comprados</span>
                    <strong>{customer.totalUnitsPurchased || 0} unidades</strong>
                  </div>
                  {customer.productsPreview?.length ? (
                    <ul className="customer-products-list">
                      {customer.productsPreview.map((product) => (
                        <li key={`${customer.id}-${product}`}>{product}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="customer-products-empty">Todavía no quedó guardado el detalle de productos.</p>
                  )}
                </div>

                <div className="customer-footer-row">
                  <span>Actualizado</span>
                  <strong>{formatDateTime(customer.updatedAt)}</strong>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {totalPages > 1 ? (
          <div className="pagination-row compact-pagination">
            <button type="button" className="pagination-btn" disabled={currentPage === 1} onClick={() => handlePageChange(currentPage - 1)}>
              ← Anterior
            </button>
            <div className="pagination-pages">
              {visiblePages.map((page) =>
                String(page).includes('ellipsis') ? (
                  <span key={page} className="pagination-ellipsis">…</span>
                ) : (
                  <button key={page} type="button" className={`pagination-page-btn ${page === currentPage ? 'is-active' : ''}`} onClick={() => handlePageChange(page)}>
                    {page}
                  </button>
                )
              )}
            </div>
            <button type="button" className="pagination-btn" disabled={currentPage === totalPages} onClick={() => handlePageChange(currentPage + 1)}>
              Siguiente →
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
