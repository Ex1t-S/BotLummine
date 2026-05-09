import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import App from './App.jsx';
import AppErrorBoundary from './components/AppErrorBoundary.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './styles/global.css';

function logGlobalFrontendError(type, detail) {
	console.error('[APP][GLOBAL_ERROR]', {
		type,
		path: `${window.location.pathname}${window.location.search}${window.location.hash}`,
		detail,
	});
}

window.addEventListener('error', (event) => {
	logGlobalFrontendError('error', {
		message: event.message,
		source: event.filename,
		line: event.lineno,
		column: event.colno,
		error: event.error,
	});
});

window.addEventListener('unhandledrejection', (event) => {
	logGlobalFrontendError('unhandledrejection', event.reason);
});

const queryClient = new QueryClient({
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

ReactDOM.createRoot(document.getElementById('root')).render(
	<React.StrictMode>
		<AppErrorBoundary>
			<ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
				<QueryClientProvider client={queryClient}>
					<BrowserRouter>
						<AuthProvider>
							<App />
						</AuthProvider>
					</BrowserRouter>
				</QueryClientProvider>
			</ThemeProvider>
		</AppErrorBoundary>
	</React.StrictMode>
);
