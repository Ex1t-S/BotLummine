import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { List, MessageSquarePlus, RotateCcw } from 'lucide-react';
import api from '../lib/api.js';
import { ActionButton } from '../components/ui/InternalPage.jsx';
import { useInternalDarkOverrides } from '../hooks/useInternalDarkOverrides.js';
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

function getInteractivePayload(message = {}) {
	if (String(message.type || '').toLowerCase() !== 'interactive') return null;
	const payload = message.interactivePayload || null;
	return payload && typeof payload === 'object' ? payload : null;
}

function isGenericMenuTitle(value = '') {
	return /^(men[uú]\s+principal|marca)$/i.test(String(value || '').trim());
}

function stripMenuFallbackOptions(text = '') {
	const normalized = String(text || '')
		.replace(/\*\s*([^*]+?)\s*\*/g, '$1')
		.replace(/\s+\d+\s*[-.)]\s+[^0-9\n]+(?=(\s+\d+\s*[-.)]\s+|$))/g, ' ')
		.replace(/\bmen[uú]\s+principal\b/gi, ' ')
		.replace(/\bescrib[ií]\s+0\s+o\s+men[uú]\s+para\s+volver[^\n]*/gi, ' ');
	const lines = normalized.split('\n');
	const cleanLines = [];

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			if (cleanLines.length && cleanLines[cleanLines.length - 1] !== '') cleanLines.push('');
			continue;
		}
		if (/^\*[^*]+\*$/.test(line)) continue;
		if (/^(\d+[-.)]|[-*•])\s+/i.test(line)) continue;
		if (/^menu principal$/i.test(line)) continue;
		if (/^escribi\s+0\s+o\s+menu\s+para\s+volver/i.test(line)) continue;
		if (/^(menu_|[a-z0-9_]+)$/i.test(line)) continue;
		cleanLines.push(rawLine);
	}

	return cleanLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function getInteractiveMenuRows(payload = {}) {
	return (payload.sections || [])
		.flatMap((section) =>
			(section?.rows || []).map((row) => ({
				id: row.id,
				title: row.title,
				description: row.description || section.title || '',
			}))
		)
		.filter((row) => row.id && row.title);
}

function resolveInteractiveMenuDisplay(message = {}) {
	const payload = getInteractivePayload(message) || {};
	const fallbackBody = stripMenuFallbackOptions(message.text);
	const bodyText = String(payload.bodyText || payload.body || '').trim() || fallbackBody;
	const headerText = String(payload.headerText || '').trim();
	const title =
		(isGenericMenuTitle(headerText) ? '' : headerText) ||
		String(message.provider || '').trim() ||
		'BladeIA';
	const buttonText = String(payload.buttonText || '').trim() || 'Abrir menu';

	return {
		title,
		bodyText,
		buttonText,
		rows: getInteractiveMenuRows(payload),
	};
}

function renderFormattedText(text = '') {
	const lines = String(text || '').split('\n');
	return lines.map((line, lineIndex) => (
		<span key={`line-${lineIndex}`}>
			{line}
			{lineIndex < lines.length - 1 ? <br /> : null}
		</span>
	));
}

function AiLabInteractiveMenuMessage({ message, isBusy, onSelect }) {
	const display = resolveInteractiveMenuDisplay(message);
	const createdAtLabel = new Date(message.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

	return (
		<div className="ai-lab-interactive-menu-card">
			<div className="ai-lab-interactive-menu-content">
				<div className="ai-lab-interactive-menu-title">{display.title}</div>
				{display.bodyText ? (
					<div className="ai-lab-interactive-menu-body">
						{renderFormattedText(display.bodyText)}
					</div>
				) : null}
				<div className="ai-lab-interactive-menu-time">{createdAtLabel}</div>
			</div>
			<div className="ai-lab-interactive-menu-action" aria-hidden="true">
				<List size={18} strokeWidth={2.4} />
				<span>{display.buttonText}</span>
			</div>
			{display.rows.length ? (
				<div className="ai-lab-interactive-menu-options">
					{display.rows.map((row, index) => (
						<button
							key={row.id}
							type="button"
							className="ai-lab-interactive-menu-option"
							onClick={() => onSelect(row.id)}
							disabled={isBusy}
						>
							<span>{index + 1}</span>
							<strong>{row.title}</strong>
							{row.description ? <small>{row.description}</small> : null}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}

export default function AiLabPage() {
	useInternalDarkOverrides();

	const messagesEndRef = useRef(null);
	const autoSessionFixtureRef = useRef(null);
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
		if (autoSessionFixtureRef.current === nextFixtureKey) return;
		autoSessionFixtureRef.current = nextFixtureKey;
		createSessionMutation.mutate(nextFixtureKey);
	}, [fixturesQuery.data, session, fixtureKey, createSessionMutation.isPending]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
	}, [session?.messages?.length]);

	const isBusy = createSessionMutation.isPending || resetSessionMutation.isPending || sendMessageMutation.isPending;
	const trace = session?.lastTrace || null;
	const commercialPlan = trace?.commercialPlan || null;
	const fixtures = fixturesQuery.data || [];
	const activeFixture = fixtures.find((fixture) => fixture.key === fixtureKey) || session?.fixtureMeta || null;
	const debugOffers = commercialPlan?.offerCandidates || [];
	const persistedRuns = session?.runs || [];

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
						<p>Probá respuestas, escenarios y trazas sin usar WhatsApp real.</p>
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
					<ActionButton className="ai-lab-primary-btn" onClick={() => createSessionMutation.mutate(fixtureKey)} disabled={isBusy || !fixtures.length} icon={MessageSquarePlus}>
						Crear sesión
					</ActionButton>
					<ActionButton variant="secondary" className="ai-lab-secondary-btn" onClick={() => resetSessionMutation.mutate()} disabled={!session?.id || isBusy} icon={RotateCcw}>
						Reiniciar charla
					</ActionButton>
				</div>

				<details className="ai-lab-fixture-drawer">
					<summary>
						<span>Escenarios de prueba</span>
						<small>{fixtures.length} disponibles</small>
					</summary>
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
				</details>

				<details className="ai-lab-meta-box ai-lab-expectations-drawer">
					<summary>Expectativas del escenario</summary>
					<ul>
						{activeFixture?.expected?.length ? (
							activeFixture.expected.map((item) => <li key={item}>{item}</li>)
						) : (
							<li>Seleccioná un escenario para cargar sus expectativas.</li>
						)}
					</ul>
				</details>
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
						session.messages.map((message) => {
							const isAssistant = message.role === 'assistant';
							const interactivePayload = getInteractivePayload(message);
							const createdAtLabel = new Date(message.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

							return (
								<div
									key={message.id}
									className={`ai-lab-message-row ${isAssistant ? 'ai-lab-message-row--outbound' : 'ai-lab-message-row--inbound'}`}
								>
									<div className="ai-lab-message-avatar" aria-hidden="true">
										{isAssistant ? 'IA' : (session?.contactName || 'CL').slice(0, 2).toUpperCase()}
									</div>
									<div className="ai-lab-message-stack">
										<div className={`ai-lab-bubble ${isAssistant ? 'assistant' : 'user'} ${interactivePayload ? 'ai-lab-bubble--interactive-menu' : ''}`}>
											{interactivePayload ? (
												<AiLabInteractiveMenuMessage
													message={message}
													isBusy={isBusy}
													onSelect={handleMenuSelection}
												/>
											) : (
												<div className="ai-lab-bubble-inner">
													<div className="ai-lab-bubble-text">{message.text}</div>
													<div className="ai-lab-bubble-meta">
														<span>{isAssistant ? 'Sofi' : session?.contactName || 'Cliente'}</span>
														<span>{createdAtLabel}</span>
													</div>
												</div>
											)}
										</div>
									</div>
								</div>
							);
						})
					) : (
						<div className="empty-state large">Cargá un escenario o arrancá desde cero.</div>
					)}
					{isBusy ? (
						<div className="ai-lab-turn-status" role="status">
							<span aria-hidden="true" />
							Procesando turno...
						</div>
					) : null}
					<div ref={messagesEndRef} />
				</div>

				<form className="ai-lab-chat-form" onSubmit={handleSubmit}>
					<textarea
						value={messageText}
						onChange={(event) => setMessageText(event.target.value)}
						placeholder="Escribí como si fueras el cliente..."
						rows={2}
						disabled={!session?.id || isBusy}
					/>
					<div className="ai-lab-composer-actions">
						<button type="submit" disabled={!messageText.trim() || !session?.id || isBusy}>
							{sendMessageMutation.isPending ? 'Probando...' : 'Enviar'}
						</button>
						<button type="button" className="ai-lab-secondary-btn" onClick={handleOpenMenu} disabled={!session?.id || isBusy}>
							Abrir menu
						</button>
					</div>
				</form>
			</section>

			<details className="ai-lab-debug-card">
				<summary className="ai-lab-debug-summary">
					<span>Debug y trazas</span>
					<small>Prompt, estado y runs persistidos</small>
				</summary>
				<div className="ai-lab-debug-content">
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

				<div className="ai-lab-meta-box compact">
					<h3>Historial persistido</h3>
					{persistedRuns.length ? (
						<div className="ai-lab-persisted-run-list">
							{persistedRuns.map((run) => (
								<div key={run.id} className="ai-lab-persisted-run-item">
									<div className="ai-lab-persisted-run-head">
										<strong>{run.action || 'turno'}</strong>
										<span>{new Date(run.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
									</div>
									<div className="ai-lab-persisted-run-body">
										<p><strong>Input:</strong> {run.userMessage || '—'}</p>
										<p><strong>Output:</strong> {run.assistantMessage || '—'}</p>
										<p><strong>Intent:</strong> {run.intent || '—'}</p>
										<p><strong>Modelo:</strong> {run.model || '—'}</p>
									</div>
								</div>
							))}
						</div>
					) : (
						<p style={{ margin: 0 }}>Todavía no hay runs persistidos para esta sesión.</p>
					)}
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
				</div>
			</details>
		</div>
	);
}
