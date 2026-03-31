import { useMemo, useState } from 'react';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function statusClass(status = '') {
  return `campaign-badge ${String(status).toLowerCase()}`;
}

export default function TemplateLibraryPanel({
  templates = [],
  selectedTemplateId,
  onSelectTemplate,
  onSync,
  syncing,
  onDeleteTemplate,
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');

  const filteredTemplates = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return templates.filter((template) => {
      const matchesSearch =
        !normalizedSearch ||
        [template.name, template.language, template.category]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesCategory = category === 'all' || template.category === category;
      const matchesStatus = status === 'all' || template.status === status;

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [templates, search, category, status]);

  const categories = useMemo(() => {
    return ['all', ...new Set(templates.map((template) => template.category).filter(Boolean))];
  }, [templates]);

  const statuses = useMemo(() => {
    return ['all', ...new Set(templates.map((template) => template.status).filter(Boolean))];
  }, [templates]);

  return (
    <section className="campaign-panel">
      <div className="campaign-panel-header">
        <div>
          <h3>Biblioteca de templates</h3>
          <p>Plantillas sincronizadas desde Meta y listas para campañas.</p>
        </div>
        <button className="button secondary" onClick={onSync} disabled={syncing}>
          {syncing ? 'Sincronizando…' : 'Sync con Meta'}
        </button>
      </div>

      <div className="campaign-filters-grid">
        <label className="field">
          <span>Buscar</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ej. body negro xl"
          />
        </label>

        <label className="field">
          <span>Categoría</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item === 'all' ? 'Todas' : item}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Estado</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {statuses.map((item) => (
              <option key={item} value={item}>
                {item === 'all' ? 'Todos' : item}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="campaign-list">
        {filteredTemplates.length === 0 ? (
          <div className="campaign-empty-state">
            <strong>No hay templates que coincidan.</strong>
            <p>Probá otro filtro o sincronizá de nuevo con Meta.</p>
          </div>
        ) : (
          filteredTemplates.map((template) => {
            const isSelected = template.id === selectedTemplateId;

            return (
              <article
                key={template.id}
                className={`campaign-list-card${isSelected ? ' selected' : ''}`}
                onClick={() => onSelectTemplate(template)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectTemplate(template);
                  }
                }}
              >
                <div className="campaign-list-card-top">
                  <div>
                    <strong>{template.name}</strong>
                    <p>
                      {template.language || 'es_AR'} · {template.category || 'MARKETING'}
                    </p>
                  </div>
                  <span className={statusClass(template.status)}>{template.status || 'UNKNOWN'}</span>
                </div>

                <p className="campaign-list-body">
                  {template.bodyText || template.previewText || 'Sin texto de preview.'}
                </p>

                <div className="campaign-list-card-bottom">
                  <span>Última sync: {formatDate(template.updatedAt || template.syncedAt)}</span>
                  <div className="campaign-inline-actions">
                    <button
                      className="button ghost"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteTemplate(template);
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
