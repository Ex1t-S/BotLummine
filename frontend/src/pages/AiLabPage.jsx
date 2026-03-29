import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../lib/api.js';

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

export default function AiLabPage() {
	const messagesEndRef = useRef(null);
	const [session, setSession] = useState(null);
	const [fixtureKey, setFixtureKey] = useState('body-modelador-inicio');
	const [messageText, setMessageText] = useState('');
	const [showPrompt, setShowPrompt] = useState(false);
	const [showCatalog, setShowCatalog] = useState(true);

	const fixturesQuery = useQuery({
		queryKey: ['ai-lab', 'fixtures'],
		queryFn: async () => {
			const res = await api.get('/ai-lab/fixtures');
			return res.data.fixtures || [];
		},
		staleTime: 60 * 1000,
	});

	const createSessionMutation = useMutation({
		mutationFn: async (nextFixtureKey) => {
			const res = await api.post('/ai-lab/sessions', { fixtureKey: nextFixtureKey });
			return res.data.session;
		},
		onSuccess: (nextSession) => {
			setSession(nextSession);
			setMessageText('');
		}
	});

	const resetSessionMutation = useMutation({
		mutationFn: async () => {
			if (!session?.id) return null;
			const res = await api.post(`/ai-lab/sessions/${session.id}/reset`, { fixtureKey });
			return res.data.session;
		},
		onSuccess: (nextSession) => {
			if (!nextSession) return;
			setSession(nextSession);
			setMessageText('');
		}
	});

	const sendMessageMutation = useMutation({
		mutationFn: async () => {
			if (!session?.id || !messageText.trim()) return null;
			const res = await api.post(`/ai-lab/sessions/${session.id}/messages`, {
				body: messageText.trim()
			});
			return res.data.session;
		},
		onSuccess: (nextSession) => {
			if (!nextSession) return;
			setSession(nextSession);
			setMessageText('');
		},
		onError: (error) => {
			console.error(error);
		}
	});

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

	function handleSubmit(event) {
		event.preventDefault();
		if (!messageText.trim() || !session?.id) return;
		sendMessageMutation.mutate();
	}

	return (
		<div className="ai-lab-page">
			<section className="ai-lab-sidebar-card">
				<div className="ai-lab-sidebar-header">
					<div>
						<h1>AI Lab</h1>
						<p>Probá la IA sin WhatsApp, con contexto, reset rápido y trazas internas.</p>
					</div>
				</div>

				<label className="ai-lab-field">
					<span>Fixture / escenario</span>
					<select value={fixtureKey} onChange={(event) => setFixtureKey(event.target.value)}>
						{fixtures.map((fixture) => (
							<option key={fixture.key} value={fixture.key}>
								{fixture.name}
							</option>
						))}
					</select>
				</label>

				<div className="ai-lab-actions-row">
					<button
						type="button"
						className="ai-lab-primary-btn"
						onClick={() => createSessionMutation.mutate(fixtureKey)}
						disabled={isBusy}
					>
						Nueva sesión
					</button>
					<button
						type="button"
						className="ai-lab-secondary-btn"
						onClick={() => resetSessionMutation.mutate()}
						disabled={!session?.id || isBusy}
					>
						Reset rápido
					</button>
				</div>

				<div className="ai-lab-fixture-list">
					{fixtures.map((fixture) => {
						const active = fixture.key === fixtureKey;
						return (
							<button
								key={fixture.key}
								type="button"
								className={`ai-lab-fixture-card ${active ? 'active' : ''}`}
								onClick={() => setFixtureKey(fixture.key)}
							>
								<strong>{fixture.name}</strong>
								<span>{fixture.description}</span>
								<small>{fixture.messageCount} mensajes base</small>
							</button>
						);
					})}
				</div>

				<div className="ai-lab-meta-box">
					<h3>Esperado</h3>
					<ul>
						{session?.fixtureMeta?.expected?.length ? (
							session.fixtureMeta.expected.map((item) => <li key={item}>{item}</li>)
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

				<div className="ai-lab-chat-body">
					{session?.messages?.length ? (
						session.messages.map((message) => (
							<div
								key={message.id}
								className={`ai-lab-bubble ${message.role === 'assistant' ? 'assistant' : 'user'}`}
							>
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
			</section>

			<aside className="ai-lab-debug-card">
				<div className="ai-lab-debug-header">
					<h2>Debug</h2>
					<div className="ai-lab-debug-toggles">
						<button type="button" onClick={() => setShowCatalog((value) => !value)}>
							{showCatalog ? 'Ocultar catálogo' : 'Mostrar catálogo'}
						</button>
						<button type="button" onClick={() => setShowPrompt((value) => !value)}>
							{showPrompt ? 'Ocultar prompt' : 'Ver prompt'}
						</button>
					</div>
				</div>

				<div className="ai-lab-debug-grid">
					<div className="ai-lab-debug-item">
						<h3>Respuesta final</h3>
						<p>{trace?.assistantMessage || 'Todavía no corriste ningún turno.'}</p>
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
						<p>{commercialPlan?.bestOffer?.name || 'No definida'}</p>
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
