import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
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

ReactDOM.createRoot(document.getElementById('root')).render(
	<React.StrictMode>
		<AppErrorBoundary>
			<BrowserRouter>
				<AuthProvider>
					<App />
				</AuthProvider>
			</BrowserRouter>
		</AppErrorBoundary>
	</React.StrictMode>
);
