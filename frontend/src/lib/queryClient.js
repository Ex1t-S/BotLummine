export const queryKeys = {
	authMe: ['auth', 'me'],
	inbox: (queue, search = '', readFilter = 'ALL', attentionFilter = 'ALL') => ['dashboard', 'inbox', queue, search, readFilter, attentionFilter],
	conversation: (conversationId) => ['dashboard', 'conversation', conversationId],
	abandonedCarts: (filters) => ['dashboard', 'abandoned-carts', filters],
	catalog: (params) => ['dashboard', 'catalog', params],
	campaigns: {
		overview: ['campaigns', 'overview'],
		templates: (filters = {}) => ['campaigns', 'templates', filters],
		runs: (filters = {}) => ['campaigns', 'runs', filters],
		detail: (campaignId) => ['campaigns', 'detail', campaignId],
	},
};

export const queryPresets = {
	inbox: {
		staleTime: 15 * 1000,
		gcTime: 5 * 60 * 1000,
	},
	conversation: {
		staleTime: 5 * 1000,
		gcTime: 5 * 60 * 1000,
	},
	abandonedCarts: {
		staleTime: 30 * 1000,
		gcTime: 5 * 60 * 1000,
	},
	campaigns: {
		staleTime: 20 * 1000,
		gcTime: 5 * 60 * 1000,
	},
};
