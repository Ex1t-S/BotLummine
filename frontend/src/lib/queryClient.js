export const queryKeys = {
	authMe: ['auth', 'me'],
	inbox: (queue) => ['dashboard', 'inbox', queue],
	conversation: (conversationId) => ['dashboard', 'conversation', conversationId],
	abandonedCarts: (filters) => ['dashboard', 'abandoned-carts', filters],
	catalog: (params) => ['dashboard', 'catalog', params],
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
	catalog: {
		staleTime: 60 * 1000,
		gcTime: 10 * 60 * 1000,
	},
};