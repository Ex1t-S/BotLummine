import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import {
	formatHeaderFormatLabel,
	formatTemplateCategoryLabel,
	formatTemplateStatusLabel,
} from '../../utils/statusLabels.js';

function formatDate(value) {
	if (!value) return '--';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '--';

	return new Intl.DateTimeFormat('es-AR', {
		dateStyle: 'short',
		timeStyle: 'short',
	}).format(date);
}

function statusClass(status = '') {
	return `campaign-badge template-status ${String(status).toLowerCase()}`;
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
	onEditTemplate,
	onCreateTemplate,
	onSync,
	syncing,
	onPurgeDeleted,
	purgingDeleted,
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

	return (
		<section className="campaign-panel campaign-panel--soft template-library-shell">
			<div className="template-library-header">
				<div>
					<span className="campaigns-eyebrow">Biblioteca</span>
					<h3>Elegí la plantilla para tu próxima campaña</h3>
					<p>
						Buscá por nombre, estado o contenido y seleccioná la plantilla que vas a usar,
						editar o programar.
					</p>
				</div>

				<div className="template-library-header-actions">
					<button className="button primary" onClick={onCreateTemplate}>
						Crear plantilla
					</button>

					<button className="button secondary" onClick={onSync} disabled={syncing}>
						{syncing ? 'Sincronizando...' : 'Sincronizar plantillas'}
					</button>

					<button
						className="button ghost"
						onClick={onPurgeDeleted}
						disabled={purgingDeleted}
						title="Limpia de la base local las plantillas ya marcadas como eliminadas"
					>
						{purgingDeleted ? 'Limpiando...' : 'Limpiar eliminados'}
					</button>
				</div>
			</div>

			<div className="template-library-overview" aria-label="Resumen de plantillas">
				<p>
					<strong>{templates.length}</strong> disponibles
					<span aria-hidden="true">·</span>
					<strong>{approvedCount}</strong> listas para enviar
				</p>
				<span className="template-library-result-count" role="status" aria-live="polite">
					{filteredTemplates.length === templates.length
						? 'Mostrando todas'
						: `${filteredTemplates.length} de ${templates.length} visibles`}
				</span>
			</div>

			<div className="campaign-filters-grid">
				<label className="field">
					<span>Buscar</span>
					<input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="carrito, promo, invierno..."
					/>
				</label>

				<label className="field">
					<span>Categoria</span>
					<select value={category} onChange={(event) => setCategory(event.target.value)}>
						{categories.map((item) => (
							<option key={item} value={item}>
								{item === 'all' ? 'Todas' : formatTemplateCategoryLabel(item)}
							</option>
						))}
					</select>
				</label>

				<label className="field">
					<span>Estado</span>
					<select value={status} onChange={(event) => setStatus(event.target.value)}>
						{statuses.map((item) => (
							<option key={item} value={item}>
								{item === 'all' ? 'Todos' : formatTemplateStatusLabel(item)}
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

			<div className="campaign-list template-library-list" role="list" aria-label="Plantillas disponibles">
				{filteredTemplates.length === 0 ? (
					<div className="campaign-empty-state">
						<strong>No hay plantillas que coincidan.</strong>
						<p>Probá otro filtro o sincronizá las plantillas de Meta.</p>
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
								role="listitem"
								aria-label={`${template.name}, ${formatTemplateStatusLabel(template.status)}`}
							>
								<div className="campaign-list-card-top">
									<div className="template-list-card-title">
										<h4>{template.name}</h4>
										<p>
											{template.language || 'es_AR'} - {formatTemplateCategoryLabel(template.category)}
										</p>
									</div>

									<div className="template-list-card-top-actions">
										<span className={statusClass(template.status || 'draft')}>
											{formatTemplateStatusLabel(template.status)}
										</span>
										{isSelected ? (
											<span className="template-selection-state">
												<Check size={14} strokeWidth={2.5} aria-hidden="true" />
												Elegida
											</span>
										) : null}
									</div>
								</div>

								<div className="template-card-meta" aria-label="Formato de la plantilla">
									{template.headerFormat ? (
										<span>{formatHeaderFormatLabel(template.headerFormat)}</span>
									) : null}
									{isMetaSample ? (
										<span className="template-card-meta-warning">Muestra de Meta</span>
									) : null}
								</div>

								<p className="campaign-list-body">{bodyPreview}</p>

								<div className="campaign-list-card-bottom">
									<span>Actualizado: {formatDate(template.updatedAt || template.createdAt)}</span>

									<div className="campaign-inline-actions">
										<button
											type="button"
											className={`button template-select-button${isSelected ? ' is-selected' : ''}`}
											onClick={() => onSelectTemplate(template)}
											aria-pressed={isSelected}
										>
											{isSelected ? 'Plantilla elegida' : 'Elegir plantilla'}
										</button>

										<button
											type="button"
											className="button ghost template-secondary-action"
											onClick={() => onEditTemplate?.(template)}
										>
											Editar
										</button>

										{!isMetaSample && template.id ? (
											<button
												type="button"
												className="button ghost template-secondary-action template-secondary-action--danger"
												onClick={() => onDeleteTemplate(template)}
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
