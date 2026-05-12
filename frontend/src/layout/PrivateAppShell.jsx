import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import DashboardLayout from './DashboardLayout.jsx';

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				refetchOnWindowFocus: false,
				retry: 1,
				staleTime: 15 * 1000,
				gcTime: 5 * 60 * 1000,
			},
			mutations: {
				retry: 0,
			},
		},
	});
}

export default function PrivateAppShell() {
	const [queryClient] = useState(createQueryClient);

	return (
		<ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
			<QueryClientProvider client={queryClient}>
				<DashboardLayout />
			</QueryClientProvider>
		</ThemeProvider>
	);
}
