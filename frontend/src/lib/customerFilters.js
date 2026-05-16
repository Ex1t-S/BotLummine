export const CUSTOMER_PRODUCT_QUERY_SEPARATOR = '||';

function isBlank(value) {
	return value === undefined || value === null || String(value).trim() === '';
}

function normalizeList(values = []) {
	return Array.from(
		new Set(
			values
				.map((value) => String(value || '').trim())
				.filter(Boolean)
		)
	);
}

export function serializeCustomerFilterList(values = []) {
	return normalizeList(values).join(CUSTOMER_PRODUCT_QUERY_SEPARATOR);
}

export function serializeCustomerProductFilters(selectedProducts = []) {
	return serializeCustomerFilterList(selectedProducts);
}

export function normalizeCustomerFilterParams(
	filters = {},
	{
		pageSize = 24,
		selectedProducts = [],
		includeCampaignFields = false,
		sentTemplateNames = [],
	} = {}
) {
	const selectedProductQuery = serializeCustomerProductFilters(selectedProducts);
	const templateNames = normalizeList(sentTemplateNames);
	const shouldExcludeSentTemplate = Boolean(
		includeCampaignFields &&
		filters.excludeSentTemplate &&
		templateNames.length
	);

	const params = {
		q: filters.q || '',
		productQuery: selectedProductQuery || filters.productQuery || '',
		orderNumber: filters.orderNumber || '',
		dateFrom: filters.dateFrom || '',
		dateTo: filters.dateTo || '',
		paymentStatus: filters.paymentStatus || '',
		shippingStatus: filters.shippingStatus || '',
		minSpent: isBlank(filters.minSpent) ? '' : filters.minSpent,
		hasPhoneOnly: filters.hasPhoneOnly ? '1' : '',
		sort: filters.sort || 'purchase_desc',
		page: filters.page || 1,
		pageSize: filters.pageSize || pageSize,
	};

	if (!includeCampaignFields) {
		return params;
	}

	return {
		...params,
		minOrders: isBlank(filters.minOrders) ? '' : filters.minOrders,
		hasOrders: filters.hasOrders ? '1' : '',
		excludeSentTemplate: shouldExcludeSentTemplate ? '1' : '',
		sentTemplateName: shouldExcludeSentTemplate ? templateNames[0] : '',
		sentTemplateNames: shouldExcludeSentTemplate
			? templateNames.join(CUSTOMER_PRODUCT_QUERY_SEPARATOR)
			: '',
	};
}
