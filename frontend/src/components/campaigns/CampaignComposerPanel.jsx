import { useEffect, useMemo, useState } from 'react';
import {
	fetchCampaignCustomers,
	uploadCampaignHeaderImage,
} from '../../lib/campaigns.js';

const SAFE_MAX_CUSTOMER_PAGES = 20;

const initialForm = {
	name: '',
	description: '',
	audienceMode: 'customers',
	audienceText: '',
	sendNow: false,
};

const initialCustomerFilters = {
	q: '',
	sort: 'updated_desc',
	page: 1,
	pageSize: 24,
	minSpent: '',
	minOrders: '',
	hasPhoneOnly: true,
	hasOrders: true,
	productQuery: '',
};

function normalizeType(value = '') {
	return String(value || '').trim().toUpperCase();
}

function normalizePhone(value = '') {
	return String(value || '').replace(/\D/g, '').trim();
}

function getTemplateComponents(template) {
	if (Array.isArray(template?.components)) return template.components;
	if (Array.isArray(template?.rawPayload?.components)) return template.rawPayload.components;
	return [];
}

function templateRequiresHeaderImage(template) {
	const components = getTemplateComponents(template);

	const header = components.find(
		(component) => normalizeType(component?.type) === 'HEADER'
	);

	if (!header) return false;

	return normalizeType(header?.format) === 'IMAGE';
}

function parseAudience(rawValue = '', extraVariables = {}) {
	return rawValue
		.split('\n')
		.map((row) => row.trim())
		.filter(Boolean)
		.map((row) => {
			const [phone, contactName, productName, size, color] = row
				.split('|')
				.map((value) => value?.trim() || '');

			const normalizedPhone = normalizePhone(phone);

			return {
				phone: normalizedPhone,
				contactName,
				variables: {
					'1': contactName || '',
					'2': productName || '',
					'3': size || '',
					'4': color || '',
					contact_name: contactName || '',
					first_name: (contactName || '').split(/\s+/).filter(Boolean)[0] || '',
					product_name: productName || '',
					size: size || '',
					color: color || '',
					...extraVariables,
				},
			};
		})
		.filter((item) => item.phone);
}

function extractCreatedCampaignId(result) {
	return (
		result?.id ||
		result?.campaign?.id ||
		result?.data?.id ||
		result?.data?.campaign?.id ||
		null
	);
}

function getPrimaryProductName(customer = {}) {
	if (customer.primaryProductLabel) return customer.primaryProductLabel;

	if (!Array.isArray(customer.productSummary) || !customer.productSummary.length) {
		return '';
	}

	const first = customer.productSummary[0];

	if (typeof first === 'string') return first;
	if (typeof first?.name === 'string') return first.name;
	if (typeof first?.productName === 'string') return first.productName;
	if (typeof first?.title === 'string') return first.title;
	if (typeof first?.label === 'string') return first.label;

	return '';
}

function customerToRecipient(customer, extraVariables = {}) {
	const normalizedPhone = normalizePhone(customer?.phone || '');
	const contactName =
		customer?.displayName || customer?.email || normalizedPhone || 'Cliente';
	const firstName =
		contactName.split(/\s+/).filter(Boolean)[0] || contactName || 'Cliente';
	const primaryProductName = getPrimaryProductName(customer);

	return {
		externalKey: `customer:${customer.id}`,
		phone: normalizedPhone,
		contactName,
		variables: {
			'1': contactName,
			'2': primaryProductName || '',
			'3': '',
			'4': '',
			contact_name: contactName,
			first_name: firstName,
			customer_name: contactName,
			customer_email: customer?.email || '',
			product_name: primaryProductName || '',
			order_count: String(customer?.orderCount || 0),
			last_order_id: customer?.lastOrderId || '',
			total_spent: String(customer?.totalSpent || ''),
			total_spent_label: customer?.totalSpentLabel || '',
			...extraVariables,
		},
	};
}

function mapCustomersById(customers = []) {
	const next = {};

	for (const customer of customers) {
		if (!customer?.id) continue;

		const normalizedPhone = normalizePhone(customer.phone || '');
		if (!normalizedPhone) continue;

		next[customer.id] = customer;
	}

	return next;
}

export default function CampaignComposerPanel({
	templates = [],
	selectedTemplate,
	onSelectTemplate,
	onCreateCampaign,
	creating,
}) {
	const [form, setForm] = useState(initialForm);
	const [uploadingImage, setUploadingImage] = useState(false);
	const [uploadedMediaId, setUploadedMediaId] = useState('');
	const [uploadedFileName, setUploadedFileName] = useState('');
	const [imageError, setImageError] = useState('');
	const [submitError, setSubmitError] = useState('');

	const [customerFilters, setCustomerFilters] = useState(initialCustomerFilters);
	const [customerAudience, setCustomerAudience] = useState({
		customers: [],
		stats: {},
		pagination: {
			page: 1,
			totalPages: 1,
			totalItems: 0,
			pageSize: initialCustomerFilters.pageSize,
		},
		loading: false,
		loadingAll: false,
		error: '',
	});
	const [selectedCustomersMap, setSelectedCustomersMap] = useState({});

	useEffect(() => {
		if (!selectedTemplate && templates.length) {
			onSelectTemplate(templates[0]);
		}
	}, [templates, selectedTemplate, onSelectTemplate]);

	useEffect(() => {
		setUploadedMediaId('');
		setUploadedFileName('');
		setImageError('');
	}, [selectedTemplate?.id]);

	useEffect(() => {
		if (
			form.audienceMode === 'customers' &&
			!customerAudience.loading &&
			!customerAudience.customers.length &&
			!customerAudience.error
		) {
			void loadCustomers(customerFilters);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [form.audienceMode]);

	const requiresHeaderImage = useMemo(
		() => templateRequiresHeaderImage(selectedTemplate),
		[selectedTemplate]
	);

	const extraVariables = useMemo(
		() => (uploadedMediaId ? { header_image_id: uploadedMediaId } : {}),
		[uploadedMediaId]
	);

	const manualRecipients = useMemo(
		() => parseAudience(form.audienceText, extraVariables),
		[form.audienceText, extraVariables]
	);

	const selectedCustomers = useMemo(
		() => Object.values(selectedCustomersMap),
		[selectedCustomersMap]
	);

	const customerRecipients = useMemo(() => {
		return selectedCustomers
			.map((customer) => customerToRecipient(customer, extraVariables))
			.filter((recipient) => recipient.phone);
	}, [selectedCustomers, extraVariables]);

	const recipients = useMemo(() => {
		return form.audienceMode === 'customers' ? customerRecipients : manualRecipients;
	}, [form.audienceMode, customerRecipients, manualRecipients]);

	const estimatedCost = useMemo(() => recipients.length * 0.032, [recipients.length]);

	const currentPageSelectableCustomers = useMemo(() => {
		return customerAudience.customers.filter((customer) =>
			Boolean(normalizePhone(customer.phone || ''))
		);
	}, [customerAudience.customers]);

	const selectedCustomerCount = selectedCustomers.length;

	const selectedPageCount = currentPageSelectableCustomers.filter(
		(customer) => Boolean(selectedCustomersMap[customer.id])
	).length;

	const allPageSelected =
		currentPageSelectableCustomers.length > 0 &&
		currentPageSelectableCustomers.every((customer) => selectedCustomersMap[customer.id]);

	async function loadCustomers(nextFilters = customerFilters) {
		setCustomerAudience((current) => ({
			...current,
			loading: true,
			error: '',
		}));

		try {
			const data = await fetchCampaignCustomers({
				q: nextFilters.q || '',
				sort: nextFilters.sort || 'updated_desc',
				page: nextFilters.page || 1,
				pageSize: nextFilters.pageSize || 24,
				minSpent:
					nextFilters.minSpent === '' || nextFilters.minSpent === null
						? undefined
						: Number(nextFilters.minSpent),
				minOrders:
					nextFilters.minOrders === '' || nextFilters.minOrders === null
						? undefined
						: Number(nextFilters.minOrders),
				hasPhoneOnly: nextFilters.hasPhoneOnly ? 'true' : 'false',
				hasOrders: nextFilters.hasOrders ? 'true' : 'false',
				productQuery: nextFilters.productQuery || '',
			});

			setCustomerAudience((current) => ({
				...current,
				customers: Array.isArray(data?.customers) ? data.customers : [],
				stats: data?.stats || {},
				pagination: data?.pagination || {
					page: 1,
					totalPages: 1,
					totalItems: 0,
					pageSize: nextFilters.pageSize || 24,
				},
				loading: false,
				error: '',
			}));
		} catch (error) {
			setCustomerAudience((current) => ({
				...current,
				customers: [],
				loading: false,
				error:
					error?.response?.data?.message ||
					error?.response?.data?.error ||
					'No se pudieron cargar los clientes.',
			}));
		}
	}

	function updateCustomerFilter(field, value) {
		setCustomerFilters((current) => ({
			...current,
			[field]: value,
			page: field === 'page' ? value : 1,
		}));
	}

	function toggleCustomerSelection(customer) {
		const normalizedPhone = normalizePhone(customer?.phone || '');

		if (!normalizedPhone || !customer?.id) return;

		setSelectedCustomersMap((current) => {
			const next = { ...current };

			if (next[customer.id]) {
				delete next[customer.id];
			} else {
				next[customer.id] = customer;
			}

			return next;
		});
	}

	function toggleCurrentPageSelection() {
		if (!currentPageSelectableCustomers.length) return;

		setSelectedCustomersMap((current) => {
			const next = { ...current };

			if (allPageSelected) {
				for (const customer of currentPageSelectableCustomers) {
					delete next[customer.id];
				}
				return next;
			}

			for (const customer of currentPageSelectableCustomers) {
				next[customer.id] = customer;
			}

			return next;
		});
	}

	async function handleLoadAllFilteredCustomers() {
		setCustomerAudience((current) => ({
			...current,
			loadingAll: true,
			error: '',
		}));

		try {
			const firstPage = await fetchCampaignCustomers({
				q: customerFilters.q || '',
				sort: customerFilters.sort || 'updated_desc',
				page: 1,
				pageSize: customerFilters.pageSize || 24,
				minSpent:
					customerFilters.minSpent === '' || customerFilters.minSpent === null
						? undefined
						: Number(customerFilters.minSpent),
				minOrders:
					customerFilters.minOrders === '' || customerFilters.minOrders === null
						? undefined
						: Number(customerFilters.minOrders),
				hasPhoneOnly: customerFilters.hasPhoneOnly ? 'true' : 'false',
				hasOrders: customerFilters.hasOrders ? 'true' : 'false',
				productQuery: customerFilters.productQuery || '',
			});

			const totalPages = Number(firstPage?.pagination?.totalPages || 1);

			if (totalPages > SAFE_MAX_CUSTOMER_PAGES) {
				throw new Error(
					`Hay ${totalPages} páginas con esos filtros. Afiná la búsqueda antes de traerlos todos.`
				);
			}

			const allCustomers = Array.isArray(firstPage?.customers)
				? [...firstPage.customers]
				: [];

			for (let page = 2; page <= totalPages; page += 1) {
				const nextPage = await fetchCampaignCustomers({
					q: customerFilters.q || '',
					sort: customerFilters.sort || 'updated_desc',
					page,
					pageSize: customerFilters.pageSize || 24,
					minSpent:
						customerFilters.minSpent === '' || customerFilters.minSpent === null
							? undefined
							: Number(customerFilters.minSpent),
					minOrders:
						customerFilters.minOrders === '' || customerFilters.minOrders === null
							? undefined
							: Number(customerFilters.minOrders),
					hasPhoneOnly: customerFilters.hasPhoneOnly ? 'true' : 'false',
					hasOrders: customerFilters.hasOrders ? 'true' : 'false',
					productQuery: customerFilters.productQuery || '',
				});

				if (Array.isArray(nextPage?.customers)) {
					allCustomers.push(...nextPage.customers);
				}
			}

			setSelectedCustomersMap((current) => ({
				...current,
				...mapCustomersById(allCustomers),
			}));

			setCustomerAudience((current) => ({
				...current,
				customers: Array.isArray(firstPage?.customers) ? firstPage.customers : [],
				stats: firstPage?.stats || {},
				pagination: firstPage?.pagination || current.pagination,
				loadingAll: false,
				error: '',
			}));
		} catch (error) {
			setCustomerAudience((current) => ({
				...current,
				loadingAll: false,
				error:
					error?.response?.data?.message ||
					error?.response?.data?.error ||
					error?.message ||
					'No se pudieron traer todos los clientes filtrados.',
			}));
		}
	}

	async function handleImageChange(event) {
		const file = event.target.files?.[0];
		if (!file) return;

		setImageError('');
		setSubmitError('');
		setUploadingImage(true);

		try {
			const result = await uploadCampaignHeaderImage(file);
			const mediaId = result?.mediaId || '';

			if (!mediaId) {
				throw new Error('Meta no devolvió mediaId para la imagen.');
			}

			setUploadedMediaId(mediaId);
			setUploadedFileName(file.name);
		} catch (error) {
			setUploadedMediaId('');
			setUploadedFileName('');
			setImageError(
				error?.response?.data?.error ||
					error?.message ||
					'No se pudo subir la imagen del encabezado.'
			);
		} finally {
			setUploadingImage(false);
			event.target.value = '';
		}
	}

	async function handleSubmit(event) {
		event.preventDefault();
		setSubmitError('');

		if (!selectedTemplate?.id) {
			setSubmitError('Elegí un template antes de crear la campaña.');
			return;
		}

		if (requiresHeaderImage && !uploadedMediaId) {
			setImageError('Esta plantilla requiere una imagen de encabezado antes de crear la campaña.');
			return;
		}

		if (!recipients.length) {
			setSubmitError(
				form.audienceMode === 'customers'
					? 'Seleccioná al menos un cliente.'
					: 'Cargá al menos un destinatario manual.'
			);
			return;
		}

		const payload = {
			name: form.name.trim(),
			templateId: selectedTemplate.id,
			languageCode: selectedTemplate.language || 'es_AR',
			recipients,
			audienceSource: form.audienceMode === 'customers' ? 'customers' : 'manual',
			audienceFilters:
				form.audienceMode === 'customers'
					? {
							q: customerFilters.q || '',
							sort: customerFilters.sort || 'updated_desc',
							pageSize: customerFilters.pageSize || 24,
							minSpent:
								customerFilters.minSpent === '' ? null : Number(customerFilters.minSpent),
							minOrders:
								customerFilters.minOrders === '' ? null : Number(customerFilters.minOrders),
							hasPhoneOnly: Boolean(customerFilters.hasPhoneOnly),
							hasOrders: Boolean(customerFilters.hasOrders),
							productQuery: customerFilters.productQuery || '',
							selectedCustomerIds: selectedCustomers.map((customer) => customer.id),
							selectedCount: selectedCustomers.length,
					  }
					: null,
			notes: form.description.trim() || null,
			sendComponents: Array.isArray(selectedTemplate.components) ? selectedTemplate.components : [],
		};

		const result = await onCreateCampaign(payload);
		const createdCampaignId = extractCreatedCampaignId(result);

		if (form.sendNow) {
			if (createdCampaignId && typeof window !== 'undefined') {
				window.dispatchEvent(
					new CustomEvent('campaign:launch-requested', {
						detail: { campaignId: createdCampaignId },
					})
				);
			}
		}

		setForm((current) => ({
			...initialForm,
			audienceMode: current.audienceMode,
		}));
		setUploadedMediaId('');
		setUploadedFileName('');
		setImageError('');
		setSubmitError('');
		setSelectedCustomersMap({});
	}

	return (
		<section className="campaign-panel campaign-panel--customers">
			<div className="campaign-panel-header">
				<div>
					<h3>Crear campaña</h3>
					<p>
						Armá campañas con clientes reales filtrados por sus compras o cargá audiencia
						manual si necesitás algo puntual.
					</p>
				</div>
			</div>

			<form className="campaign-form" onSubmit={handleSubmit}>
				<div className="campaign-form-grid two-columns">
					<label className="field">
						<span>Nombre de campaña</span>
						<input
							value={form.name}
							onChange={(event) =>
								setForm((current) => ({ ...current, name: event.target.value }))
							}
							placeholder="Clientes body negro - abril"
						/>
					</label>

					<label className="field">
						<span>Template</span>
						<select
							value={selectedTemplate?.id || ''}
							onChange={(event) => {
								const template = templates.find((item) => item.id === event.target.value);
								if (template) onSelectTemplate(template);
							}}
						>
							{templates.map((template) => (
								<option key={template.id} value={template.id}>
									{template.name} · {template.language}
								</option>
							))}
						</select>
					</label>
				</div>

				{requiresHeaderImage ? (
					<div className="field">
						<span>Imagen del encabezado</span>

						<div className="campaign-helper-box">
							<div className="campaign-helper-text">
								Esta plantilla necesita una imagen en el header para poder enviarse.
							</div>

							<div className="campaign-inline-actions">
								<label
									className="button secondary"
									style={{ cursor: uploadingImage ? 'not-allowed' : 'pointer' }}
								>
									{uploadingImage
										? 'Subiendo…'
										: uploadedMediaId
											? 'Cambiar imagen'
											: 'Subir imagen'}
									<input
										type="file"
										accept="image/*"
										onChange={handleImageChange}
										disabled={uploadingImage}
										style={{ display: 'none' }}
									/>
								</label>

								{uploadedFileName ? (
									<span className="campaign-helper-inline-text">{uploadedFileName}</span>
								) : null}
							</div>

							{uploadedMediaId ? (
								<div className="campaign-inline-success">
									Imagen cargada correctamente. Media ID: <strong>{uploadedMediaId}</strong>
								</div>
							) : null}

							{imageError ? <div className="campaign-inline-error">{imageError}</div> : null}
						</div>
					</div>
				) : null}

				<label className="field">
					<span>Descripción</span>
					<input
						value={form.description}
						onChange={(event) =>
							setForm((current) => ({ ...current, description: event.target.value }))
						}
						placeholder="Segmento para remarketing"
					/>
				</label>

				<div className="field">
					<span>Origen de audiencia</span>

					<div className="campaign-audience-mode">
						<button
							type="button"
							className={`campaign-mode-chip ${form.audienceMode === 'customers' ? 'active' : ''}`}
							onClick={() => {
								setForm((current) => ({ ...current, audienceMode: 'customers' }));
								setSubmitError('');
							}}
						>
							Clientes
						</button>

						<button
							type="button"
							className={`campaign-mode-chip ${form.audienceMode === 'manual' ? 'active' : ''}`}
							onClick={() => {
								setForm((current) => ({ ...current, audienceMode: 'manual' }));
								setSubmitError('');
							}}
						>
							Manual
						</button>
					</div>
				</div>

				{form.audienceMode === 'customers' ? (
					<div className="campaign-customer-shell">
						<div className="campaign-customer-filters">
							<div className="campaign-customer-filters-head">
								<div>
									<h4>Filtros de clientes</h4>
									<p>Segmentá por compra, gasto y comportamiento.</p>
								</div>

								<div className="campaign-customer-kpi">
									<strong>{customerAudience?.stats?.totalCustomers || 0}</strong>
									<span>filtrados</span>
								</div>
							</div>

							<div className="campaign-form-grid two-columns">
								<label className="field">
									<span>Buscar cliente</span>
									<input
										value={customerFilters.q}
										onChange={(event) => updateCustomerFilter('q', event.target.value)}
										placeholder="nombre, mail o teléfono"
									/>
								</label>

								<label className="field">
									<span>Producto comprado</span>
									<input
										value={customerFilters.productQuery}
										onChange={(event) => updateCustomerFilter('productQuery', event.target.value)}
										placeholder="body, faja, calza"
									/>
								</label>
							</div>

							<div className="campaign-customer-filter-grid">
								<label className="field">
									<span>Gasto mínimo</span>
									<input
										type="number"
										min="0"
										value={customerFilters.minSpent}
										onChange={(event) => updateCustomerFilter('minSpent', event.target.value)}
										placeholder="0"
									/>
								</label>

								<label className="field">
									<span>Pedidos mínimos</span>
									<input
										type="number"
										min="0"
										value={customerFilters.minOrders}
										onChange={(event) => updateCustomerFilter('minOrders', event.target.value)}
										placeholder="0"
									/>
								</label>

								<label className="field">
									<span>Orden</span>
									<select
										value={customerFilters.sort}
										onChange={(event) => updateCustomerFilter('sort', event.target.value)}
									>
										<option value="updated_desc">Actualizados primero</option>
										<option value="updated_asc">Actualizados al final</option>
										<option value="spent_desc">Mayor gasto</option>
										<option value="spent_asc">Menor gasto</option>
										<option value="name_asc">Nombre A-Z</option>
										<option value="name_desc">Nombre Z-A</option>
									</select>
								</label>

								<label className="field">
									<span>Clientes por página</span>
									<select
										value={customerFilters.pageSize}
										onChange={(event) =>
											updateCustomerFilter('pageSize', Number(event.target.value))
										}
									>
										<option value={12}>12</option>
										<option value={24}>24</option>
										<option value={48}>48</option>
										<option value={96}>96</option>
									</select>
								</label>
							</div>

							<div className="campaign-customer-checks">
								<label className="campaign-toggle">
									<input
										type="checkbox"
										checked={customerFilters.hasPhoneOnly}
										onChange={(event) => updateCustomerFilter('hasPhoneOnly', event.target.checked)}
									/>
									<span>Solo clientes con teléfono</span>
								</label>

								<label className="campaign-toggle">
									<input
										type="checkbox"
										checked={customerFilters.hasOrders}
										onChange={(event) => updateCustomerFilter('hasOrders', event.target.checked)}
									/>
									<span>Solo clientes con compras</span>
								</label>
							</div>

							<div className="campaign-customer-toolbar">
								<div className="campaign-customer-toolbar-text">
									<strong>{customerAudience?.stats?.totalCustomers || 0}</strong> clientes
									filtrados · <strong>{selectedCustomerCount}</strong> seleccionados
								</div>

								<div className="campaign-inline-actions">
									<button
										type="button"
										className="button ghost"
										onClick={() => loadCustomers(customerFilters)}
										disabled={customerAudience.loading}
									>
										{customerAudience.loading ? 'Buscando…' : 'Buscar'}
									</button>

									<button
										type="button"
										className="button ghost"
										onClick={toggleCurrentPageSelection}
										disabled={!currentPageSelectableCustomers.length}
									>
										{allPageSelected ? 'Quitar página' : 'Seleccionar página'}
									</button>

									<button
										type="button"
										className="button ghost"
										onClick={handleLoadAllFilteredCustomers}
										disabled={customerAudience.loadingAll}
									>
										{customerAudience.loadingAll ? 'Cargando…' : 'Traer todos los filtrados'}
									</button>

									<button
										type="button"
										className="button ghost"
										onClick={() => setSelectedCustomersMap({})}
										disabled={!selectedCustomerCount}
									>
										Limpiar selección
									</button>
								</div>
							</div>

							{customerAudience.error ? (
								<div className="campaign-inline-error">{customerAudience.error}</div>
							) : null}
						</div>

						<div className="campaign-customer-results">
							<div className="campaign-customer-results-head">
								<div>
									Página {customerAudience.pagination?.page || 1} de{' '}
									{customerAudience.pagination?.totalPages || 1}
								</div>
								<div>{selectedPageCount} seleccionados en esta página</div>
							</div>

							{customerAudience.loading ? (
								<div className="campaign-empty-state">
									<p>Cargando clientes…</p>
								</div>
							) : customerAudience.customers?.length ? (
								<div className="campaign-customer-grid">
									{customerAudience.customers.map((customer) => {
										const isSelected = Boolean(selectedCustomersMap[customer.id]);
										const hasPhone = Boolean(normalizePhone(customer.phone || ''));

										return (
											<button
												key={customer.id}
												type="button"
												className={`campaign-customer-card ${isSelected ? 'selected' : ''} ${
													!hasPhone ? 'disabled' : ''
												}`}
												onClick={() => toggleCustomerSelection(customer)}
												disabled={!hasPhone}
											>
												<div className="campaign-customer-card-top">
													<div className="campaign-customer-avatar">
														{customer.initials || 'CL'}
													</div>

													<div className="campaign-customer-title-wrap">
														<strong>
															{customer.displayName || customer.email || customer.phone}
														</strong>
														<span>
															{customer.phone || 'Sin teléfono'} ·{' '}
															{customer.totalSpentLabel || '$0'}
														</span>
													</div>

													<div className="campaign-customer-checkbox">
														<input type="checkbox" readOnly checked={isSelected} tabIndex={-1} />
													</div>
												</div>

												<div className="campaign-customer-meta">
													<span>{customer.orderCount || 0} pedidos</span>
													<span>{customer.distinctProductsCount || 0} productos</span>
													<span>{customer.lastOrderAtLabel || '-'}</span>
												</div>

												<div className="campaign-customer-product">
													{customer.primaryProductLabel || 'Sin producto destacado'}
												</div>

												{!hasPhone ? (
													<div className="campaign-inline-warning">
														Este cliente no tiene teléfono usable.
													</div>
												) : null}
											</button>
										);
									})}
								</div>
							) : (
								<div className="campaign-empty-state">
									<p>No hay clientes con esos filtros.</p>
								</div>
							)}

							<div className="campaign-customer-pagination">
								<button
									type="button"
									className="button ghost"
									disabled={(customerAudience.pagination?.page || 1) <= 1}
									onClick={() => {
										const nextPage = Math.max(1, (customerAudience.pagination?.page || 1) - 1);
										const nextFilters = { ...customerFilters, page: nextPage };
										setCustomerFilters(nextFilters);
										loadCustomers(nextFilters);
									}}
								>
									Anterior
								</button>

								<button
									type="button"
									className="button ghost"
									disabled={
										(customerAudience.pagination?.page || 1) >=
										(customerAudience.pagination?.totalPages || 1)
									}
									onClick={() => {
										const nextPage = Math.min(
											customerAudience.pagination?.totalPages || 1,
											(customerAudience.pagination?.page || 1) + 1
										);
										const nextFilters = { ...customerFilters, page: nextPage };
										setCustomerFilters(nextFilters);
										loadCustomers(nextFilters);
									}}
								>
									Siguiente
								</button>
							</div>
						</div>
					</div>
				) : (
					<label className="field">
						<span>Audiencia manual</span>
						<textarea
							rows={8}
							value={form.audienceText}
							onChange={(event) =>
								setForm((current) => ({ ...current, audienceText: event.target.value }))
							}
							placeholder="telefono|nombre|producto|talle|color"
						/>
						<small>Formato: teléfono|nombre|producto|talle|color. Una fila por destinatario.</small>
					</label>
				)}

				{submitError ? <div className="campaign-inline-error">{submitError}</div> : null}

				<div className="campaign-composer-summary">
					<div>
						<strong>{recipients.length}</strong>
						<span>destinatarios estimados</span>
					</div>

					<div>
						<strong>USD {estimatedCost.toFixed(2)}</strong>
						<span>costo estimado</span>
					</div>

					<label className="campaign-toggle">
						<input
							type="checkbox"
							checked={form.sendNow}
							onChange={(event) =>
								setForm((current) => ({ ...current, sendNow: event.target.checked }))
							}
						/>
						<span>Enviar apenas se cree</span>
					</label>
				</div>

				<div className="campaign-form-actions">
					<button
						className="button primary"
						type="submit"
						disabled={
							creating ||
							!selectedTemplate?.id ||
							(requiresHeaderImage && !uploadedMediaId) ||
							!recipients.length
						}
					>
						{creating ? 'Guardando…' : form.sendNow ? 'Crear y despachar' : 'Guardar campaña'}
					</button>
				</div>
			</form>
		</section>
	);
}