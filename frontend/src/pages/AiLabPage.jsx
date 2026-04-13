import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../lib/api.js';
import './AiLabPage.css';

function JsonBlock({ value }) {
	const formatted = useMemo(() => {
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value || '');
		}
	}, [value]);

	return <pre className="ai-lab-code-block">{formatted}</pre>;
}

function getAssistantText(value) {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object') {
		if (typeof value.text === 'string') return value.text;
		if (typeof value.output_text === 'string') return value.output_text;
		if (typeof value.message === 'string') return value.message;
	}
	return 'Todavía no corriste ningún turno.';
}

function getApiError(error) {
	return error?.response?.data?.error || error?.message || 'Error desconocido';
}

export default function AiLabPage() {
	const messagesEndRef = useRef(null);
	const [session, setSession] = useState(null);
	const [fixtureKey, setFixtureKey] = useState('blank');
	const [messageText, setMessageText] = useState('');
	const [showPrompt, setShowPrompt] = useState(false);
	const [showCatalog, setShowCatalog] = useState(false);
	const [uiError, setUiError] = useState('');

	const fixturesQuery = useQuery({
		queryKey: ['ai-lab', 'fixtures'],
		queryFn: async () => {
			const res = await api.get('/ai-lab/fixtures');
			return res.data.fixtures || [];
		},
		staleTime: 60 * 1000,
		retry: false
	});

	const createSessionMutation = useMutation({
		mutationFn: async (nextFixtureKey) => {
			const res = await api.post('/ai-lab/sessions', { fixtureKey: nextFixtureKey });
			return res.data.session;
		},
		onSuccess: (nextSession) => {
			setUiError('');
			setSession(nextSession);
			setMessageText('');
		},
		onError: (error) => setUiError(`No se pudo crear la sesión: ${getApiError(error)}`)
	});

	const resetSessionMutation = useMutation({
		mutationFn: async () => {
			if (!session?.id) return null;
			const res = await api.post(`/ai-lab/sessions/${session.id}/reset`, { fixtureKey });
			return res.data.session;
		},
		onSuccess: (nextSession) => {
			if (!nextSession) return;
			setUiError('');
			setSession(nextSession);
			setMessageText('');
		},
		onError: (error) => setUiError(`No se pudo reiniciar la charla: ${getApiError(error)}`)
	});

	const sendMessageMutation = useMutation({
		mutationFn: async (payload = {}) => {
			if (!session?.id) return null;
			const res = await api.post(`/ai-lab/sessions/${session.id}/messages`, {
				body: payload.body || '',
				selectionId: payload.selectionId || '',
				action: payload.action || ''
			});
			return res.data.session;
		},
		onSuccess: (nextSession) => {
			if (!nextSession) return;
			setUiError('');
			setSession(nextSession);
			setMessageText('');
		},
		onError: (error) => setUiError(`No se pudo enviar el mensaje: ${getApiError(error)}`)
	});

	useEffect(() => {
		if (fixturesQuery.error) {
			setUiError(`No se pudieron cargar los fixtures: ${getApiError(fixturesQuery.error)}`);
		}
	}, [fixturesQuery.error]);

	useEffect(() => {
		if (!fixturesQuery.data?.length || session || createSessionMutation.isPending) {
			return;
		}

		const exists = fixturesQuery.data.some((fixture) => fixture.key === fixtureKey);
		const nextFixtureKey = exists ? fixtureKey : fixturesQuery.data[0].key;
		if (!exists) setFixtureKey(nextFixtureKey);
		createSessionMutation.mutate(nextFixtureKey);
	}, [fixturesQuery.data, session, fixtureKey, createSessionMutation]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
	}, [session?.messages?.length]);

	const isBusy = createSessionMutation.isPending || resetSessionMutation.isPending || sendMessageMutation.isPending;
	const trace = session?.lastTrace || null;
	const commercialPlan = trace?.commercialPlan || null;
	const fixtures = fixturesQuery.data || [];
	const activeFixture = fixtures.find((fixture) => fixture.key === fixtureKey) || session?.fixtureMeta || null;
	const debugOffers = commercialPlan?.offerCandidates || [];
	const menuPreview = session?.menuPreview || null;

	function handleSubmit(event) {
		event.preventDefault();
		if (!messageText.trim() || !session?.id) return;
		sendMessageMutation.mutate({ body: messageText.trim() });
	}

	function handleOpenMenu() {
		if (!session?.id) return;
		sendMessageMutation.mutate({ action: 'open_menu' });
	}

	function handleMenuSelection(selectionId) {
		if (!session?.id || !selectionId) return;
		sendMessageMutation.mutate({ selectionId });
	}

	return (
		<div className="ai-lab-page">
			<section className="ai-lab-sidebar-card">
				<div className="ai-lab-sidebar-header">
					<div>
						<h1>AI Lab</h1>
						<p>Probá la IA sin WhatsApp. Elegís escenario, reiniciás rápido y ves por qué respondió eso.</p>
					</div>
				</div>

				{uiError ? (
					<div className="ai-lab-meta-box compact" style={{ borderColor: '#fecaca' }}>
						<h3>Error</h3>
						<p style={{ color: '#b91c1c', margin: 0 }}>{uiError}</p>
					</div>
				) : null}

				<label className="ai-lab-field">
					<span>Escenario</span>
					<select value={fixtureKey} onChange={(event) => setFixtureKey(event.target.value)} disabled={!fixtures.length}>
						{fixtures.map((fixture) => (
							<option key={fixture.key} value={fixture.key}>
								{fixture.name}
							</option>
						))}
					</select>
				</label>

				<div className="ai-lab-actions-row">
					<button type="button" className="ai-lab-primary-btn" onClick={() => createSessionMutation.mutate(fixtureKey)} disabled={isBusy || !fixtures.length}>
						Nueva sesión
					</button>
					<button type="button" className="ai-lab-secondary-btn" onClick={() => resetSessionMutation.mutate()} disabled={!session?.id || isBusy}>
						Reiniciar charla
					</button>
				</div>

				<div className="ai-lab-meta-box compact">
					<h3>Cómo usarlo</h3>
					<ul>
						<li><strong>Nueva sesión</strong>: crea una charla nueva con el escenario elegido.</li>
						<li><strong>Reiniciar charla</strong>: vuelve a cargar el mismo escenario sobre la charla actual.</li>
						<li>Si cambiás el selector, el chat no cambia hasta tocar uno de esos botones.</li>
					</ul>
				</div>

				<div className="ai-lab-fixture-list">
					{fixtures.map((fixture) => {
						const active = fixture.key === fixtureKey;
						return (
							<button key={fixture.key} type="button" className={`ai-lab-fixture-card ${active ? 'active' : ''}`} onClick={() => setFixtureKey(fixture.key)}>
								<strong>{fixture.name}</strong>
								<span>{fixture.description}</span>
								<small>{fixture.messageCount} mensajes base</small>
							</button>
						);
					})}
				</div>

				<div className="ai-lab-meta-box">
					<h3>Qué deberías mirar</h3>
					<ul>
						{activeFixture?.expected?.length ? (
							activeFixture.expected.map((item) => <li key={item}>{item}</li>)
						) : (
							<li>Elegí un escenario para cargar expectativas rápidas.</li>
						)}
					</ul>
				</div>
			</section>

			<section className="ai-lab-chat-card">
				<div className="ai-lab-chat-header">
					<div>
						<h2>{session?.contactName || 'Cliente de prueba'}</h2>
						<p>{session?.customerContext?.waId || 'Sin número cargado'}</p>
					</div>
					<div className="ai-lab-chip-group">
						<span className="ai-lab-chip">{trace?.intent || 'sin intent'}</span>
						<span className="ai-lab-chip secondary">{commercialPlan?.stage || 'DISCOVERY'}</span>
					</div>
				</div>

				<div className="ai-lab-session-banner">
					<div>
						<strong>Escenario cargado:</strong> {session?.fixtureMeta?.name || 'Sin escenario'}
					</div>
					<div>
						<strong>Proveedor:</strong> {trace?.providerMeta?.provider || trace?.provider || 'sin correr'}{trace?.providerMeta?.model ? ` · ${trace.providerMeta.model}` : ''}
					</div>
				</div>

				<div className="ai-lab-chat-body">
					{session?.messages?.length ? (
						session.messages.map((message) => (
							<div key={message.id} className={`ai-lab-bubble ${message.role === 'assistant' ? 'assistant' : 'user'}`}>
								<div className="ai-lab-bubble-text">{message.text}</div>
								<div className="ai-lab-bubble-meta">
									<span>{message.role === 'assistant' ? 'Sofi' : session?.contactName || 'Cliente'}</span>
									<span>{new Date(message.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
								</div>
							</div>
						))
					) : (
						<div className="empty-state large">Cargá un escenario o arrancá desde cero.</div>
					)}
					<div ref={messagesEndRef} />
				</div>

				<form className="ai-lab-chat-form" onSubmit={handleSubmit}>
					<textarea
						value={messageText}
						onChange={(event) => setMessageText(event.target.value)}
						placeholder="Escribí como si fueras el cliente..."
						rows={4}
						disabled={!session?.id || isBusy}
					/>
					<button type="submit" disabled={!messageText.trim() || !session?.id || isBusy}>
						{sendMessageMutation.isPending ? 'Probando...' : 'Enviar al lab'}
					</button>
				</form>

				<div className="ai-lab-inline-actions">
					<button type="button" className="ai-lab-secondary-btn" onClick={handleOpenMenu} disabled={!session?.id || isBusy}>
						Abrir menu comprador
					</button>
				</div>

				{menuPreview?.options?.length ? (
					<div className="ai-lab-inline-menu">
						<div className="ai-lab-inline-menu__header">
							<div>
								<strong>Menu comprador</strong>
								<span>{menuPreview.menuPath || 'sin ruta'}</span>
							</div>
							<span className={`ai-lab-chip ${menuPreview.menuActive ? '' : 'secondary'}`}>
								{menuPreview.menuActive ? 'Activo' : 'Ultimo menu'}
							</span>
						</div>

						<p>{menuPreview.fallbackText || 'Sin vista previa del menu.'}</p>

						<div className="ai-lab-inline-menu__options">
							{menuPreview.options.map((option) => (
								<button
									key={option.id}
									type="button"
									className="ai-lab-inline-menu__option"
									onClick={() => handleMenuSelection(option.id)}
									disabled={isBusy}
								>
									<strong>{option.title}</strong>
									<span>{option.description || option.sectionTitle || option.id}</span>
								</button>
							))}
						</div>
					</div>
				) : null}
			</section>

			<aside className="ai-lab-debug-card">
				<div className="ai-lab-debug-header">
					<h2>Debug</h2>
					<div className="ai-lab-debug-toggles">
						<button type="button" onClick={() => setShowCatalog((value) => !value)}>
							{showCatalog ? 'Ocultar catálogo' : 'Ver catálogo'}
						</button>
						<button type="button" onClick={() => setShowPrompt((value) => !value)}>
							{showPrompt ? 'Ocultar prompt' : 'Ver prompt'}
						</button>
					</div>
				</div>

				<div className="ai-lab-debug-grid">
					<div className="ai-lab-debug-item">
						<h3>Respuesta final</h3>
						<p>{getAssistantText(trace?.assistantMessage)}</p>
					</div>
					<div className="ai-lab-debug-item">
						<h3>Acción recomendada</h3>
						<p>{commercialPlan?.recommendedAction || 'Sin datos'}</p>
					</div>
					<div className="ai-lab-debug-item">
						<h3>Producto foco</h3>
						<p>{commercialPlan?.productFocus || 'No definido'}</p>
					</div>
					<div className="ai-lab-debug-item">
						<h3>Oferta principal</h3>
						<p>{commercialPlan?.bestOffer?.name || 'Todavía no conviene cerrar una promo'}</p>
					</div>
					<div className="ai-lab-debug-item">
						<h3>Precio principal</h3>
						<p>{commercialPlan?.bestOffer?.price || 'No definido'}</p>
					</div>
					<div className="ai-lab-debug-item">
						<h3>¿Comparte link?</h3>
						<p>{commercialPlan?.shareLinkNow ? 'Sí' : 'No'}</p>
					</div>
				</div>

				<div className="ai-lab-meta-box compact">
					<h3>Opciones detectadas</h3>
					<JsonBlock value={debugOffers} />
				</div>

				<div className="ai-lab-meta-box compact">
					<h3>Estado de conversación</h3>
					<JsonBlock value={session?.conversationState || {}} />
				</div>

				{showCatalog ? (
					<div className="ai-lab-meta-box compact">
						<h3>Catálogo relevante</h3>
						<JsonBlock value={trace?.catalogProducts || []} />
					</div>
				) : null}

				<div className="ai-lab-meta-box compact">
					<h3>Hints comerciales</h3>
					<JsonBlock value={trace?.commercialHints || []} />
				</div>

				<div className="ai-lab-meta-box compact">
					<h3>Asistencia de menú</h3>
					<JsonBlock value={trace?.menuAssistantContext || {}} />
				</div>

				{showPrompt ? (
					<div className="ai-lab-meta-box compact">
						<h3>Prompt final</h3>
						<pre className="ai-lab-code-block large">{trace?.prompt || 'Todavía no hay prompt para mostrar.'}</pre>
					</div>
				) : null}
			</aside>
		</div>
	);
}
