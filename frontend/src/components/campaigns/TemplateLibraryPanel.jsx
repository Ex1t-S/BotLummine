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

function isMetaSampleTemplate(template) {
	return String(template?.name || '').trim().toLowerCase() === 'hello_world';
}

function getBodyPreview(template) {
	return (
		template.bodyText ||
		template.rawPayload?.components?.find((item) => String(item?.type || '').toUpperCase() === 'BODY')?.text ||
		'Sin vista previa de cuerpo.'
	);
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
	const [sortBy, setSortBy] = useState('updated_desc');

	const filteredTemplates = useMemo(() => {
		const normalizedSearch = search.trim().toLowerCase();

		const base = templates.filter((template) => {
			const haystack = [
				template.name,
				template.language,
				template.category,
				template.status,
				getBodyPreview(template),
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();

			const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
			const matchesCategory = category === 'all' || template.category === category;
			const matchesStatus = status === 'all' || template.status === status;

			return matchesSearch && matchesCategory && matchesStatus;
		});

		const sorted = [...base].sort((a, b) => {
			if (sortBy === 'name_asc') {
				return String(a?.name || '').localeCompare(String(b?.name || ''));
			}

			if (sortBy === 'name_desc') {
				return String(b?.name || '').localeCompare(String(a?.name || ''));
			}

			if (sortBy === 'updated_asc') {
				return new Date(a?.updatedAt || a?.createdAt || 0).getTime()
					- new Date(b?.updatedAt || b?.createdAt || 0).getTime();
			}

			return new Date(b?.updatedAt || b?.createdAt || 0).getTime()
				- new Date(a?.updatedAt || a?.createdAt || 0).getTime();
		});

		return sorted;
	}, [templates, search, category, status, sortBy]);

	const categories = useMemo(() => {
		return ['all', ...new Set(templates.map((template) => template.category).filter(Boolean))];
	}, [templates]);

	const statuses = useMemo(() => {
		return ['all', ...new Set(templates.map((template) => template.status).filter(Boolean))];
	}, [templates]);

	const approvedCount = templates.filter(
		(template) => String(template?.status || '').toUpperCase() === 'APPROVED'
	).length;

	const selectedTemplate =
		filteredTemplates.find((template) => template.id === selectedTemplateId) ||
		templates.find((template) => template.id === selectedTemplateId) ||
		null;

	return (
		<section className="campaign-panel campaign-panel--soft template-library-shell">
			<div className="template-library-header">
				<div>
					<span className="campaigns-eyebrow">Biblioteca</span>
					<h3>Elegí una base antes de editar</h3>
					<p>
						Buscá, filtrá y seleccioná el template correcto. La idea es que no tengas que andar pescándolo con red y snorkel.
					</p>
				</div>

				<button className="button secondary" onClick={onSync} disabled={syncing}>
					{syncing ? 'Sincronizando…' : 'Sincronizar con Meta'}
				</button>
			</div>

			<div className="campaign-inline-summary template-library-summary">
				<div className="campaign-inline-summary-item">
					<strong>{templates.length}</strong>
					<span>totales</span>
				</div>
				<div className="campaign-inline-summary-item">
					<strong>{approvedCount}</strong>
					<span>aprobados</span>
				</div>
				<div className="campaign-inline-summary-item">
					<strong>{filteredTemplates.length}</strong>
					<span>visibles</span>
				</div>
			</div>

			<div className="campaign-filters-grid">
				<label className="field">
					<span>Buscar</span>
					<input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="carrito, body, invierno..."
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

				<label className="field">
					<span>Orden</span>
					<select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
						<option value="updated_desc">Más recientes</option>
						<option value="updated_asc">Más viejos</option>
						<option value="name_asc">Nombre A-Z</option>
						<option value="name_desc">Nombre Z-A</option>
					</select>
				</label>
			</div>

			{selectedTemplate ? (
				<div className="template-library-selected-banner">
					<div>
						<span className="template-library-selected-label">Seleccionado</span>
						<strong>{selectedTemplate.name}</strong>
						<small>
							{selectedTemplate.language || 'es_AR'} · {selectedTemplate.category || 'MARKETING'}
						</small>
					</div>

					<div className="template-library-selected-status">
						<span className={statusClass(selectedTemplate.status || 'draft')}>
							{selectedTemplate.status || 'draft'}
						</span>
					</div>
				</div>
			) : null}

			<div className="campaign-list compact template-library-list">
				{filteredTemplates.length === 0 ? (
					<div className="campaign-empty-state">
						<strong>No hay templates que coincidan.</strong>
						<p>Probá otro filtro o sincronizá de nuevo.</p>
					</div>
				) : (
					filteredTemplates.map((template) => {
						const isSelected = template.id === selectedTemplateId;
						const isMetaSample = isMetaSampleTemplate(template);
						const bodyPreview = getBodyPreview(template);

						return (
							<article
								key={template.id}
								className={`campaign-list-card campaign-list-card--template template-list-card${isSelected ? ' selected' : ''}`}
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
									<div className="template-list-card-title">
										<strong>{template.name}</strong>
										<p>
											{template.language || 'es_AR'} · {template.category || 'MARKETING'}
										</p>
									</div>

									<span className={statusClass(template.status || 'draft')}>
										{template.status || 'draft'}
									</span>
								</div>

								<div className="template-list-card-tags">
									<span className="template-chip">{template.category || 'MARKETING'}</span>
									<span className="template-chip">{template.language || 'es_AR'}</span>
									{template.headerFormat ? (
										<span className="template-chip">{template.headerFormat}</span>
									) : null}
									{isMetaSample ? (
										<span className="template-chip template-chip--warning">sample Meta</span>
									) : null}
								</div>

								<p className="campaign-list-body">{bodyPreview}</p>

								<div className="campaign-list-card-bottom">
									<span>Actualizado: {formatDate(template.updatedAt || template.createdAt)}</span>

									<div className="campaign-inline-actions">
										<button
											type="button"
											className={`button ${isSelected ? 'secondary' : 'ghost'}`}
											onClick={(event) => {
												event.stopPropagation();
												onSelectTemplate(template);
											}}
										>
											{isSelected ? 'Seleccionado' : 'Usar'}
										</button>

										{!isMetaSample && template.id ? (
											<button
												type="button"
												className="button ghost"
												onClick={(event) => {
													event.stopPropagation();
													onDeleteTemplate(template);
												}}
											>
												Eliminar
											</button>
										) : null}
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