import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api.js';
import './CustomersPage.css';

const DEFAULT_PAGE_SIZE = 24;

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
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

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

function formatDurationMs(value) {
  const totalMs = Number(value || 0);
  if (!Number.isFinite(totalMs) || totalMs <= 0) return '0s';

  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function buildSyncMessage(payload = {}) {
  const pagesFetched = Number(payload.pagesFetched || 0);
  const ordersFetched = Number(payload.ordersFetched || 0);
  const ordersUpserted = Number(payload.ordersUpserted || 0);
  const itemsUpserted = Number(payload.itemsUpserted || 0);
  const localOrdersAfter = Number(payload.localOrdersAfter || 0);
  const durationLabel = formatDurationMs(payload.durationMs || 0);
  const historicalLabel = payload.hasMoreHistory
    ? 'Todavía quedan páginas históricas pendientes.'
    : 'No quedan más páginas históricas pendientes.';

  return `Sync lista · páginas ${pagesFetched} · pedidos leídos ${ordersFetched} · pedidos guardados ${ordersUpserted} · ítems guardados ${itemsUpserted} · total local ${localOrdersAfter} · duración ${durationLabel}. ${historicalLabel}`;
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
  const [syncMessage, setSyncMessage] = useState('');

  const normalizedStats = useMemo(() => normalizeStats(data), [data]);
  const currentPage = Number(data.pagination?.page || 1);
  const totalPages = Number(data.pagination?.totalPages || 1);
  const visiblePages = useMemo(() => buildVisiblePages(currentPage, totalPages), [currentPage, totalPages]);

  async function loadOrders(nextFilters = filters) {
    setLoading(true);
    setErrorMessage('');

    try {
      const response = await api.get('/dashboard/customers', {
        params: normalizeRequestFilters(nextFilters),
      });

      setData({
        customers: Array.isArray(response.data?.customers) ? response.data.customers : [],
        stats: response.data?.stats || {},
        pagination:
          response.data?.pagination || {
            page: 1,
            totalPages: 1,
            totalItems: 0,
            pageSize: DEFAULT_PAGE_SIZE,
          },
      });
    } catch (error) {
      console.error(error);
      setErrorMessage(error?.response?.data?.message || 'No se pudieron cargar las compras.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders(initialFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(name, value) {
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  async function handleApplyFilters(event) {
    event.preventDefault();
    const next = { ...filters, page: 1 };
    setFilters(next);
    await loadOrders(next);
  }

  async function handleResetFilters() {
    setFilters(initialFilters);
    setErrorMessage('');
    setSyncMessage('');
    await loadOrders(initialFilters);
  }

  async function handleSync() {
    setSyncing(true);
    setErrorMessage('');
    setSyncMessage('');

    try {
      const response = await api.post('/dashboard/customers/sync', {});
      setSyncMessage(buildSyncMessage(response.data));
      await loadOrders({ ...filters, page: 1 });
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error?.response?.data?.message ||
          'No se pudo sincronizar pedidos. Revisá credenciales de Tiendanube o la base de datos.'
      );
    } finally {
      setSyncing(false);
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
            Esta vista ahora se arma desde pedidos reales de Tiendanube. El foco ya no es un CRM
            inflado, sino ver rápido quién compró, cuánto gastó y qué producto se llevó.
          </p>
        </div>

        <div className="customers-hero-actions">
          <button type="button" className="primary-action-btn" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Sincronizando...' : 'Sincronizar pedidos'}
          </button>

          <button type="button" className="secondary-link-btn" onClick={handleResetFilters}>
            Limpiar filtros
          </button>
        </div>
      </div>

      {errorMessage ? <div className="customers-feedback customers-feedback--error">{errorMessage}</div> : null}
      {syncMessage ? <div className="customers-feedback customers-feedback--success">{syncMessage}</div> : null}

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
            <p>Buscá por cliente, pedido o producto usando compras reales.</p>
          </div>
        </div>

        <div className="customers-filter-grid">
          <div className="customers-filter-group customers-filter-group--grow">
            <label htmlFor="customers-q">Buscar</label>
            <input id="customers-q" type="text" value={filters.q} onChange={(e) => updateFilter('q', e.target.value)} placeholder="Nombre, email, teléfono, SKU o nro. de pedido" />
          </div>

          <div className="customers-filter-group">
            <label htmlFor="customers-product">Producto comprado</label>
            <input id="customers-product" type="text" value={filters.productQuery} onChange={(e) => updateFilter('productQuery', e.target.value)} placeholder="Body, calza, pack 3x1..." />
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

        {!loading && !data.customers?.length ? (
          <div className="customers-empty-state">No hay compras para esos filtros. Probá ampliar la búsqueda o correr una sync.</div>
        ) : null}

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

                <div className="customer-meta-row">
                  <div className="customer-meta-chip"><span>Total</span><strong>{customer.totalSpentLabel || '$0'}</strong></div>
                  <div className="customer-meta-chip"><span>Fecha</span><strong>{customer.lastOrderDateLabel || '-'}</strong></div>
                  <div className="customer-meta-chip"><span>Pago</span><strong>{customer.paymentStatus || '-'}</strong></div>
                  <div className="customer-meta-chip"><span>Envío</span><strong>{customer.shippingStatus || '-'}</strong></div>
                </div>

                <div className="customer-section-box">
                  <div className="customer-section-header">
                    <span>Productos comprados</span>
                    <strong>{customer.totalUnitsPurchased || 0} unidades</strong>
                  </div>

                  {customer.lastOrderProductsPreview?.length ? (
                    <ul className="customer-products-list">
                      {customer.lastOrderProductsPreview.map((product) => (
                        <li key={`${customer.id}-${product}`}>{product}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="customer-products-empty">No quedó guardado el detalle del pedido todavía.</p>
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
