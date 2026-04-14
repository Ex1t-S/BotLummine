import { useEffect, useMemo, useState } from 'react';
import {
	fetchCampaignCustomers,
	uploadCampaignHeaderImage,
} from '../../lib/campaigns.js';
import api from '../../lib/api.js';

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
	productQuery: '',
	orderNumber: '',
	dateFrom: '',
	dateTo: '',
	paymentStatus: '',
	sort: 'purchase_desc',
	page: 1,
	pageSize: 24,
	minSpent: '',
	hasPhoneOnly: true,
};
const PAYMENT_STATUS_OPTIONS = [
	{ value: '', label: 'Todos' },
	{ value: 'pending', label: 'Pendiente' },
	{ value: 'authorized', label: 'Autorizado' },
	{ value: 'paid', label: 'Pagado' },
	{ value: 'partially_paid', label: 'Pago parcial' },
	{ value: 'abandoned', label: 'Abandonado' },
	{ value: 'refunded', label: 'Reembolsado' },
	{ value: 'partially_refunded', label: 'Reembolso parcial' },
	{ value: 'voided', label: 'Anulado' },
];

function buildCatalogProducts(rawCatalog = []) {
	const seen = new Set();
	const options = [];

	for (const item of rawCatalog) {
		const label =
			item?.name ||
			item?.title ||
			item?.productName ||
			item?.displayName ||
			'';

		const normalized = String(label || '').trim();
		if (!normalized) continue;
		if (seen.has(normalized.toLowerCase())) continue;

		seen.add(normalized.toLowerCase());
		options.push({
			id: item?.id || item?.productId || normalized,
			label: normalized,
		});
	}

	return options.sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

function ProductMultiSelect({
	options,
	selectedValues,
	search,
	onSearchChange,
	onToggleValue,
	onClear,
}) {
	const filtered = useMemo(() => {
		const term = String(search || '').trim().toLowerCase();
		if (!term) return options.slice(0, 80);

		return options
			.filter((option) => option.label.toLowerCase().includes(term))
			.slice(0, 80);
	}, [options, search]);

	return (
		<div className="campaign-product-multiselect">
			<input
				type="text"
				className="campaign-product-multiselect-search"
				placeholder="Buscar productos del catálogo..."
				value={search}
				onChange={(event) => onSearchChange(event.target.value)}
			/>

			<div className="campaign-product-multiselect-list">
				{filtered.length ? (
					filtered.map((option) => {
						const checked = selectedValues.includes(option.label);

						return (
							<label key={option.id} className="campaign-product-option-row">
								<input
									type="checkbox"
									checked={checked}
									onChange={() => onToggleValue(option.label)}
								/>
								<span>{option.label}</span>
							</label>
						);
					})
				) : (
					<div className="campaign-product-option-empty">
						No hay coincidencias en el catálogo.
					</div>
				)}
			</div>

			<div className="campaign-product-multiselect-footer">
				<button
					type="button"
					className="button ghost"
					onClick={onClear}
				>
					Limpiar productos
				</button>
			</div>
		</div>
	);
}
const VARIABLE_SOURCE_OPTIONS = [
	{ value: 'contact_name', label: 'Nombre completo' },
	{ value: 'first_name', label: 'Primer nombre' },
	{ value: 'customer_name', label: 'Nombre cliente' },
	{ value: 'customer_email', label: 'Email' },
	{ value: 'phone', label: 'Teléfono' },
	{ value: 'wa_id', label: 'WhatsApp ID' },
	{ value: 'product_name', label: 'Producto principal' },
	{ value: 'order_count', label: 'Cantidad de compras' },
	{ value: 'last_order_id', label: 'Último pedido ID' },
	{ value: 'last_order_number', label: 'Último pedido número' },
	{ value: 'total_spent', label: 'Total gastado bruto' },
	{ value: 'total_spent_label', label: 'Total gastado formateado' },
	{ value: 'size', label: 'Talle' },
	{ value: 'color', label: 'Color' },
	{ value: 'fixed', label: 'Valor fijo' },
	{ value: 'empty', label: 'Vacío' },
];

function normalizeType(value = '') {
	return String(value || '').trim().toUpperCase();
}

function normalizePhone(value = '') {
	return String(value || '').replace(/\D/g, '').trim();
}

function normalizeText(value = '') {
	return String(value || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

function sanitizeCampaignCopy(value = '') {
	return String(value || '')
		.replace(/ÃƒÂ¡|Ã¡/g, 'a')
		.replace(/ÃƒÂ©|Ã©/g, 'e')
		.replace(/ÃƒÂ­|Ã­/g, 'i')
		.replace(/ÃƒÂ³|Ã³/g, 'o')
		.replace(/ÃƒÂº|Ãº/g, 'u')
		.replace(/ÃƒÂ±|Ã±/g, 'n')
		.replace(/â€¦/g, '...')
		.replace(/Â·/g, '-');
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

function getTemplateHeaderImageAsset(template) {
	const components = getTemplateComponents(template);
	const header = components.find(
		(component) => normalizeType(component?.type) === 'HEADER'
	);
	const rawHeaderMedia = template?.rawPayload?.headerMedia || {};
	const headerImage = header?.image || {};

	const mediaId = String(rawHeaderMedia.mediaId || headerImage.id || '').trim();
	const previewUrl = String(rawHeaderMedia.previewUrl || headerImage.link || '').trim();
	const headerHandle = String(rawHeaderMedia.headerHandle || '').trim();

	return {
		mediaId,
		previewUrl,
		headerHandle,
		hasResolvedAsset: Boolean(mediaId || previewUrl || headerHandle),
	};
}

function extractTemplatePlaceholders(template) {
	const components = getTemplateComponents(template);
	const texts = [];

	for (const component of components) {
		const type = normalizeType(component?.type);

		if (type === 'HEADER' && typeof component?.text === 'string') {
			texts.push(component.text);
		}

		if (type === 'BODY' && typeof component?.text === 'string') {
			texts.push(component.text);
		}

		if (type === 'FOOTER' && typeof component?.text === 'string') {
			texts.push(component.text);
		}

		if (type === 'BUTTONS' && Array.isArray(component?.buttons)) {
			for (const button of component.buttons) {
				if (typeof button?.url === 'string') {
					texts.push(button.url);
				}
			}
		}
	}

	const matches = texts.flatMap((text) =>
		[...String(text || '').matchAll(/{{\s*([^}]+?)\s*}}/g)].map((match) =>
			String(match?.[1] || '').trim()
		)
	);

	return Array.from(new Set(matches.filter(Boolean)));
}

function guessSourceForVariable(variableKey = '') {
	const key = normalizeText(variableKey);

	if (!key) return 'fixed';

	if (['1', 'nombre', 'name', 'contact_name', 'customer_name', 'cliente'].includes(key)) {
		return 'contact_name';
	}

	if (['first_name', 'firstname', 'primer_nombre', 'nombre_corto'].includes(key)) {
		return 'first_name';
	}

	if (['2', 'producto', 'product', 'product_name', 'item'].includes(key)) {
		return 'product_name';
	}

	if (['3', 'total', 'monto', 'importe', 'total_spent', 'total_spent_label'].includes(key)) {
		return 'total_spent_label';
	}

	if (
		['4', 'pedido', 'order', 'order_id', 'last_order_id', 'order_number', 'last_order_number'].includes(
			key
		)
	) {
		return 'last_order_number';
	}

	if (['email', 'mail', 'customer_email'].includes(key)) {
		return 'customer_email';
	}

	if (['telefono', 'tel', 'phone', 'wa_id', 'whatsapp'].includes(key)) {
		return 'phone';
	}

	if (['color'].includes(key)) {
		return 'color';
	}

	if (['talle', 'size'].includes(key)) {
		return 'size';
	}

	return 'fixed';
}

function buildInitialVariableMapping(placeholders = []) {
	return Object.fromEntries(
		placeholders.map((key) => [
			key,
			{
				source: guessSourceForVariable(key),
				fixedValue: '',
			},
		])
	);
}

function buildManualContext(row = {}, extraVariables = {}) {
	const contactName = row.contactName || '';
	const firstName = contactName.split(/\s+/).filter(Boolean)[0] || '';
	const productName = row.productName || '';

	return {
		'1': contactName,
		'2': productName,
		'3': row.size || '',
		'4': row.color || '',
		contact_name: contactName,
		first_name: firstName,
		customer_name: contactName,
		customer_email: '',
		product_name: productName,
		order_count: '',
		last_order_id: '',
		last_order_number: '',
		total_spent: '',
		total_spent_label: '',
		size: row.size || '',
		color: row.color || '',
		phone: row.phone || '',
		wa_id: row.phone || '',
		...extraVariables,
	};
}
function extractProductLabels(customer = {}) {
	const labels = [];

	if (customer.primaryProductLabel) {
		labels.push(String(customer.primaryProductLabel).trim());
	}

	if (Array.isArray(customer.productSummary)) {
		for (const item of customer.productSummary) {
			if (typeof item === 'string' && item.trim()) {
				labels.push(item.trim());
				continue;
			}

			const value =
				item?.name ||
				item?.productName ||
				item?.title ||
				item?.label ||
				item?.variantName ||
				'';

			if (typeof value === 'string' && value.trim()) {
				labels.push(value.trim());
			}
		}
	}

	if (Array.isArray(customer.productsPreview)) {
		for (const item of customer.productsPreview) {
			if (typeof item === 'string' && item.trim()) {
				labels.push(item.trim());
			}
		}
	}

	return Array.from(new Set(labels));
}

function getPrimaryProductName(customer = {}) {
	const labels = extractProductLabels(customer);
	return labels[0] || '';
}

function customerMatchesSelectedProducts(customer, selectedProducts = []) {
	if (!selectedProducts.length) return true;

	const customerProducts = extractProductLabels(customer).map(normalizeText);
	if (!customerProducts.length) return false;

	return selectedProducts.some((product) => {
		const normalizedProduct = normalizeText(product);
		return customerProducts.some(
			(customerProduct) =>
				customerProduct.includes(normalizedProduct) || normalizedProduct.includes(customerProduct)
		);
	});
}

function buildCustomerContext(customer = {}, extraVariables = {}) {
	const normalizedPhone = normalizePhone(customer?.phone || '');
	const contactName =
		customer?.displayName || customer?.email || normalizedPhone || 'Cliente';
	const firstName =
		contactName.split(/\s+/).filter(Boolean)[0] || contactName || 'Cliente';
	const primaryProductName = getPrimaryProductName(customer);

	return {
		'1': contactName,
		'2': primaryProductName || '',
		'3': customer?.totalSpentLabel || '',
		'4': customer?.lastOrderNumber || customer?.lastOrderId || '',
		contact_name: contactName,
		first_name: firstName,
		customer_name: contactName,
		customer_email: customer?.email || '',
		product_name: primaryProductName || '',
		order_count: String(customer?.orderCount || 0),
		last_order_id: customer?.lastOrderId || '',
		last_order_number: customer?.lastOrderNumber || '',
		total_spent: String(customer?.totalSpent || ''),
		total_spent_label: customer?.totalSpentLabel || '',
		size: '',
		color: '',
		phone: normalizedPhone,
		wa_id: normalizedPhone,
		...extraVariables,
	};
}

function resolveMappedVariables(baseContext = {}, variableMapping = {}, placeholders = []) {
	const resolved = { ...baseContext };

	for (const placeholder of placeholders) {
		const config = variableMapping?.[placeholder] || { source: 'fixed', fixedValue: '' };
		const source = config?.source || 'fixed';

		let value = '';

		if (source === 'fixed') {
			value = config?.fixedValue || '';
		} else if (source === 'empty') {
			value = '';
		} else {
			value = baseContext?.[source] ?? '';
		}

		resolved[placeholder] = String(value ?? '');
	}

	return resolved;
}

function parseAudienceRows(rawValue = '') {
	return rawValue
		.split('\n')
		.map((row) => row.trim())
		.filter(Boolean)
		.map((row) => {
			const [phone, contactName, productName, size, color] = row
				.split('|')
				.map((value) => value?.trim() || '');

			return {
				phone: normalizePhone(phone),
				contactName,
				productName,
				size,
				color,
			};
		})
		.filter((item) => item.phone);
}

function parseAudience(rawValue = '', extraVariables = {}, variableMapping = {}, placeholders = []) {
	return parseAudienceRows(rawValue)
		.map((row) => {
			const baseContext = buildManualContext(row, extraVariables);
			const variables = resolveMappedVariables(baseContext, variableMapping, placeholders);

			return {
				phone: row.phone,
				contactName: row.contactName || row.phone,
				variables,
			};
		})
		.filter((item) => item.phone);
}

function customerToRecipient(customer, extraVariables = {}, variableMapping = {}, placeholders = []) {
	const normalizedPhone = normalizePhone(customer?.phone || '');
	const baseContext = buildCustomerContext(customer, extraVariables);
	const variables = resolveMappedVariables(baseContext, variableMapping, placeholders);

	return {
		externalKey: `customer:${customer.id}`,
		phone: normalizedPhone,
		contactName: baseContext.contact_name || normalizedPhone,
		variables,
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

function formatCompactNumber(value) {
	return new Intl.NumberFormat('es-AR').format(Number(value || 0));
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
function getRecipientDisplayName(customer = {}) {
	return (
		customer?.displayName ||
		customer?.contactName ||
		customer?.email ||
		normalizePhone(customer?.phone || '') ||
		'Sin nombre'
	);
}

function getRecipientProductPreview(customer = {}) {
	const labels = extractProductLabels(customer);
	return labels.slice(0, 2).join(' · ');
}
export default function CampaignComposerPanel({
	templates = [],
	selectedTemplate,
	onSelectTemplate,
	onCreateCampaign,
	creating,
	audienceModeOptions = ['customers', 'manual'],
	lockedAudienceMode = null,
}) {
	const [form, setForm] = useState(initialForm);
	const [uploadingImage, setUploadingImage] = useState(false);
	const [uploadedMediaId, setUploadedMediaId] = useState('');
	const [uploadedFileName, setUploadedFileName] = useState('');
	const [imageError, setImageError] = useState('');
	const [submitError, setSubmitError] = useState('');
	const [showProductPicker, setShowProductPicker] = useState(false);
	const [catalogOptions, setCatalogOptions] = useState([]);
	const [productSearch, setProductSearch] = useState('');
	const [selectedProductFilters, setSelectedProductFilters] = useState([]);
	const [variableMapping, setVariableMapping] = useState({});
	const [showAudiencePreview, setShowAudiencePreview] = useState(false);
	const [contactLimit, setContactLimit] = useState('');
	const [previewSearch, setPreviewSearch] = useState('');
	const [previewPage, setPreviewPage] = useState(1);
	const PREVIEW_PAGE_SIZE = 10;
	const [bulkSelectionInfo, setBulkSelectionInfo] = useState({
		count: 0,
		customerIds: [],
		mode: '',
	});

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
		if (lockedAudienceMode && form.audienceMode !== lockedAudienceMode) {
			setForm((current) => ({ ...current, audienceMode: lockedAudienceMode }));
		}
	}, [lockedAudienceMode, form.audienceMode]);

	useEffect(() => {
		setUploadedMediaId('');
		setUploadedFileName('');
		setImageError('');
	}, [selectedTemplate?.id]);

	const templatePlaceholders = useMemo(
		() => extractTemplatePlaceholders(selectedTemplate),
		[selectedTemplate]
	);

	useEffect(() => {
		setVariableMapping((current) => {
			const defaults = buildInitialVariableMapping(templatePlaceholders);
			const next = {};

			for (const key of templatePlaceholders) {
				next[key] = current?.[key] || defaults[key];
			}

			return next;
		});
	}, [templatePlaceholders]);

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
	useEffect(() => {
		void loadCatalogOptions();
	}, []);
	const requiresHeaderImage = useMemo(
		() => templateRequiresHeaderImage(selectedTemplate),
		[selectedTemplate]
	);
	const templateHeaderImageAsset = useMemo(
		() => getTemplateHeaderImageAsset(selectedTemplate),
		[selectedTemplate]
	);
	const campaignOverridesTemplateImage = Boolean(uploadedMediaId);
	const hasTemplateResolvedHeaderImage = templateHeaderImageAsset.hasResolvedAsset;
	const needsHeaderImageUpload =
		requiresHeaderImage &&
		!hasTemplateResolvedHeaderImage &&
		!campaignOverridesTemplateImage;

	const extraVariables = useMemo(
		() => (uploadedMediaId ? { header_image_id: uploadedMediaId } : {}),
		[uploadedMediaId]
	);

	const manualRecipients = useMemo(
		() => parseAudience(form.audienceText, extraVariables, variableMapping, templatePlaceholders),
		[form.audienceText, extraVariables, variableMapping, templatePlaceholders]
	);

	const selectedCustomers = useMemo(
		() => Object.values(selectedCustomersMap),
		[selectedCustomersMap]
	);

	const selectedProductSummary = useMemo(() => {
		return selectedProductFilters.slice(0, 3).join(', ');
	}, [selectedProductFilters]);

	const availableProducts = useMemo(() => {
		const counts = new Map();

		for (const customer of customerAudience.customers) {
			for (const label of extractProductLabels(customer)) {
				const key = label.trim();
				if (!key) continue;
				counts.set(key, (counts.get(key) || 0) + 1);
			}
		}

		return Array.from(counts.entries())
			.map(([label, count]) => ({ label, count }))
			.sort((a, b) => {
				if (b.count !== a.count) return b.count - a.count;
				return a.label.localeCompare(b.label, 'es');
			});
	}, [customerAudience.customers]);

	const filteredAvailableProducts = useMemo(() => {
		const query = normalizeText(productSearch);
		if (!query) return availableProducts;

		return availableProducts.filter((product) =>
			normalizeText(product.label).includes(query)
		);
	}, [availableProducts, productSearch]);

	const selectedVisibleProductMatchesCount = useMemo(() => {
		if (!selectedProductFilters.length) return 0;

		return customerAudience.customers.filter((customer) =>
			Boolean(normalizePhone(customer.phone || ''))
		).length;
	}, [customerAudience.customers, selectedProductFilters]);

	const customerRecipients = useMemo(() => {
		return selectedCustomers
			.map((customer) =>
				customerToRecipient(customer, extraVariables, variableMapping, templatePlaceholders)
			)
			.filter((recipient) => recipient.phone);
	}, [selectedCustomers, extraVariables, variableMapping, templatePlaceholders]);

	const recipients = useMemo(() => {
		return form.audienceMode === 'customers' ? customerRecipients : manualRecipients;
	}, [form.audienceMode, customerRecipients, manualRecipients]);

	const estimatedCost = useMemo(() => recipients.length * 0.06, [recipients.length]);

	const sampleResolvedVariables = useMemo(() => {
		return recipients[0]?.variables || {};
	}, [recipients]);
	const variableMappingError = useMemo(() => validateVariableMapping(), [
		templatePlaceholders,
		variableMapping,
	]);
	const campaignChecklist = useMemo(
		() => [
			{
				id: 'template',
				label: 'Template elegido',
				ok: Boolean(selectedTemplate?.id),
				readyText: selectedTemplate?.name || 'Listo',
				pendingText: 'ElegÃ­ un template',
			},
			{
				id: 'image',
				label: 'Header image',
				ok: !requiresHeaderImage || !needsHeaderImageUpload,
				readyText: campaignOverridesTemplateImage
					? 'Se reemplaza para esta campaÃ±a'
					: hasTemplateResolvedHeaderImage
						? 'Resuelta en la plantilla'
						: 'No aplica',
				pendingText: 'Falta cargar la imagen',
			},
			{
				id: 'variables',
				label: 'Variables',
				ok: !templatePlaceholders.length || !variableMappingError,
				readyText: templatePlaceholders.length
					? `${templatePlaceholders.length} variables listas`
					: 'Sin variables',
				pendingText: variableMappingError || 'Faltan variables',
			},
			{
				id: 'audience',
				label: 'Audiencia',
				ok: recipients.length > 0,
				readyText: `${formatCompactNumber(recipients.length)} destinatarios`,
				pendingText:
					form.audienceMode === 'customers'
						? 'SeleccionÃ¡ clientes'
						: 'CargÃ¡ destinatarios',
			},
		],
		[
			selectedTemplate?.id,
			selectedTemplate?.name,
			requiresHeaderImage,
			needsHeaderImageUpload,
			campaignOverridesTemplateImage,
			hasTemplateResolvedHeaderImage,
			templatePlaceholders.length,
			variableMappingError,
			recipients.length,
			form.audienceMode,
		]
	);
	const campaignReadyToCreate = campaignChecklist.every((item) => item.ok);

	const selectedCustomerCount = selectedCustomers.length;

	const totalFoundCount = Number(
		customerAudience?.pagination?.totalItems ||
		customerAudience?.stats?.totalCustomers ||
		0
	);
	const contactLimitNumber = useMemo(() => {
		const parsed = Number(contactLimit);
		if (!Number.isFinite(parsed) || parsed <= 0) return null;
		return Math.floor(parsed);
	}, [contactLimit]);

	const previewFilteredCustomers = useMemo(() => {
		if (form.audienceMode !== 'customers') return [];

		const normalizedSearch = String(previewSearch || '').trim().toLowerCase();

		if (!normalizedSearch) {
			return selectedCustomers;
		}

		return selectedCustomers.filter((customer) => {
			const haystack = [
				customer?.displayName,
				customer?.contactName,
				customer?.email,
				normalizePhone(customer?.phone || ''),
				getRecipientProductPreview(customer),
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();

			return haystack.includes(normalizedSearch);
		});
	}, [form.audienceMode, selectedCustomers, previewSearch]);

	const previewTotalPages = useMemo(() => {
		return Math.max(1, Math.ceil(previewFilteredCustomers.length / PREVIEW_PAGE_SIZE));
	}, [previewFilteredCustomers.length]);

	const previewCustomers = useMemo(() => {
		const start = (previewPage - 1) * PREVIEW_PAGE_SIZE;
		return previewFilteredCustomers.slice(start, start + PREVIEW_PAGE_SIZE);
	}, [previewFilteredCustomers, previewPage]);

	useEffect(() => {
		setPreviewPage(1);
	}, [previewSearch, selectedCustomerCount]);

	useEffect(() => {
		if (previewPage > previewTotalPages) {
			setPreviewPage(previewTotalPages);
		}
	}, [previewPage, previewTotalPages]);

	const effectiveSelectionCount = useMemo(() => {
		if (!contactLimitNumber) return totalFoundCount;
		return Math.min(totalFoundCount, contactLimitNumber);
	}, [totalFoundCount, contactLimitNumber]);

	const selectionButtonLabel = useMemo(() => {
		if (customerAudience.loadingAll) return 'Seleccionando…';

		if (contactLimitNumber) {
			return `Seleccionar primeros ${formatCompactNumber(effectiveSelectionCount)} filtrados`;
		}

		if (selectedProductFilters.length) {
			return 'Seleccionar todos los filtrados';
		}

		return `Seleccionar todos los encontrados (${formatCompactNumber(totalFoundCount)})`;
	}, [
		customerAudience.loadingAll,
		contactLimitNumber,
		effectiveSelectionCount,
		selectedProductFilters.length,
		totalFoundCount,
	]);
	function buildCustomerRequestParams(nextFilters = customerFilters) {
		const mergedProductQuery = selectedProductFilters.length
			? selectedProductFilters.join('||')
			: nextFilters.productQuery || '';

		return {
			q: nextFilters.q || '',
			productQuery: mergedProductQuery,
			orderNumber: nextFilters.orderNumber || '',
			dateFrom: nextFilters.dateFrom || '',
			dateTo: nextFilters.dateTo || '',
			paymentStatus: nextFilters.paymentStatus || '',
			sort: nextFilters.sort || 'purchase_desc',
			page: nextFilters.page || 1,
			pageSize: nextFilters.pageSize || 24,
			minSpent:
				nextFilters.minSpent === '' || nextFilters.minSpent === null
					? undefined
					: Number(nextFilters.minSpent),
			hasPhoneOnly: nextFilters.hasPhoneOnly ? 'true' : 'false',
		};
	}

	async function fetchAllFilteredCustomers(nextFilters = customerFilters) {
		const firstPage = await fetchCampaignCustomers({
			...buildCustomerRequestParams(nextFilters),
			page: 1,
		});

		const pagination = firstPage?.pagination || {};
		const totalPages = Math.min(Number(pagination.totalPages || 1), SAFE_MAX_CUSTOMER_PAGES);

		let mergedCustomers = Array.isArray(firstPage?.customers) ? [...firstPage.customers] : [];

		for (let page = 2; page <= totalPages; page += 1) {
			const nextPage = await fetchCampaignCustomers({
				...buildCustomerRequestParams(nextFilters),
				page,
			});

			if (Array.isArray(nextPage?.customers)) {
				mergedCustomers = mergedCustomers.concat(nextPage.customers);
			}
		}

		const dedupedMap = new Map();
		for (const customer of mergedCustomers) {
			if (customer?.id) dedupedMap.set(customer.id, customer);
		}

		return Array.from(dedupedMap.values());
	}
	async function loadCatalogOptions() {
		try {
			const response = await api.get('/dashboard/catalog', {
				params: { page: 1, pageSize: 250 },
			});

			const rawItems =
				response.data?.items ||
				response.data?.products ||
				response.data?.rows ||
				[];

			setCatalogOptions(buildCatalogProducts(rawItems));
		} catch (error) {
			console.error('[CAMPAIGNS][CATALOG] error:', error);
		}
	}
	async function loadCustomers(nextFilters = customerFilters) {
		setCustomerAudience((current) => ({
			...current,
			loading: true,
			error: '',
		}));

		try {
			const data = await fetchCampaignCustomers(buildCustomerRequestParams(nextFilters));

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

	function updateVariableMapping(key, patch) {
		setVariableMapping((current) => ({
			...current,
			[key]: {
				...(current[key] || { source: 'fixed', fixedValue: '' }),
				...patch,
			},
		}));
	}

		function toggleProductFilter(label) {
		setSelectedProductFilters((current) => {
			const next = current.includes(label)
				? current.filter((item) => item !== label)
				: [...current, label];

			setCustomerFilters((prev) => ({
				...prev,
				page: 1,
				productQuery: next.join('||'),
			}));

			return next;
		});
	}

	function clearSelectedProducts() {
		setSelectedProductFilters([]);
		setProductSearch('');
		setCustomerFilters((prev) => ({
			...prev,
			page: 1,
			productQuery: '',
		}));
	}

		async function handleSelectAllFilteredCustomers() {
		setCustomerAudience((current) => ({
			...current,
			loadingAll: true,
			error: '',
		}));

		try {
			const allCustomers = await fetchAllFilteredCustomers(customerFilters);

			const selectableCustomers = allCustomers.filter((customer) =>
				Boolean(normalizePhone(customer.phone || ''))
			);

			const limitedCustomers = contactLimitNumber
				? selectableCustomers.slice(0, contactLimitNumber)
				: selectableCustomers;

			setSelectedCustomersMap(mapCustomersById(limitedCustomers));

			setBulkSelectionInfo({
				count: limitedCustomers.length,
				customerIds: limitedCustomers.map((customer) => customer.id).filter(Boolean),
				mode: selectedProductFilters.length ? 'products' : 'all',
			});

			setShowAudiencePreview(true);

			setCustomerAudience((current) => ({
				...current,
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
					'No se pudieron seleccionar los clientes filtrados.',
			}));
		}
	}

	function clearFilteredSelection() {
		setSelectedCustomersMap({});
		setBulkSelectionInfo({
			count: 0,
			customerIds: [],
			mode: '',
		});
		setShowAudiencePreview(false);
	}
	function removeSelectedCustomer(customerId) {
		if (!customerId) return;

		setSelectedCustomersMap((current) => {
			const next = { ...current };
			delete next[customerId];
			return next;
		});

		setBulkSelectionInfo((current) => {
			const nextIds = current.customerIds.filter((id) => id !== customerId);
			return {
				...current,
				customerIds: nextIds,
				count: nextIds.length,
			};
		});
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

	function validateVariableMapping() {
		for (const placeholder of templatePlaceholders) {
			const config = variableMapping?.[placeholder];

			if (!config) {
				return `Falta definir la variable {{${placeholder}}}.`;
			}

			if (!config.source) {
				return `Falta elegir de dónde sale {{${placeholder}}}.`;
			}

			if (config.source === 'fixed' && !String(config.fixedValue || '').trim()) {
				return `La variable {{${placeholder}}} está en "valor fijo", pero no tiene valor.`;
			}
		}

		return '';
	}

	async function handleSubmit(event) {
		event.preventDefault();
		setSubmitError('');

		if (!selectedTemplate?.id) {
			setSubmitError('Elegí un template antes de crear la campaña.');
			return;
		}

		if (needsHeaderImageUpload) {
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

		const variableError = validateVariableMapping();
		if (variableError) {
			setSubmitError(variableError);
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
						sort: customerFilters.sort || 'purchase_desc',
						pageSize: customerFilters.pageSize || 24,
						minSpent:
							customerFilters.minSpent === '' ? null : Number(customerFilters.minSpent),
						minOrders:
							customerFilters.minOrders === '' ? null : Number(customerFilters.minOrders),
						hasPhoneOnly: Boolean(customerFilters.hasPhoneOnly),
						hasOrders: Boolean(customerFilters.hasOrders),
						productQuery: customerFilters.productQuery || '',
						selectedProducts: selectedProductFilters,
						selectedCustomerIds: selectedCustomers.map((customer) => customer.id),
						selectedCount: selectedCustomers.length,
						variableMapping,
					}
					: {
						variableMapping,
					},
			notes: form.description.trim() || null,
			sendComponents: getTemplateComponents(selectedTemplate),
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
		setSelectedProductFilters([]);
		setProductSearch('');
		setBulkSelectionInfo({
			count: 0,
			customerIds: [],
			mode: '',
		});
	}

	return (
		<section className="campaign-panel campaign-panel--customers campaign-panel--composer-refresh">
			<div className="campaign-panel-header campaign-panel-header--stacked">
				<div>
					<h3>Crear campaña</h3>
					<p>
						Ahora la campaña no adivina las variables: vos le decís exactamente de dónde sale cada una.
					</p>
				</div>

				<div className="campaign-builder-top-summary">
					<div className="campaign-builder-top-summary-item">
						<strong>{selectedTemplate?.name || 'Sin template'}</strong>
						<span>mensaje elegido</span>
					</div>
					<div className="campaign-builder-top-summary-item">
						<strong>{formatCompactNumber(recipients.length)}</strong>
						<span>destinatarios</span>
					</div>
					<div className="campaign-builder-top-summary-item">
						<strong>USD {estimatedCost.toFixed(2)}</strong>
						<span>{sanitizeCampaignCopy('estimado rÃ¡pido')}</span>
					</div>
				</div>

				<div className="campaign-helper-box">
					<div className="campaign-helper-text">
						Revision rapida antes de crear la campana. Si algo no esta listo, aparece marcado aca y no recien al final.
					</div>

					<div className="campaign-review-grid">
						{campaignChecklist.map((item) => (
							<div key={`clean-${item.id}`} className="campaign-review-card">
								<strong>{sanitizeCampaignCopy(item.label)}</strong>
								<span>{sanitizeCampaignCopy(item.ok ? item.readyText : item.pendingText)}</span>
							</div>
						))}
					</div>

					{campaignReadyToCreate ? (
						<div className="campaign-inline-success">
							La campana ya tiene todo lo necesario para crearse.
						</div>
					) : (
						<div className="campaign-inline-warning">
							Completa los puntos pendientes antes de crear o lanzar la campana.
						</div>
					)}
				</div>

				<div className="campaign-helper-box" style={{ display: 'none' }}>
					<div className="campaign-helper-text">
						RevisiÃ³n rÃ¡pida antes de crear la campaÃ±a. Si algo no estÃ¡ listo, aparece marcado acÃ¡ y no reciÃ©n al final.
					</div>

					<div className="campaign-review-grid">
						{campaignChecklist.map((item) => (
							<div key={item.id} className="campaign-review-card">
								<strong>{item.label}</strong>
								<span>{item.ok ? item.readyText : item.pendingText}</span>
							</div>
						))}
					</div>

					{campaignReadyToCreate ? (
						<div className="campaign-inline-success">
							La campaÃ±a ya tiene todo lo necesario para crearse.
						</div>
					) : (
						<div className="campaign-inline-warning">
							CompletÃ¡ los puntos pendientes antes de crear o lanzar la campaÃ±a.
						</div>
					)}
				</div>
			</div>

			<form className="campaign-form campaign-form--spacious" onSubmit={handleSubmit}>
				<div className="campaign-builder-section campaign-builder-section--hero">
					<div className="campaign-builder-grid campaign-builder-grid--2">
						<label className="field">
							<span>Nombre de campaña</span>
							<input
								value={form.name}
								onChange={(event) =>
									setForm((current) => ({ ...current, name: event.target.value }))
								}
								placeholder="Ej. Clientes que compraron body negro"
							/>
						</label>

						<label className="field">
							<span>Mensaje</span>
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

					<label className="field">
						<span>Notas internas</span>
						<input
							value={form.description}
							onChange={(event) =>
								setForm((current) => ({ ...current, description: event.target.value }))
							}
							placeholder="Opcional. Solo para que el equipo entienda mejor esta campaña"
						/>
					</label>

					{audienceModeOptions.length > 1 && !lockedAudienceMode ? (
						<div className="campaign-audience-choice-clean">
							{audienceModeOptions.includes('customers') ? (
								<button
									type="button"
									className={`campaign-choice-card ${form.audienceMode === 'customers' ? 'active' : ''}`}
									onClick={() => {
										setForm((current) => ({ ...current, audienceMode: 'customers' }));
										setSubmitError('');
									}}
								>
									<strong>Clientes</strong>
									<span>Usá filtros y productos comprados</span>
								</button>
							) : null}

							{audienceModeOptions.includes('manual') ? (
								<button
									type="button"
									className={`campaign-choice-card ${form.audienceMode === 'manual' ? 'active' : ''}`}
									onClick={() => {
										setForm((current) => ({ ...current, audienceMode: 'manual' }));
										setSubmitError('');
									}}
								>
									<strong>Lista manual</strong>
									<span>Un contacto por línea: telefono|nombre|producto|talle|color</span>
								</button>
							) : null}
						</div>
					) : null}

					{requiresHeaderImage ? (
						<div className="field">
							<span>Imagen del encabezado</span>
							<div className="campaign-helper-box">
								<div className="campaign-helper-text">
									{hasTemplateResolvedHeaderImage
										? 'Este template ya tiene una imagen configurada. Solo subi otra si queres reemplazarla para esta campaÃ±a.'
										: 'Este template usa header con imagen y todavia necesita que cargues una para poder enviarse.'}
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
												: hasTemplateResolvedHeaderImage
													? 'Reemplazar imagen'
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

								{hasTemplateResolvedHeaderImage && !uploadedMediaId ? (
									<div className="campaign-inline-success">
										La campaÃ±a va a usar la imagen ya guardada en la plantilla.
									</div>
								) : null}

								{uploadedMediaId ? (
									<div className="campaign-inline-success">
										La campaÃ±a va a usar la nueva imagen cargada.
									</div>
								) : null}

								{imageError ? <div className="campaign-inline-error">{imageError}</div> : null}
							</div>
						</div>
					) : null}
				</div>

				{templatePlaceholders.length ? (
					<div className="campaign-builder-section">
						<div className="campaign-step-head">
							<div>
								<span className="campaign-step-badge">Variables</span>
								<h4>Asigná cada placeholder</h4>
								<p>
									Este template usa {templatePlaceholders.length} variable{templatePlaceholders.length > 1 ? 's' : ''}. Acá decidís de dónde sale cada una.
								</p>
							</div>
							<div className="campaign-customer-kpi campaign-customer-kpi--large">
								<strong>{templatePlaceholders.length}</strong>
								<span>placeholders</span>
							</div>
						</div>

						<div className="campaign-variable-mapper-grid">
							{templatePlaceholders.map((placeholder) => {
								const config = variableMapping?.[placeholder] || { source: 'fixed', fixedValue: '' };
								const sampleValue = sampleResolvedVariables?.[placeholder] || '';

								return (
									<div key={placeholder} className="campaign-variable-mapper-card">
										<div className="campaign-variable-mapper-head">
											<strong>{`{{${placeholder}}}`}</strong>
											<span>
												{sampleValue ? `Ejemplo: ${sampleValue}` : 'Todavía sin ejemplo'}
											</span>
										</div>

										<label className="field">
											<span>Tomar valor desde</span>
											<select
												value={config.source}
												onChange={(event) =>
													updateVariableMapping(placeholder, { source: event.target.value })
												}
											>
												{VARIABLE_SOURCE_OPTIONS.map((option) => (
													<option key={option.value} value={option.value}>
														{option.label}
													</option>
												))}
											</select>
										</label>

										{config.source === 'fixed' ? (
											<label className="field">
												<span>Valor fijo</span>
												<input
													value={config.fixedValue || ''}
													onChange={(event) =>
														updateVariableMapping(placeholder, {
															fixedValue: event.target.value,
														})
													}
													placeholder={`Valor para {{${placeholder}}}`}
												/>
											</label>
										) : null}
									</div>
								);
							})}
						</div>
					</div>
				) : null}

				{form.audienceMode === 'customers' ? (
					<div className="campaign-builder-section">
						<div className="campaign-step-head">
							<div>
								<span className="campaign-step-badge">Paso 1</span>
								<h4>Elegí a quién querés escribirle</h4>
								<p>
									La grilla de clientes quedó oculta para que la pantalla no sea infinita.
									La selección masiva funciona en segundo plano.
								</p>
							</div>
							<div className="campaign-customer-kpi campaign-customer-kpi--large">
								<strong>{formatCompactNumber(totalFoundCount)}</strong>
								<span>clientes encontrados</span>
							</div>
						</div>

						<div className="campaign-builder-grid campaign-builder-grid--2">
							<label className="field">
								<span>Buscar cliente</span>
								<input
									value={customerFilters.q}
									onChange={(event) => updateCustomerFilter('q', event.target.value)}
									placeholder="Nombre, mail o teléfono"
								/>
							</label>

							<label className="field">
								<span>N° pedido</span>
								<input
									value={customerFilters.orderNumber}
									onChange={(event) => updateCustomerFilter('orderNumber', event.target.value)}
									placeholder="Ej. 23621"
								/>
							</label>
						</div>

						<div className="campaign-builder-grid campaign-builder-grid--filters">
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
								<span>Compra desde</span>
								<input
									type="date"
									value={customerFilters.dateFrom}
									onChange={(event) => updateCustomerFilter('dateFrom', event.target.value)}
								/>
							</label>

							<label className="field">
								<span>Compra hasta</span>
								<input
									type="date"
									value={customerFilters.dateTo}
									onChange={(event) => updateCustomerFilter('dateTo', event.target.value)}
								/>
							</label>

							<label className="field">
								<span>Pago</span>
								<select
									value={customerFilters.paymentStatus}
									onChange={(event) => updateCustomerFilter('paymentStatus', event.target.value)}
								>
									{PAYMENT_STATUS_OPTIONS.map((option) => (
										<option key={option.value || 'all'} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</label>
						</div>

						<div className="campaign-product-filter-group">
							<label className="field">
								<span>Producto comprado</span>
								<button
									type="button"
									className={`campaign-product-filter-toggle ${showProductPicker ? 'open' : ''}`}
									onClick={() => setShowProductPicker((current) => !current)}
								>
									{selectedProductFilters.length
										? `Selector de productos (${selectedProductFilters.length})`
										: 'Selector de productos'}
								</button>
							</label>

							{selectedProductFilters.length ? (
								<div className="campaign-selected-products-row campaign-selected-products-row--interactive">
									{selectedProductFilters.map((productName) => (
										<button
											key={productName}
											type="button"
											className="campaign-selected-product-chip"
											onClick={() => toggleProductFilter(productName)}
											title="Quitar producto"
										>
											<span>{productName}</span>
											<strong>×</strong>
										</button>
									))}
								</div>
							) : null}

							{showProductPicker ? (
								<ProductMultiSelect
									options={catalogOptions}
									selectedValues={selectedProductFilters}
									search={productSearch}
									onSearchChange={setProductSearch}
									onToggleValue={toggleProductFilter}
									onClear={clearSelectedProducts}
								/>
							) : null}
						</div>

						<div className="campaign-inline-actions campaign-inline-actions--wrap">
							<button
								type="button"
								className="button primary"
								onClick={() => loadCustomers(customerFilters)}
								disabled={customerAudience.loading}
							>
								{customerAudience.loading ? 'Buscando…' : 'Actualizar audiencia'}
							</button>

							<label className="field campaign-contact-limit-field">
								<span>Cantidad a contactar</span>
								<input
									type="number"
									min="1"
									value={contactLimit}
									onChange={(event) => setContactLimit(event.target.value)}
									placeholder="Ej. 100"
								/>
							</label>

							<button
								type="button"
								className="button secondary"
								onClick={handleSelectAllFilteredCustomers}
								disabled={customerAudience.loadingAll || !totalFoundCount}
							>
								{selectionButtonLabel}
							</button>

							<button
								type="button"
								className="button ghost"
								onClick={() => setShowAudiencePreview((current) => !current)}
								disabled={!selectedCustomerCount}
							>
								{showAudiencePreview ? 'Ocultar preview' : 'Ver preview'}
							</button>

							<button
								type="button"
								className="button ghost"
								onClick={clearFilteredSelection}
								disabled={!selectedCustomerCount}
							>
								Quitar selección masiva
							</button>
						</div>

						<div className="campaign-audience-summary-grid">
							<div className="campaign-audience-summary-card">
								<strong>{formatCompactNumber(totalFoundCount)}</strong>
								<span>clientes encontrados</span>
							</div>

							<div className="campaign-audience-summary-card">
								<strong>{formatCompactNumber(selectedCustomerCount)}</strong>
								<span>clientes seleccionados</span>
							</div>

							<div className="campaign-audience-summary-card">
								<strong>{formatCompactNumber(selectedProductFilters.length)}</strong>
								<span>productos marcados</span>
							</div>
						</div>

						<div className="campaign-helper-box">
							<div className="campaign-helper-text">
								No se muestran las tarjetas de clientes para que la página no se haga kilométrica.
								La selección se hace en segundo plano según los filtros actuales.
							</div>

							{selectedProductFilters.length ? (
								<div className="campaign-selected-products-row">
									{selectedProductFilters.map((product) => (
										<span key={product} className="campaign-selected-product-chip">
											{product}
										</span>
									))}
								</div>
							) : null}

							{selectedProductFilters.length ? (
								<div className="campaign-helper-inline-text">
									Con los filtros actuales, la muestra contiene {formatCompactNumber(selectedVisibleProductMatchesCount)} cliente(s) con teléfono.
								</div>
							) : null}
							{bulkSelectionInfo.count > 0 ? (
								<div className="campaign-inline-success">
									Se seleccionaron {formatCompactNumber(bulkSelectionInfo.count)} cliente(s) para esta campaña.
								</div>
							) : (
								<div className="campaign-inline-warning">
									Todavía no seleccionaste destinatarios. Primero filtrá y después apretá el botón de seleccionar.
								</div>
							)}
						</div>

						{customerAudience.error ? (
							<div className="campaign-inline-error">{customerAudience.error}</div>
						) : null}
					</div>
				) : (
					<div className="campaign-builder-section">
						<div className="campaign-step-head">
							<div>
								<span className="campaign-step-badge">Manual</span>
								<h4>Cargá destinatarios manuales</h4>
								<p>Formato: telefono|nombre|producto|talle|color</p>
							</div>
						</div>

						<label className="field">
							<span>Lista manual</span>
							<textarea
								rows={8}
								value={form.audienceText}
								onChange={(event) =>
									setForm((current) => ({ ...current, audienceText: event.target.value }))
								}
								placeholder={`5492211111111|Juan|Body Reductor|M|Negro\n5492212222222|Ana|Calza Térmica|L|Azul`}
							/>
						</label>
					</div>
				)}

				<div className="campaign-builder-section campaign-builder-section--review">
					<div className="campaign-step-head">
						<div>
							<span className="campaign-step-badge">Resumen</span>
							<h4>Último chequeo</h4>
							<p>Acá ves si la campaña ya está lista o si todavía le falta algo.</p>
						</div>
					</div>

					<div className="campaign-review-grid">
						<div className="campaign-review-card">
							<strong>{selectedTemplate?.name || '—'}</strong>
							<span>template</span>
						</div>
						<div className="campaign-review-card">
							<strong>{formatCompactNumber(recipients.length)}</strong>
							<span>destinatarios</span>
						</div>
						<div className="campaign-review-card">
							<strong>{templatePlaceholders.length}</strong>
							<span>variables</span>
						</div>
						<div className="campaign-review-card">
							<strong>USD {estimatedCost.toFixed(2)}</strong>
							<span>estimado</span>
						</div>
						<div className="campaign-review-card">
							<strong>
								{requiresHeaderImage
									? campaignOverridesTemplateImage
										? 'Imagen nueva'
										: hasTemplateResolvedHeaderImage
											? 'Lista'
											: 'Falta imagen'
									: 'No aplica'}
							</strong>
							<span>header image</span>
						</div>
						<div className="campaign-review-card">
							<strong>{form.sendNow ? 'Se lanza al crear' : 'Queda en borrador'}</strong>
							<span>estado inicial</span>
						</div>
					</div>

					{templatePlaceholders.length ? (
						<div className="campaign-variable-preview-box">
							<strong>Ejemplo con el primer destinatario</strong>
							<div className="campaign-variable-list">
								{templatePlaceholders.map((placeholder) => (
									<span key={placeholder}>
										{`{{${placeholder}}} → ${sampleResolvedVariables?.[placeholder] || '—'}`}
									</span>
								))}
							</div>
						</div>
					) : null}

					{form.audienceMode === 'customers' && showAudiencePreview ? (
						<div className="campaign-recipient-preview-box">
							<div className="campaign-recipient-preview-head">
								<div>
									<strong>Preview de destinatarios</strong>
									<p>
										Acá ves a quiénes se va a contactar. Podés sacar cualquiera antes de crear la campaña.
									</p>
								</div>
								<span>{formatCompactNumber(selectedCustomerCount)} seleccionado(s)</span>
							</div>

							<div className="campaign-recipient-preview-toolbar">
								<label className="field campaign-recipient-preview-search">
									<span>Buscar destinatario</span>
									<input
										type="text"
										value={previewSearch}
										onChange={(event) => setPreviewSearch(event.target.value)}
										placeholder="Nombre, teléfono, mail o producto"
									/>
								</label>
							</div>

							<div className="campaign-recipient-preview-table">
								<div className="campaign-recipient-preview-row campaign-recipient-preview-row--head">
									<span>Destinatario</span>
									<span>Teléfono</span>
									<span>Producto</span>
									<span>Acción</span>
								</div>

								{previewCustomers.length ? (
									previewCustomers.map((customer) => (
										<div
											key={customer.id}
											className="campaign-recipient-preview-row"
										>
											<span>{getRecipientDisplayName(customer)}</span>
											<span>{normalizePhone(customer.phone || '') || '—'}</span>
											<span>{getRecipientProductPreview(customer) || '—'}</span>
											<span>
												<button
													type="button"
													className="button ghost danger"
													onClick={() => removeSelectedCustomer(customer.id)}
												>
													Eliminar
												</button>
											</span>
										</div>
									))
								) : (
									<div className="campaign-recipient-preview-empty">
										No hay destinatarios que coincidan con la búsqueda.
									</div>
								)}
							</div>

							<div className="campaign-recipient-preview-pagination">
								<span>
									Mostrando{' '}
									{previewFilteredCustomers.length
										? `${(previewPage - 1) * PREVIEW_PAGE_SIZE + 1}–${Math.min(
												previewPage * PREVIEW_PAGE_SIZE,
												previewFilteredCustomers.length
										)}`
										: '0'}{' '}
									de {formatCompactNumber(previewFilteredCustomers.length)}
								</span>

								<div className="campaign-recipient-preview-pagination-actions">
									<button
										type="button"
										className="button ghost"
										onClick={() => setPreviewPage((current) => Math.max(1, current - 1))}
										disabled={previewPage <= 1}
									>
										Anterior
									</button>

									<span className="campaign-recipient-preview-page-indicator">
										Página {previewPage} de {previewTotalPages}
									</span>

									<button
										type="button"
										className="button ghost"
										onClick={() =>
											setPreviewPage((current) => Math.min(previewTotalPages, current + 1))
										}
										disabled={previewPage >= previewTotalPages}
									>
										Siguiente
									</button>
								</div>
							</div>
						</div>
					) : null}
					<label className="campaign-toggle">
						<input
							type="checkbox"
							checked={form.sendNow}
							onChange={(event) =>
								setForm((current) => ({ ...current, sendNow: event.target.checked }))
							}
						/>
						<span>Lanzar campaña apenas se cree</span>
					</label>

					{submitError ? <div className="campaign-inline-error">{submitError}</div> : null}

					<div className="campaign-form-actions campaign-form-actions--end">
						<button
							className="button primary"
							type="submit"
							disabled={creating || uploadingImage || !campaignReadyToCreate}
						>
							{creating ? 'Creando…' : 'Crear campaña'}
						</button>
					</div>
				</div>
			</form>
		</section>
	);
}
