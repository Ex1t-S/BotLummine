import React from 'react';

function getCurrentPath() {
	if (typeof window === 'undefined') return '';
	return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export default class AppErrorBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = {
			error: null,
			info: null,
			resetKey: 0,
		};
	}

	static getDerivedStateFromError(error) {
		return { error };
	}

	componentDidCatch(error, info) {
		console.error('[APP][ERROR_BOUNDARY]', {
			path: getCurrentPath(),
			error,
			componentStack: info?.componentStack || '',
		});
		this.setState({ info });
	}

	handleRetry = () => {
		this.setState((current) => ({
			error: null,
			info: null,
			resetKey: current.resetKey + 1,
		}));
	};

	handleReload = () => {
		if (typeof window !== 'undefined') {
			window.location.reload();
		}
	};

	render() {
		const { error, info, resetKey } = this.state;

		if (!error) {
			return <React.Fragment key={resetKey}>{this.props.children}</React.Fragment>;
		}

		const showDetails = import.meta.env.DEV;

		return (
			<main className="app-error-boundary" role="alert">
				<section className="app-error-boundary__panel">
					<span className="app-error-boundary__eyebrow">Error de carga</span>
					<h1>No se pudo cargar la sección</h1>
					<p>
						La app encontró un error mientras cambiaba de pantalla. Podés reintentar sin
						recargar, o recargar la app completa si el problema vino de un archivo desactualizado.
					</p>
					<div className="app-error-boundary__actions">
						<button type="button" onClick={this.handleRetry}>
							Reintentar
						</button>
						<button type="button" className="secondary" onClick={this.handleReload}>
							Recargar app
						</button>
					</div>
					{showDetails ? (
						<pre className="app-error-boundary__details">
							{String(error?.stack || error?.message || error)}
							{info?.componentStack ? `\n${info.componentStack}` : ''}
						</pre>
					) : null}
				</section>
			</main>
		);
	}
}
